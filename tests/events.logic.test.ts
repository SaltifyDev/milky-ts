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
  let messageCount = 0
  let errorCount = 0

  closedSource.addEventListener('open', () => {
    openCount += 1
  })
  closedSource.addEventListener('message', () => {
    messageCount += 1
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
  expect(messageCount).toBe(0)
  expect(errorCount).toBe(0)

  const pendingSource = new MilkyEventSourceImpl()
  const finish = pendingSource.controller.createTerminate<string>()

  finish('first')
  finish('second')

  await expect(finish.promise).resolves.toBe('first')
})

it('dispatches unreported sse termination errors from reconnect loops', async () => {
  const { createMilkyEventSource, MilkyEventSourceImpl } = await loadEventsWithMock(async () => ({
    kind: 'sse',
    source: new MilkyEventSourceImpl(),
    // eslint-disable-next-line ts/no-use-before-define
    termination: termination.promise,
  }))
  const termination = createDeferred<{
    type: 'error'
    error: Error
    reported: false
  }>()

  const source = await createMilkyEventSource(() => new FakeWebSocket() as never, {
    reconnect: {
      interval: 1,
      attempts: 'always',
    },
  })

  const error = onceEvent<ErrorEvent>(source, 'error')
  termination.resolve({
    type: 'error',
    error: new Error('sse failed'),
    reported: false,
  })

  expect((await error).message).toBe('sse failed')
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
  const deferred = createDeferred<never>()
  const { createMilkyEventSource } = await loadEventsWithMock(() => deferred.promise)

  const source = await createMilkyEventSource(() => new FakeWebSocket() as never, {
    reconnect: {
      interval: 1,
      attempts: 0,
    },
  })

  const error = onceEvent<ErrorEvent>(source, 'error')
  deferred.reject(new Error('connect failed'))

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
