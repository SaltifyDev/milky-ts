import type { QuitGroupInput } from '@saltify/milky-types'
import type { MilkyFetchOptions } from '@/client/fetch'
import type { MilkyEventSourceOptions } from '@/events'
import type { MilkyEventSourceConnectionKind } from '@/events/source'
import { afterEach, expect, expectTypeOf, it, vi } from 'vitest'
import { createMilkyClient } from '@/client/endpoint'
import { waitFor } from './helpers/async'
import { FakeEventSource, FakeWebSocket } from './helpers/transports'

const { fallbackEventSourceUrls } = vi.hoisted(() => ({
  fallbackEventSourceUrls: [] as string[],
}))

vi.mock('eventsource', () => ({
  EventSource: class extends EventTarget {
    readonly CONNECTING = 0
    readonly OPEN = 1
    readonly CLOSED = 2

    readyState = this.CONNECTING

    constructor(readonly url: string | URL) {
      super()
      fallbackEventSourceUrls.push(String(url))
    }

    close(): void {
      this.readyState = this.CLOSED
    }
  },
}))

const originalEventSource = globalThis.EventSource
const originalWebSocket = globalThis.WebSocket

afterEach(() => {
  fallbackEventSourceUrls.length = 0
  globalThis.EventSource = originalEventSource
  globalThis.WebSocket = originalWebSocket
})

it('proxies grouped client methods to API endpoints', async () => {
  const fetchMock = vi.fn(async (request: Request) => {
    expect(request.method).toBe('POST')
    expect(request.url).toBe('https://example.com/base/api/get_login_info')
    expect(request.headers.get('authorization')).toBe('Bearer root-token')
    expect(await request.text()).toBe('{}')

    return new Response(JSON.stringify({
      status: 'ok',
      retcode: 0,
      data: {
        uin: 10001,
        nickname: 'bot',
      },
    }), {
      headers: {
        'content-type': 'application/json',
      },
    })
  })

  const client = createMilkyClient({
    baseURL: 'https://example.com/base',
    token: 'root-token',
    fetch: fetchMock,
  })

  await expect(client.system.getLoginInfo(undefined)).resolves.toEqual({
    uin: 10001,
    nickname: 'bot',
  })
  expect(fetchMock).toHaveBeenCalledOnce()
})

it('caches grouped endpoints and endpoint methods', () => {
  const client = createMilkyClient({
    baseURL: 'https://example.com',
    fetch: vi.fn(),
  })

  expect(client.system).toBe(client.system)
  expect(client.group).toBe(client.group)
  expect(client.system.getLoginInfo).toBe(client.system.getLoginInfo)
  expect(client.group.quitGroup).toBe(client.group.quitGroup)
  expect(client.system.name).toBe('system')
  expect((client as any).unknown).toBeUndefined()
  expect((client.system as any).unknown).toBeUndefined()
  expect(Reflect.set(client as object, 'fetch', null)).toBe(false)
  expect(Reflect.set(client.system as object, 'getLoginInfo', null)).toBe(false)
})

it('forwards params and per-request overrides through grouped client methods', async () => {
  const overrideFetch = vi.fn(async (request: Request) => {
    expect(request.url).toBe('https://override.example.com/api/quit_group')
    expect(request.headers.get('authorization')).toBe('Bearer override-token')
    expect(request.headers.get('x-sdk')).toBe('milky')
    expect(await request.text()).toBe(JSON.stringify({ group_id: 10001 }))

    return new Response(JSON.stringify({
      status: 'ok',
      retcode: 0,
    }), {
      headers: {
        'content-type': 'application/json',
      },
    })
  })

  const client = createMilkyClient({
    baseURL: 'https://default.example.com/base',
    token: 'default-token',
    fetch: vi.fn(),
  })

  await expect(client.group.quitGroup({ group_id: 10001 } as never, {
    baseURL: 'https://override.example.com',
    token: 'override-token',
    fetch: overrideFetch,
    request: {
      headers: {
        'x-sdk': 'milky',
      },
    },
  })).resolves.toBeUndefined()

  expect(overrideFetch).toHaveBeenCalledOnce()
})

it('adds token query when creating sse event urls', async () => {
  const urls: string[] = []

  globalThis.EventSource = class extends FakeEventSource {
    constructor(url: string | URL) {
      super(url)
      urls.push(String(url))
    }
  } as unknown as typeof EventSource

  const client = createMilkyClient({
    baseURL: 'https://example.com/base',
    token: 'root-token',
    fetch: vi.fn(),
  })

  const source = await client.event('sse')

  await waitFor(() => urls.length === 1)
  expect(urls).toEqual(['https://example.com/event?access_token=root-token'])

  source.close()
})

it('allows per-event token overrides when creating sse event urls', async () => {
  const urls: string[] = []

  globalThis.EventSource = class extends FakeEventSource {
    constructor(url: string | URL) {
      super(url)
      urls.push(String(url))
    }
  } as unknown as typeof EventSource

  const client = createMilkyClient({
    baseURL: 'https://example.com/base',
    token: 'root-token',
    fetch: vi.fn(),
  })

  const source = await client.event('sse', {
    token: 'event-token',
  })

  await waitFor(() => urls.length === 1)
  expect(urls).toEqual(['https://example.com/event?access_token=event-token'])

  source.close()
})

it('adds token query when creating websocket event urls', async () => {
  const urls: string[] = []

  globalThis.WebSocket = class extends FakeWebSocket {
    constructor(url: string | URL) {
      super(url)
      urls.push(String(url))
    }
  } as unknown as typeof WebSocket

  const client = createMilkyClient({
    baseURL: 'https://example.com/base',
    token: 'root-token',
    fetch: vi.fn(),
  })

  const source = await client.event('websocket')

  await waitFor(() => urls.length === 1)
  expect(urls).toEqual(['https://example.com/event?access_token=root-token'])

  source.close()
})

it('forwards auto event configuration through the client wrapper', async () => {
  const websocketUrls: string[] = []
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
    }
  } as unknown as typeof EventSource

  const client = createMilkyClient({
    baseURL: 'https://example.com/base',
    token: 'root-token',
    fetch: vi.fn(),
  })

  const source = await client.event('auto', {
    token: 'event-token',
    timeout: 25,
    reconnect: false,
  })

  await waitFor(() => websocketUrls.length === 1 && sseUrls.length === 1)
  expect(websocketUrls).toEqual(['https://example.com/event?access_token=event-token'])
  expect(sseUrls).toEqual(['https://example.com/event?access_token=event-token'])

  source.close()
})

it('defaults client event kind to auto when omitted', async () => {
  const websocketUrls: string[] = []
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
    }
  } as unknown as typeof EventSource

  const client = createMilkyClient({
    baseURL: 'https://example.com/base',
    token: 'root-token',
    fetch: vi.fn(),
  })

  const source = client.event()

  await waitFor(() => websocketUrls.length === 1 && sseUrls.length === 1)
  expect(websocketUrls).toEqual(['https://example.com/event?access_token=root-token'])
  expect(sseUrls).toEqual(['https://example.com/event?access_token=root-token'])

  source.close()
})

it('falls back to peer eventsource when global EventSource is unavailable', async () => {
  globalThis.EventSource = undefined as unknown as typeof EventSource

  const client = createMilkyClient({
    baseURL: 'https://example.com/base',
    token: 'root-token',
    fetch: vi.fn(),
  })

  const source = await client.event('sse')

  await waitFor(() => fallbackEventSourceUrls.length === 1)
  expect(fallbackEventSourceUrls).toEqual(['https://example.com/event?access_token=root-token'])

  source.close()
})

it('exposes grouped client methods with optional override options', () => {
  const client = createMilkyClient({
    baseURL: 'https://example.com',
    fetch: vi.fn(async () => new Response(JSON.stringify({
      status: 'ok',
      retcode: 0,
      data: {},
    }))),
  })

  expectTypeOf(client.system.getLoginInfo).parameters.toEqualTypeOf<[(undefined | null)?, MilkyFetchOptions?]>()
  expectTypeOf(client.group.quitGroup).parameters.toEqualTypeOf<[QuitGroupInput, MilkyFetchOptions?]>()
  expectTypeOf(client.event).parameters.toEqualTypeOf<[(MilkyEventSourceConnectionKind | undefined)?, MilkyEventSourceOptions?]>()
})
