import { afterEach, expect, it, vi } from 'vitest'
import { createMilkyFetch } from '@/client/fetch'
import { sleep } from './helpers/async'

const originalFetch = globalThis.fetch

function createJsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json',
    },
    ...init,
  })
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

it('uses the global fetch implementation when no local fetch is provided', async () => {
  const globalFetch = vi.fn(async (request: Request) => {
    expect(request.url).toBe('https://example.com/api/get_login_info')

    return createJsonResponse({
      status: 'ok',
      retcode: 0,
      data: {
        uin: 10001,
        nickname: 'bot',
      },
    })
  })

  globalThis.fetch = globalFetch as typeof fetch

  const milkyFetch = createMilkyFetch({
    baseURL: 'https://example.com',
  })

  await expect(milkyFetch('get_login_info', undefined)).resolves.toEqual({
    uin: 10001,
    nickname: 'bot',
  })
  expect(globalFetch).toHaveBeenCalledOnce()
})

it('throws when no fetch implementation is available', () => {
  globalThis.fetch = undefined as unknown as typeof fetch

  expect(() => createMilkyFetch({
    baseURL: 'https://example.com',
  })).toThrow('milky: fetch is not provided')
})

it('posts JSON requests to the API endpoint and returns data payloads', async () => {
  const fetchMock = vi.fn(async (request: Request) => {
    expect(request.method).toBe('POST')
    expect(request.url).toBe('https://example.com/base/api/get_login_info')
    expect(request.headers.get('authorization')).toBe('Bearer root-token')
    expect(request.headers.get('content-type')).toBe('application/json')
    expect(await request.text()).toBe('{}')

    return createJsonResponse({
      status: 'ok',
      retcode: 0,
      data: {
        uin: 10001,
        nickname: 'bot',
      },
    })
  })

  const milkyFetch = createMilkyFetch({
    baseURL: 'https://example.com/base',
    token: 'root-token',
    fetch: fetchMock,
  })

  await expect(milkyFetch('get_login_info', undefined)).resolves.toEqual({
    uin: 10001,
    nickname: 'bot',
  })
  expect(fetchMock).toHaveBeenCalledOnce()
})

it('allows per-request overrides for baseURL, token, fetch and headers', async () => {
  const defaultFetch = vi.fn()
  const overrideFetch = vi.fn(async (request: Request) => {
    expect(request.url).toBe('https://override.example.com/api/get_friend_info')
    expect(request.headers.get('authorization')).toBe('Bearer override-token')
    expect(request.headers.get('x-client')).toBe('default')
    expect(request.headers.get('x-sdk')).toBe('milky')
    expect(await request.text()).toBe(JSON.stringify({ user_id: 10001, no_cache: false }))

    return createJsonResponse({
      status: 'ok',
      retcode: 0,
      data: {
        friend: {
          user_id: 10001,
          nickname: 'friend',
          sex: 'unknown',
          qid: '',
          remark: '',
          category: {
            category_id: 0,
            category_name: 'default',
          },
        },
      },
    })
  })

  const milkyFetch = createMilkyFetch({
    baseURL: 'https://default.example.com/base',
    token: 'default-token',
    fetch: defaultFetch,
    request: {
      headers: {
        'x-client': 'default',
      },
    },
  })

  await expect(milkyFetch('get_friend_info', { user_id: 10001 } as never, {
    baseURL: 'https://override.example.com/',
    token: 'override-token',
    fetch: overrideFetch,
    request: {
      headers: {
        'x-sdk': 'milky',
      },
    },
  })).resolves.toEqual({
    friend: {
      user_id: 10001,
      nickname: 'friend',
      sex: 'unknown',
      qid: '',
      remark: '',
      category: {
        category_id: 0,
        category_name: 'default',
      },
    },
  })

  expect(defaultFetch).not.toHaveBeenCalled()
  expect(overrideFetch).toHaveBeenCalledOnce()
})

it('preserves explicit headers instead of overwriting them with defaults or token injection', async () => {
  const fetchMock = vi.fn(async (request: Request) => {
    expect(request.headers.get('authorization')).toBe('Basic explicit')
    expect(request.headers.get('accept')).toBe('application/x-ndjson')
    expect(request.headers.get('content-type')).toBe('text/plain')

    return createJsonResponse({
      status: 'ok',
      retcode: 0,
      data: {
        uin: 10001,
        nickname: 'bot',
      },
    })
  })

  const milkyFetch = createMilkyFetch({
    baseURL: 'https://example.com',
    token: 'root-token',
    fetch: fetchMock,
    request: {
      headers: {
        'authorization': 'Basic explicit',
        'accept': 'application/x-ndjson',
        'content-type': 'text/plain',
      },
    },
  })

  await expect(milkyFetch('get_login_info', undefined)).resolves.toEqual({
    uin: 10001,
    nickname: 'bot',
  })
})

it('throws when the endpoint name is unknown', async () => {
  const fetchMock = vi.fn()
  const milkyFetch = createMilkyFetch({
    baseURL: 'https://example.com',
    fetch: fetchMock,
  })

  await expect((milkyFetch as any)('unknown_endpoint', undefined)).rejects.toThrow('milky: unknown endpoint unknown_endpoint')
  expect(fetchMock).not.toHaveBeenCalled()
})

it('validates request params before issuing the request', async () => {
  const fetchMock = vi.fn()
  const milkyFetch = createMilkyFetch({
    baseURL: 'https://example.com',
    fetch: fetchMock,
  })

  await expect(milkyFetch('get_friend_info', {} as never)).rejects.toThrow('milky: failed to validate params for get_friend_info')
  expect(fetchMock).not.toHaveBeenCalled()
})

it('throws API failures with server messages', async () => {
  const milkyFetch = createMilkyFetch({
    baseURL: 'https://example.com',
    fetch: async () => createJsonResponse({
      status: 'failed',
      retcode: 10001,
      message: 'bad request',
    }),
  })

  await expect(milkyFetch('get_login_info', undefined)).rejects.toThrow('bad request')
})

it('throws default API failure messages when the response is not ok', async () => {
  const milkyFetch = createMilkyFetch({
    baseURL: 'https://example.com',
    fetch: async () => createJsonResponse({
      status: 'ok',
      retcode: 500,
      message: null,
    }, {
      status: 500,
      statusText: 'Server Error',
    }),
  })

  await expect(milkyFetch('get_login_info', undefined)).rejects.toThrow('milky: invoke get_login_info failed')
})

it('throws when response bodies are not valid JSON', async () => {
  const milkyFetch = createMilkyFetch({
    baseURL: 'https://example.com',
    fetch: async () => new Response('not-json', {
      headers: {
        'content-type': 'application/json',
      },
    }),
  })

  await expect(milkyFetch('get_login_info', undefined)).rejects.toThrow('milky: failed to parse response for get_login_info')
})

it('throws when response payloads do not match the endpoint schema', async () => {
  const milkyFetch = createMilkyFetch({
    baseURL: 'https://example.com',
    fetch: async () => createJsonResponse({
      status: 'ok',
      retcode: 0,
      data: {
        uin: 'not-a-number',
        nickname: 'bot',
      },
    }),
  })

  await expect(milkyFetch('get_login_info', undefined)).rejects.toThrow('milky: failed to parse response for get_login_info')
})

it('aborts timed out requests', async () => {
  const fetchMock = vi.fn((request: Request) => new Promise<Response>((_, reject) => {
    request.signal.addEventListener('abort', () => {
      reject(new Error('aborted'))
    }, { once: true })
  }))

  const milkyFetch = createMilkyFetch({
    baseURL: 'https://example.com',
    timeout: 10,
    fetch: fetchMock,
  })

  await expect(milkyFetch('get_login_info', undefined)).rejects.toThrow('milky: timed out after 10ms')
  expect(fetchMock).toHaveBeenCalledOnce()
})

it('allows disabling timeouts per request', async () => {
  const fetchMock = vi.fn(async () => {
    await sleep(20)
    return createJsonResponse({
      status: 'ok',
      retcode: 0,
      data: {
        uin: 10001,
        nickname: 'bot',
      },
    })
  })

  const milkyFetch = createMilkyFetch({
    baseURL: 'https://example.com',
    timeout: 1,
    fetch: fetchMock,
  })

  await expect(milkyFetch('get_login_info', undefined, {
    timeout: false,
  })).resolves.toEqual({
    uin: 10001,
    nickname: 'bot',
  })
})
