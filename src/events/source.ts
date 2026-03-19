/* eslint-disable ts/no-use-before-define */
import type { MilkyEventSource, MilkyEventSourceController, MilkyEventSourceTerminate } from '@/events/internal'
import { MilkyEventSourceImpl } from '@/events/internal'

export type MilkyEventSourceConnectionKind = 'auto' | 'sse' | 'websocket'
export type MilkyResolvedEventSourceConnectionKind = Exclude<MilkyEventSourceConnectionKind, 'auto'>
export type MilkyEventSourceTransport = EventSource | WebSocket

export type MilkyEventSourceTermination
  = | { type: 'closed' }
    | { type: 'ended' }
    | { type: 'error', error: unknown, reported: boolean }

export interface MilkyEventSourceConnection {
  readonly kind: MilkyResolvedEventSourceConnectionKind
  readonly source: MilkyEventSource
  readonly termination: Promise<MilkyEventSourceTermination>
}

function dispatchDeferredOpen(controller: MilkyEventSourceController): void {
  controller.source.readyState = controller.source.OPEN

  // Defer synthetic open so callers awaiting source creation can still subscribe.
  setTimeout(() => {
    controller.dispatchOpen()
  }, 0)
}

function createTransportConnection(
  kind: MilkyResolvedEventSourceConnectionKind,
  setup: (controller: MilkyEventSourceController, finish: MilkyEventSourceTerminate<MilkyEventSourceTermination>) => void,
): MilkyEventSourceConnection {
  let termination!: Promise<MilkyEventSourceTermination>

  const source = new MilkyEventSourceImpl((controller) => {
    const finish = controller.createTerminate<MilkyEventSourceTermination>()
    termination = finish.promise
    setup(controller, finish)
  })

  return {
    kind,
    source,
    termination,
  }
}

function isEventSourceTransport(source: MilkyEventSourceTransport): source is EventSource {
  return !!globalThis.EventSource && source instanceof globalThis.EventSource
}

export async function connectWebSocket(source: WebSocket): Promise<MilkyEventSourceConnection> {
  return createTransportConnection('websocket', (controller, finish) => {
    const cleanup = () => {
      source.removeEventListener('open', onOpen)
      source.removeEventListener('message', onMessage)
      source.removeEventListener('error', onError)
      source.removeEventListener('close', onClose)
    }

    const onOpen = () => {
      controller.dispatchOpen()
    }

    const onMessage = (event: MessageEvent) => {
      try {
        controller.dispatchMessage(JSON.parse(event.data.toString()))
      }
      catch (error) {
        controller.dispatchError(error)
      }
    }

    const onError = (event: Event) => {
      controller.dispatchError(event)
    }

    const onClose = () => {
      cleanup()
      finish({ type: 'ended' })
    }

    controller.setCloseHandler(() => {
      cleanup()
      if (source.readyState === source.CLOSING || source.readyState === source.CLOSED) {
        finish({ type: 'closed' })
        return
      }

      source.close()
    })

    source.addEventListener('open', onOpen)
    source.addEventListener('message', onMessage)
    source.addEventListener('error', onError)
    source.addEventListener('close', onClose, { once: true })

    if (source.readyState === source.OPEN) {
      dispatchDeferredOpen(controller)
    }

    if (source.readyState === source.CLOSED) {
      queueMicrotask(() => {
        cleanup()
        finish({ type: 'ended' })
      })
    }
  })
}

export async function connectEventSource(source: EventSource): Promise<MilkyEventSourceConnection> {
  return createTransportConnection('sse', (controller, finish) => {
    let closedByUser = false

    const cleanup = () => {
      source.removeEventListener('open', onOpen)
      source.removeEventListener('milky_event', onMessage)
      source.removeEventListener('error', onError)
    }

    const onOpen = () => {
      controller.dispatchOpen()
    }

    const onMessage = (event: Event) => {
      const messageEvent = event as MessageEvent<string>
      try {
        controller.dispatchMessage(JSON.parse(messageEvent.data))
      }
      catch (error) {
        controller.dispatchError(error)
      }
    }

    const onError = (event: Event) => {
      if (closedByUser) {
        return
      }

      controller.markConnecting()
      controller.dispatchError(event)

      if (source.readyState === source.CLOSED) {
        cleanup()
        finish({ type: 'error', error: event, reported: true })
      }
    }

    controller.setCloseHandler(() => {
      closedByUser = true
      cleanup()
      source.close()
      finish({ type: 'closed' })
    })

    source.addEventListener('open', onOpen)
    source.addEventListener('milky_event', onMessage)
    source.addEventListener('error', onError)

    if (source.readyState === source.OPEN) {
      dispatchDeferredOpen(controller)
    }
  })
}

export async function connectEventTransport(source: MilkyEventSourceTransport): Promise<MilkyEventSourceConnection> {
  if (globalThis.WebSocket && source instanceof WebSocket) {
    return connectWebSocket(source)
  }

  if (isEventSourceTransport(source) || !globalThis.EventSource) {
    return connectEventSource(source as EventSource)
  }

  throw new TypeError('milky: unknown event source type')
}
