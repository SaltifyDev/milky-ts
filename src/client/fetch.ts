import type { MilkyRawEndpoints } from '@/gen/types'
import { milkyProto } from 'src/gen/proto'
import { joinURL, withTimeout } from '@/utils'

export interface MilkyFetchOptions {
  readonly baseURL?: string | URL
  readonly token?: string
  readonly timeout?: number | false
  readonly request?: Omit<RequestInit, 'body' | 'signal' | 'method'>
  readonly fetch?: (request: Request) => Promise<Response>
}

export type MilkyFetchCreateOptions = Omit<MilkyFetchOptions, 'baseURL'> & {
  readonly baseURL: string | URL
}

export type MilkyFetch
  = <const T extends keyof MilkyRawEndpoints>(
    name: T,
    param: Parameters<MilkyRawEndpoints[T]>[0],
    override?: MilkyFetchOptions,
  ) => Promise<ReturnType<MilkyRawEndpoints[T]>>

interface MilkyApiResponse<T> {
  status: 'ok' | 'failed'
  retcode: number
  data?: T
  message?: string | null
}

export function createMilkyFetch(options: MilkyFetchCreateOptions): MilkyFetch {
  if (options.fetch == null && globalThis.fetch == null) {
    throw new Error('milky: fetch is not provided')
  }

  const defaultFetch = options.fetch ?? globalThis.fetch.bind(globalThis)

  return async function fetch<T extends keyof MilkyRawEndpoints>(
    name: T,
    params: Parameters<MilkyRawEndpoints[T]>[0],
    override?: MilkyFetchOptions,
  ): Promise<ReturnType<MilkyRawEndpoints[T]>> {
    if (!Object.hasOwn(milkyProto, name)) {
      throw new Error(`milky: unknown endpoint ${String(name)}`)
    }

    const [paramStruct, responseStruct] = milkyProto[name]

    const paramParseResult = await paramStruct.safeParseAsync(params)

    if (!paramParseResult.success) {
      throw new Error(`milky: failed to validate params for ${String(name)}: ${paramParseResult.error.message}`)
    }

    params = paramParseResult.data as any

    const baseURL = override?.baseURL ?? options.baseURL
    const timeout = override?.timeout ?? options.timeout
    const token = override?.token ?? options.token
    const execute = (override?.fetch ?? defaultFetch).bind(globalThis)
    const resolvedTimeout = timeout === false ? undefined : timeout ?? 30000

    const requestInit = {
      ...options.request,
      ...override?.request,
    } satisfies Omit<RequestInit, 'body' | 'signal' | 'method'>

    const headers = new Headers(options.request?.headers)

    if (override?.request?.headers) {
      new Headers(override?.request?.headers).forEach((value, key) => {
        headers.set(key, value)
      })
    }

    if (!headers.has('accept')) {
      headers.set('accept', 'application/json')
    }
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json')
    }
    if (token && !headers.has('authorization')) {
      headers.set('authorization', `Bearer ${token}`)
    }

    const controller = new AbortController()
    let didTimeout = false

    const request = new Request(joinURL(baseURL, String(name)), {
      ...requestInit,
      method: 'POST',
      headers,
      body: JSON.stringify(params ?? {}),
      signal: controller.signal,
    })

    const response = await withTimeout(
      execute(request).catch((error) => {
        if (didTimeout) {
          throw new Error(`milky: timed out after ${resolvedTimeout}ms`, { cause: error })
        }

        throw error
      }),
      resolvedTimeout,
      () => {
        didTimeout = true
        controller.abort()
      },
    )

    let payload: MilkyApiResponse<ReturnType<MilkyRawEndpoints[T]>>

    try {
      payload = await response.json() as MilkyApiResponse<ReturnType<MilkyRawEndpoints[T]>>
    }
    catch (error) {
      throw new Error(`milky: failed to parse response for ${String(name)}`, { cause: error })
    }

    if (!response.ok || payload.status === 'failed') {
      throw new Error(payload.message ?? `milky: invoke ${String(name)} failed: ${payload.message} (${payload.retcode})`)
    }

    const responseParseResult = await responseStruct.safeParseAsync(payload.data)

    if (!responseParseResult.success) {
      throw new Error(`milky: failed to parse response for ${String(name)}: ${responseParseResult.error.message}`)
    }

    return responseParseResult.data as ReturnType<MilkyRawEndpoints[T]>
  }
}
