import { afterEach, expect, it, vi } from 'vitest'
import { createDeferred, onceEvent, sleep, waitFor } from './helpers/async'
import { FakeWebSocket } from './helpers/transports'

afterEach(() => {
  vi.doUnmock('@/events/source')
  vi.resetModules()
})

async function loadEventsWithMock(
  connectImpl: (transport: unknown) => Promise<unknown>,
): Promise<{
  createMilkyEventSource: typeof import('@/events/index').createMilkyEventSource
  MilkyEventSourceImpl: typeof import('@/events/internal').MilkyEventSourceImpl
}> {
  vi.resetModules()
  vi.doMock('@/events/source', async () => {
    const actual = await vi.importActual<typeof import('@/events/source')>('@/events/source')
    return {
      ...actual,
      connectEventTransport: vi.fn(connectImpl),
    }
  })

  const events = await import('@/events/index')
  const internal = await import('@/events/internal')

  return {
    createMilkyEventSource: events.createMilkyEventSource,
    MilkyEventSourceImpl: internal.MilkyEventSourceImpl,
  }
}

it('guards controller operations after closure and only settles terminations once', async () => {
  const { MilkyEventSourceImpl } = await import('@/events/internal')

  const closedSource = new MilkyEventSourceImpl()
  let openCount = 0
  let pushCount = 0
  let errorCount = 0

  closedSource.addEventListener('open', () => {
    openCount += 1
  })
  closedSource.addEventListener('push', () => {
    pushCount += 1
  })
  closedSource.addEventListener('error', () => {
    errorCount += 1
  })

  closedSource.close()
  closedSource.close()
  closedSource.controller.dispatchOpen()
  closedSource.controller.dispatchMessage({} as never)
  closedSource.controller.dispatchError(new Error('late'))

  expect(openCount).toBe(0)
  expect(pushCount).toBe(0)
  expect(errorCount).toBe(0)

  const pendingSource = new MilkyEventSourceImpl()
  const finish = pendingSource.controller.createTerminate<string>()

  finish('first')
  finish('second')

  await expect(finish.promise).resolves.toBe('first')
})

it('dispatches push events, typed events, and async iteration from the same payload', async () => {
  const { MilkyEventSourceImpl } = await import('@/events/internal')

  const source = new MilkyEventSourceImpl()
  const payload = {
    event_type: 'private_message_created',
    id: 1,
  } as never
  const iterator = source[Symbol.asyncIterator]()

  const pushEvent = onceEvent(source, 'push')
  const typedEvent = onceEvent(source, 'private_message_created')
  const firstMessage = iterator.next()
  source.controller.dispatchMessage(payload)

  await expect(pushEvent).resolves.toMatchObject({
    event: payload,
  })
  await expect(typedEvent).resolves.toMatchObject({
    event: payload,
  })
  await expect(firstMessage).resolves.toMatchObject({
    done: false,
    value: payload,
  })

  const finished = iterator.next()
  source.close()

  await expect(finished).resolves.toMatchObject({
    done: true,
  })
})

it('exposes forwarded message events through async iteration', async () => {
  const { createMilkyEventSource } = await import('@/events/index')
  const originalWebSocket = globalThis.WebSocket

  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket

  try {
    const socket = new FakeWebSocket()
    const source = await createMilkyEventSource(() => socket as unknown as WebSocket)
    const received: unknown[] = []
    const pushEvents: unknown[] = []

    await sleep(0)

    const consume = (async () => {
      for await (const message of source) {
        received.push(message)
        if (received.length === 2) {
          break
        }
      }
    })()

    source.addEventListener('push', (event) => {
      pushEvents.push((event as { event: unknown }).event)
    })

    socket.open()
    socket.sendMessage({ event_type: 'private_message_created', id: 1 })
    socket.sendMessage({ event_type: 'private_message_created', id: 2 })

    await consume

    expect(received).toEqual([
      { event_type: 'private_message_created', id: 1 },
      { event_type: 'private_message_created', id: 2 },
    ])
    expect(pushEvents).toEqual([
      { event_type: 'private_message_created', id: 1 },
      { event_type: 'private_message_created', id: 2 },
    ])

    source.close()
  }
  finally {
    globalThis.WebSocket = originalWebSocket
  }
})

it('dispatches unreported sse termination errors from reconnect loops', async () => {
  const connected = createDeferred<void>()
  const termination = createDeferred<{
    type: 'error'
    error: Error
    reported: false
  }>()
  const { createMilkyEventSource, MilkyEventSourceImpl } = await loadEventsWithMock(async () => {
    connected.resolve()
    return {
      kind: 'sse',
      source: new MilkyEventSourceImpl(),
      termination: termination.promise,
    }
  })

  const source = await createMilkyEventSource(() => new FakeWebSocket() as never, {
    reconnect: {
      interval: 1,
      attempts: 'always',
    },
  })

  await connected.promise

  let errorMessage: string | undefined
  source.addEventListener('error', (event) => {
    errorMessage = (event as ErrorEvent).message
  }, { once: true })

  termination.resolve({
    type: 'error',
    error: new Error('sse failed'),
    reported: false,
  })

  await waitFor(() => errorMessage != null)
  expect(errorMessage).toBe('sse failed')
  await waitFor(() => source.readyState === source.CLOSED)
})

it('stops reconnecting when websocket termination errors close the source from an error listener', async () => {
  const termination = createDeferred<{
    type: 'error'
    error: Error
    reported: false
  }>()
  const { createMilkyEventSource, MilkyEventSourceImpl } = await loadEventsWithMock(async () => ({
    kind: 'websocket',
    source: new MilkyEventSourceImpl(),
    termination: termination.promise,
  }))

  const source = await createMilkyEventSource(() => new FakeWebSocket() as never, {
    reconnect: {
      interval: 1,
      attempts: 'always',
    },
  })

  const errorMessages: string[] = []
  source.addEventListener('error', (event) => {
    errorMessages.push((event as ErrorEvent).message)
    source.close()
  }, { once: true })

  termination.resolve({
    type: 'error',
    error: new Error('ws failed'),
    reported: false,
  })

  await waitFor(() => source.readyState === source.CLOSED)
  expect(errorMessages).toEqual(['ws failed'])
})

it('reports transport connection failures during reconnect loops', async () => {
  const connected = createDeferred<void>()
  const { createMilkyEventSource } = await loadEventsWithMock(async () => {
    connected.resolve()
    await sleep(0)
    throw new Error('connect failed')
  })

  const source = await createMilkyEventSource(() => new FakeWebSocket() as never, {
    reconnect: {
      interval: 1,
      attempts: 0,
    },
  })

  await connected.promise
  const error = onceEvent<ErrorEvent>(source, 'error')

  expect((await error).message).toBe('connect failed')
  await waitFor(() => source.readyState === source.CLOSED)
})

it('breaks reconnect loops when closed during an in-flight connect', async () => {
  const deferred = createDeferred<{
    kind: 'websocket'
    source: InstanceType<typeof import('@/events/internal').MilkyEventSourceImpl>
    termination: Promise<{ type: 'closed' }>
  }>()
  const { createMilkyEventSource, MilkyEventSourceImpl } = await loadEventsWithMock(() => deferred.promise)

  const source = await createMilkyEventSource(() => new FakeWebSocket() as never, {
    reconnect: {
      interval: 20,
      attempts: 'always',
    },
  })

  source.close()
  deferred.resolve({
    kind: 'websocket',
    source: new MilkyEventSourceImpl(),
    termination: Promise.resolve({
      type: 'closed',
    }),
  })

  await sleep(10)

  expect(source.readyState).toBe(source.CLOSED)
})
