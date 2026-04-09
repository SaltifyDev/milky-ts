/* eslint-disable ts/no-use-before-define */
import type { MilkyEventSource, MilkyEventSourceController, MilkyEventSourceEventMap } from '@/events/internal'
import type {
  MilkyEventSourceConnection,
  MilkyEventSourceConnectionKind,
  MilkyEventSourceTransport,
  MilkyResolvedEventSourceConnectionKind,
} from '@/events/source'
import type { Awaitable } from '@/utils'
import { MilkyEventSourceImpl } from '@/events/internal'
import { connectEventTransport } from '@/events/source'
import { joinURL, raceWithAbort, sleepWithAbort, withTimeout } from '@/utils'

export interface MilkyEventSourceOptions {
  token?: string
  timeout?: number
  reconnect?: false | {
    interval: number
    attempts: 'always' | number
  }
}

export interface MilkyEventSourceCreateOptions extends MilkyEventSourceOptions {
  baseURL: string | URL
}

export type MilkyEventSourceTransportFactory = (
  options: MilkyEventSourceOptions,
  signal?: AbortSignal,
) => Awaitable<MilkyEventSourceTransport>

let eventSourceConstructorPromise: Promise<typeof EventSource> | undefined

async function resolveEventSourceConstructor(): Promise<typeof EventSource> {
  if (globalThis.EventSource) {
    return globalThis.EventSource
  }

  eventSourceConstructorPromise ??= import('eventsource')
    .then(module => module.EventSource as unknown as typeof EventSource)
    .catch((error) => {
      eventSourceConstructorPromise = undefined
      throw new TypeError('milky: EventSource is not available in current runtime, install optional peer dependency "eventsource" to enable sse', { cause: error })
    })

  return eventSourceConstructorPromise
}

async function createTransportByKind(
  kind: MilkyResolvedEventSourceConnectionKind,
  options: MilkyEventSourceCreateOptions,
): Promise<MilkyEventSourceTransport> {
  const url = joinURL(options.baseURL, '/event')

  if (options.token) {
    url.searchParams.set('access_token', options.token)
  }

  switch (kind) {
    case 'sse':
      return new (await resolveEventSourceConstructor())(url)
    case 'websocket':
      return new WebSocket(url)
    default:
      throw new TypeError(`milky: unknown event source kind: ${String(kind)}`)
  }
}

async function waitForWebSocketOpen(
  connection: MilkyEventSourceConnection,
  signal: AbortSignal,
): Promise<boolean> {
  if (connection.kind !== 'websocket') {
    return true
  }

  if (connection.source.readyState === connection.source.OPEN) {
    return true
  }

  if (connection.source.readyState === connection.source.CLOSED) {
    return false
  }

  const deferred = Promise.withResolvers<boolean>()
  let settled = false
  const finish = (result: boolean) => {
    if (settled) {
      return
    }

    settled = true
    connection.source.off('open', onOpen)
    connection.source.off('error', onError)
    deferred.resolve(result)
  }
  const onOpen = () => {
    finish(true)
  }
  const onError = () => {
    finish(false)
  }

  connection.source.on('open', onOpen)
  connection.source.on('error', onError)
  void connection.termination.then(() => {
    finish(false)
  })

  return raceWithAbort(signal, deferred.promise, () => {
    connection.source.close()
    finish(false)
  })
}

async function createConnectionByKind(
  kind: MilkyEventSourceConnectionKind,
  options: MilkyEventSourceCreateOptions,
  signal: AbortSignal,
): Promise<MilkyEventSourceConnection> {
  if (kind !== 'auto') {
    return connectEventTransport(await createTransportByKind(kind, options))
  }

  let websocketConnection: MilkyEventSourceConnection | undefined

  try {
    websocketConnection = await connectEventTransport(await createTransportByKind('websocket', options))

    if (await waitForWebSocketOpen(websocketConnection, signal)) {
      return websocketConnection
    }
  }
  catch (error) {
    if (signal.aborted) {
      throw error
    }
  }

  websocketConnection?.source.close()
  return connectEventTransport(await createTransportByKind('sse', options))
}

function createDisconnectError(): Error {
  return new Error('milky: event source disconnected')
}

type MilkyEventSourceRunResult = 'retry' | 'stop'

export function createMilkyEventSource(
  factory: MilkyEventSourceTransportFactory,
  options?: MilkyEventSourceOptions,
): MilkyEventSource
export function createMilkyEventSource(
  kind: MilkyEventSourceConnectionKind,
  options: MilkyEventSourceCreateOptions,
): MilkyEventSource
export function createMilkyEventSource(
  kindOrFactory: MilkyEventSourceConnectionKind | MilkyEventSourceTransportFactory,
  options?: MilkyEventSourceCreateOptions | MilkyEventSourceOptions,
): MilkyEventSource {
  if (typeof kindOrFactory !== 'function' && (options == null || !('baseURL' in options))) {
    throw new TypeError('milky: baseURL is required when creating event sources by kind')
  }

  const timeout = options?.timeout ?? 15000
  const reconnect = options?.reconnect ?? false
  const eventOptions = options ?? {}

  async function connect(signal?: AbortSignal): Promise<MilkyEventSourceConnection> {
    const controller = new AbortController()
    let shouldCloseTransport = false

    try {
      const connectionPromise = typeof kindOrFactory === 'function'
        ? Promise.resolve(kindOrFactory(eventOptions, controller.signal)).then(connectEventTransport)
        : createConnectionByKind(kindOrFactory, options as MilkyEventSourceCreateOptions, controller.signal)
      connectionPromise.then((connection) => {
        if (shouldCloseTransport || controller.signal.aborted) {
          connection.source.close()
        }
      }, () => {})

      const pending = withTimeout(connectionPromise, timeout, () => {
        shouldCloseTransport = true
        controller.abort()
      })

      return await raceWithAbort(signal, pending, () => {
        shouldCloseTransport = true
        controller.abort()
      })
    }
    catch (error) {
      shouldCloseTransport = true
      controller.abort()
      throw error
    }
  }

  const controller = new AbortController()
  const { signal } = controller
  let currentConnection: MilkyEventSourceConnection | undefined
  let controllerState!: MilkyEventSourceController
  const emitter = new MilkyEventSourceImpl((state) => {
    controllerState = state
    controllerState.setCloseHandler(() => {
      controller.abort()
      currentConnection?.source.close()
    })
  })

  async function forwardConnection(connection: MilkyEventSourceConnection) {
    const stopForwarding = controllerState.forwardFrom(connection.source)
    try {
      return await connection.termination
    }
    finally {
      stopForwarding()
    }
  }

  async function runConnection(): Promise<MilkyEventSourceRunResult> {
    let connection: MilkyEventSourceConnection | undefined

    try {
      connection = await connect(signal)
      currentConnection = connection

      if (signal.aborted) {
        connection.source.close()
        return 'stop'
      }

      const termination = await forwardConnection(connection)
      currentConnection = undefined

      if (signal.aborted || termination.type === 'closed') {
        return 'stop'
      }

      if (connection.kind === 'sse') {
        if (termination.type === 'error' && !termination.reported) {
          controllerState.dispatchError(termination.error)
        }

        return 'stop'
      }

      if (reconnect) {
        controllerState.markConnecting()
      }

      if (termination.type === 'ended') {
        controllerState.dispatchError(createDisconnectError())
      }
      else if (!termination.reported) {
        controllerState.dispatchError(termination.error)
      }

      return reconnect ? 'retry' : 'stop'
    }
    catch (error) {
      currentConnection = undefined

      if (signal.aborted) {
        return 'stop'
      }

      if (reconnect) {
        controllerState.markConnecting()
      }

      controllerState.dispatchError(error)
      return reconnect ? 'retry' : 'stop'
    }
  }

  void (async () => {
    try {
      if (!reconnect) {
        await runConnection()
        return
      }

      let attempts = 0

      while (!signal.aborted) {
        if (await runConnection() === 'stop') {
          break
        }

        if (signal.aborted) {
          break
        }

        if (reconnect.attempts !== 'always' && attempts >= reconnect.attempts) {
          break
        }

        attempts += 1

        try {
          await sleepWithAbort(signal, reconnect.interval)
        }
        catch {
          break
        }
      }
    }
    finally {
      controllerState.markClosed()
    }
  })()

  return emitter
}

export type { MilkyEventSource, MilkyEventSourceEventMap, MilkyEventSourceTransport }
