import { expect, it, vi } from 'vitest'
import { createMilkyFetch } from 'src/client/fetch'

it('posts JSON requests to the API endpoint and returns data payloads', async () => {
  const fetchMock = vi.fn(async (request: Request) => {
    expect(request.method).toBe('POST')
    expect(request.url).toBe('https://example.com/base/api/get_login_info')
    expect(request.headers.get('authorization')).toBe('Bearer root-token')
    expect(request.headers.get('content-type')).toBe('application/json')
    expect(await request.text()).toBe('{}')

    return new Response(JSON.stringify({
      status: 'ok',
      retcode: 0,
      data: {
        uin: '10001',
      },
    }), {
      headers: {
        'content-type': 'application/json',
      },
    })
  })

  const milkyFetch = createMilkyFetch({
    baseURL: 'https://example.com/base',
    token: 'root-token',
    fetch: fetchMock,
  })

  await expect(milkyFetch('get_login_info', undefined)).resolves.toEqual({ uin: '10001' })
  expect(fetchMock).toHaveBeenCalledOnce()
})

it('allows per-request overrides for baseURL, token, fetch and headers', async () => {
  const defaultFetch = vi.fn()
  const overrideFetch = vi.fn(async (request: Request) => {
    expect(request.url).toBe('https://override.example.com/api/get_friend_info')
    expect(request.headers.get('authorization')).toBe('Bearer override-token')
    expect(request.headers.get('x-sdk')).toBe('milky')
    expect(await request.text()).toBe(JSON.stringify({ friend_uin: '42' }))

    return new Response(JSON.stringify({
      status: 'ok',
      retcode: 0,
      data: {
        user_id: 42,
      },
    }), {
      headers: {
        'content-type': 'application/json',
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

  await expect(milkyFetch('get_friend_info', { friend_uin: '42' } as never, {
    baseURL: 'https://override.example.com/',
    token: 'override-token',
    fetch: overrideFetch,
    request: {
      headers: {
        'x-sdk': 'milky',
      },
    },
  })).resolves.toEqual({ user_id: 42 })

  expect(defaultFetch).not.toHaveBeenCalled()
  expect(overrideFetch).toHaveBeenCalledOnce()
})

it('throws API failures with server messages', async () => {
  const milkyFetch = createMilkyFetch({
    baseURL: 'https://example.com',
    fetch: async () => new Response(JSON.stringify({
      status: 'failed',
      retcode: 10001,
      message: 'bad request',
    }), {
      headers: {
        'content-type': 'application/json',
      },
    }),
  })

  await expect(milkyFetch('get_login_info', undefined)).rejects.toThrow('bad request')
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
