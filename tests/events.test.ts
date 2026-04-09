import { afterEach, expect, it, vi } from 'vitest'
import { createMilkyEventSource } from '@/events/index'
import { connectEventSource, connectEventTransport, connectWebSocket } from '@/events/source'
import { createDeferred, onceEvent, sleep, waitFor } from './helpers/async'
import { FakeEventSource, FakeWebSocket } from './helpers/transports'

const originalEventSource = globalThis.EventSource
const originalWebSocket = globalThis.WebSocket

afterEach(() => {
  globalThis.EventSource = originalEventSource
  globalThis.WebSocket = originalWebSocket
  vi.doUnmock('eventsource')
})

it('connects websocket transports and forwards push and typed events plus parse errors', async () => {
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket

  const socket = new FakeWebSocket()
  const connection = await connectWebSocket(socket as unknown as WebSocket)
  const payload = {
    event_type: 'private_message_created',
    id: 1,
  } as never

  const openEvent = onceEvent(connection.source, 'open')
  socket.open()
  await expect(openEvent).resolves.toBeInstanceOf(Event)

  const pushEvent = onceEvent(connection.source, 'push')
  const typedEvent = onceEvent(connection.source, 'private_message_created')
  socket.sendMessage(payload)
  await expect(pushEvent).resolves.toEqual(payload)
  await expect(typedEvent).resolves.toEqual(payload)

  const errorEvent = onceEvent<ErrorEvent>(connection.source, 'error')
  socket.sendRawMessage('{')
  expect((await errorEvent).error).toBeInstanceOf(Error)

  socket.close()
  await expect(connection.termination).resolves.toEqual({
    type: 'ended',
  })
})

it('dispatches open for already-open websocket transports', async () => {
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket

  const socket = new FakeWebSocket()
  socket.readyState = socket.OPEN

  const connection = await connectWebSocket(socket as unknown as WebSocket)

  await expect(Promise.race([
    onceEvent(connection.source, 'open'),
    sleep(20).then(() => null),
  ])).resolves.toBeInstanceOf(Event)
  expect(connection.source.readyState).toBe(connection.source.OPEN)

  connection.source.close()
})

it('dispatches open for already-open websocket sources created by milky', async () => {
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket

  const socket = new FakeWebSocket()
  socket.readyState = socket.OPEN

  const source = await createMilkyEventSource(() => socket as unknown as WebSocket)

  await expect(Promise.race([
    onceEvent(source, 'open'),
    sleep(20).then(() => null),
  ])).resolves.toBeInstanceOf(Event)
  expect(source.readyState).toBe(source.OPEN)

  source.close()
})

it('does not close websocket transports that are already closing', async () => {
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket

  const socket = new FakeWebSocket()
  const connection = await connectWebSocket(socket as unknown as WebSocket)
  socket.readyState = socket.CLOSING

  connection.source.close()

  expect(socket.closeCalls).toBe(0)
  await expect(connection.termination).resolves.toEqual({
    type: 'closed',
  })
})

it('connects event sources and reports terminal errors', async () => {
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource

  const source = new FakeEventSource()
  const connection = await connectEventSource(source as unknown as EventSource)
  const payload = {
    event_type: 'private_message_created',
    id: 2,
  } as never

  const openEvent = onceEvent(connection.source, 'open')
  source.open()
  await expect(openEvent).resolves.toBeInstanceOf(Event)

  const pushEvent = onceEvent(connection.source, 'push')
  const typedEvent = onceEvent(connection.source, 'private_message_created')
  source.sendMessage(payload)
  await expect(pushEvent).resolves.toEqual(payload)
  await expect(typedEvent).resolves.toEqual(payload)

  const parseError = onceEvent<ErrorEvent>(connection.source, 'error')
  source.sendRawMessage('{')
  expect((await parseError).error).toBeInstanceOf(Error)

  const terminalError = onceEvent<ErrorEvent>(connection.source, 'error')
  source.fail({ closed: true })

  expect((await terminalError).error).toBeInstanceOf(Event)
  await expect(connection.termination).resolves.toMatchObject({
    type: 'error',
    reported: true,
  })
})

it('ignores event source errors after the consumer closes the source', async () => {
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource

  const source = new FakeEventSource()
  const connection = await connectEventSource(source as unknown as EventSource)
  let errorCount = 0

  connection.source.on('error', () => {
    errorCount += 1
  })

  connection.source.close()
  source.fail({ closed: true })

  expect(source.closeCalls).toBe(1)
  expect(errorCount).toBe(0)
  await expect(connection.termination).resolves.toEqual({
    type: 'closed',
  })
})

it('rejects unknown event transport values', async () => {
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket

  await expect(connectEventTransport(new EventTarget() as never)).rejects.toThrow('milky: unknown event source type')
})

it('requires baseURL when creating event sources by kind', async () => {
  expect(() => createMilkyEventSource('sse', undefined as never)).toThrow('milky: baseURL is required when creating event sources by kind')
})

it('aborts timed out connection attempts and closes transports that resolve later', async () => {
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket

  const deferred = createDeferred<WebSocket>()
  const socket = new FakeWebSocket()
  let aborted = false

  const pending = createMilkyEventSource(async (_options, signal) => {
    signal?.addEventListener('abort', () => {
      aborted = true
    }, { once: true })

    return deferred.promise
  }, {
    timeout: 5,
  })

  const error = onceEvent<ErrorEvent>(pending, 'error')
  await expect(error).resolves.toMatchObject({
    message: 'milky: timed out after 5ms',
  })
  await waitFor(() => pending.readyState === pending.CLOSED)

  deferred.resolve(socket as unknown as WebSocket)
  await sleep(10)

  expect(aborted).toBe(true)
  expect(socket.closeCalls).toBe(1)
})

it('reconnects websocket transports with native EventSource semantics', async () => {
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket

  const sockets: FakeWebSocket[] = []
  const source = await createMilkyEventSource(() => {
    const socket = new FakeWebSocket()
    sockets.push(socket)
    return socket as unknown as WebSocket
  }, {
    reconnect: {
      interval: 1,
      attempts: 1,
    },
  })

  let openCount = 0
  let errorCount = 0

  source.on('open', () => {
    openCount += 1
  })
  source.on('error', () => {
    errorCount += 1
  })

  await waitFor(() => sockets.length === 1)
  await sleep(1)
  sockets[0]!.open()
  await sleep(1)
  expect(source.readyState).toBe(source.OPEN)
  expect(openCount).toBe(1)

  sockets[0]!.close()
  await sleep(10)

  expect(errorCount).toBe(1)
  expect(source.readyState).toBe(source.CONNECTING)
  expect(sockets).toHaveLength(2)

  sockets[1]!.open()
  await sleep(1)
  expect(source.readyState).toBe(source.OPEN)
  expect(openCount).toBe(2)

  source.close()
  expect(source.readyState).toBe(source.CLOSED)
  expect(sockets[1]!.closeCalls).toBe(1)
})

it('honors websocket reconnect attempt limits', async () => {
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket

  const sockets: FakeWebSocket[] = []
  const source = await createMilkyEventSource(() => {
    const socket = new FakeWebSocket()
    sockets.push(socket)
    return socket as unknown as WebSocket
  }, {
    reconnect: {
      interval: 1,
      attempts: 0,
    },
  })

  await waitFor(() => sockets.length === 1)
  sockets[0]!.open()
  await sleep(0)
  sockets[0]!.close()
  await sleep(10)

  expect(sockets).toHaveLength(1)
  expect(source.readyState).toBe(source.CLOSED)
})

it('stops reconnecting when closed during reconnect backoff', async () => {
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket

  const sockets: FakeWebSocket[] = []
  const source = await createMilkyEventSource(() => {
    const socket = new FakeWebSocket()
    sockets.push(socket)
    return socket as unknown as WebSocket
  }, {
    reconnect: {
      interval: 20,
      attempts: 'always',
    },
  })

  await waitFor(() => sockets.length === 1)
  sockets[0]!.open()
  await sleep(1)
  sockets[0]!.close()
  source.close()
  await sleep(30)

  expect(sockets).toHaveLength(1)
  expect(source.readyState).toBe(source.CLOSED)
})

it('creates websocket transports from kind and options overload', async () => {
  const urls: string[] = []

  globalThis.WebSocket = class extends FakeWebSocket {
    constructor(url: string | URL) {
      super(url)
      urls.push(String(url))
    }
  } as unknown as typeof WebSocket

  const source = await createMilkyEventSource('websocket', {
    baseURL: 'https://example.com/base',
    token: 'event-token',
  })

  await waitFor(() => urls.length === 1)
  expect(urls).toEqual(['https://example.com/event?access_token=event-token'])

  source.close()
  expect(source.readyState).toBe(source.CLOSED)
})

it('closes sources through Symbol.dispose', async () => {
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket

  const socket = new FakeWebSocket()
  const source = await createMilkyEventSource(() => socket as unknown as WebSocket)

  source[Symbol.dispose]()

  expect(source.readyState).toBe(source.CLOSED)
  await waitFor(() => socket.closeCalls === 1)
})

it('falls back from auto websocket to sse before open', async () => {
  const websocketUrls: string[] = []
  const eventSources: FakeEventSource[] = []
  const sseUrls: string[] = []

  globalThis.WebSocket = class extends FakeWebSocket {
    constructor(url: string | URL) {
      super(url)
      websocketUrls.push(String(url))
      queueMicrotask(() => {
        this.dispatchEvent(new Event('error'))
        this.close()
      })
    }
  } as unknown as typeof WebSocket

  globalThis.EventSource = class extends FakeEventSource {
    constructor(url: string | URL) {
      super(url)
      sseUrls.push(String(url))
      eventSources.push(this)
    }
  } as unknown as typeof EventSource

  const source = await createMilkyEventSource('auto', {
    baseURL: 'https://example.com/base',
    token: 'event-token',
  })

  await waitFor(() => websocketUrls.length === 1 && sseUrls.length === 1)
  expect(websocketUrls).toEqual(['https://example.com/event?access_token=event-token'])
  expect(sseUrls).toEqual(['https://example.com/event?access_token=event-token'])

  const payload = {
    event_type: 'private_message_created',
    id: 3,
  } as never
  const pushEvent = onceEvent(source, 'push')
  const typedEvent = onceEvent(source, 'private_message_created')
  eventSources[0]!.open()
  eventSources[0]!.sendMessage(payload)

  await expect(pushEvent).resolves.toEqual(payload)
  await expect(typedEvent).resolves.toEqual(payload)

  source.close()
  expect(source.readyState).toBe(source.CLOSED)
})

it('falls back from auto to sse when websocket construction throws', async () => {
  const sseUrls: string[] = []

  globalThis.WebSocket = class {
    constructor() {
      throw new Error('boom')
    }
  } as unknown as typeof WebSocket

  globalThis.EventSource = class extends FakeEventSource {
    constructor(url: string | URL) {
      super(url)
      sseUrls.push(String(url))
    }
  } as unknown as typeof EventSource

  const source = await createMilkyEventSource('auto', {
    baseURL: 'https://example.com/base',
    token: 'event-token',
  })

  await waitFor(() => sseUrls.length === 1)
  expect(sseUrls).toEqual(['https://example.com/event?access_token=event-token'])

  source.close()
})

it('uses native EventSource reconnection behavior directly', async () => {
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource

  const nativeSource = new FakeEventSource()
  const source = await createMilkyEventSource(() => nativeSource as unknown as EventSource, {
    reconnect: {
      interval: 1,
      attempts: 1,
    },
  })

  let openCount = 0
  let errorCount = 0
  source.on('open', () => {
    openCount += 1
  })
  source.on('error', () => {
    errorCount += 1
  })

  await sleep(1)
  nativeSource.open()
  await sleep(1)
  nativeSource.fail()
  await sleep(1)
  nativeSource.open()
  await sleep(1)
  expect(openCount).toBe(2)
  expect(errorCount).toBe(1)
  expect(source.readyState).toBe(source.OPEN)

  const payload = {
    event_type: 'private_message_created',
    id: 2,
  } as never
  const pushEvent = onceEvent(source, 'push')
  const typedEvent = onceEvent(source, 'private_message_created')
  nativeSource.sendMessage(payload)
  await expect(pushEvent).resolves.toEqual(payload)
  await expect(typedEvent).resolves.toEqual(payload)

  source.close()
  expect(source.readyState).toBe(source.CLOSED)
  expect(nativeSource.readyState).toBe(nativeSource.CLOSED)
})
