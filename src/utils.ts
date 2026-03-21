export type Awaitable<T> = T | Promise<T>
export type MaybeArray<T> = T | T[]

export function toArray<T>(value: MaybeArray<T>): T[] {
  return Array.isArray(value) ? value : [value]
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function createTimeout(timeout?: number, onTimeout?: () => void): { promise: Promise<never>, cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined

  return {
    promise: new Promise((_, reject) => {
      if (timeout == null) {
        return
      }

      timer = setTimeout(() => {
        onTimeout?.()
        reject(new Error(`milky: timed out after ${timeout}ms`))
      }, timeout)
    }),
    cancel: () => {
      if (timer != null) {
        clearTimeout(timer)
      }
    },
  }
}

export function withTimeout<T>(p: Promise<T> | (() => Promise<T>), timeout?: number, onTimeout?: () => void): Promise<T> {
  p = typeof p === 'function' ? p() : p
  if (timeout == null) {
    return p
  }

  const { promise, cancel } = createTimeout(timeout, onTimeout)
  return Promise.race([p, promise]).finally(cancel)
}

export function raceWithAbort<T>(signal: AbortSignal | undefined, promise: Promise<T>, onAbort: () => void): Promise<T> {
  if (!signal) {
    return promise
  }

  if (signal.aborted) {
    onAbort()
    return Promise.reject(new Error('aborted'))
  }

  const abortDeferred = Promise.withResolvers<never>()
  const abort = () => {
    onAbort()
    abortDeferred.reject(new Error('aborted'))
  }

  signal.addEventListener('abort', abort, { once: true })
  return Promise.race([promise, abortDeferred.promise]).finally(() => {
    signal.removeEventListener('abort', abort)
  })
}

export function sleepWithAbort(signal: AbortSignal, ms: number): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new Error('milky: reconnect aborted'))
  }

  const deferred = Promise.withResolvers<void>()
  let timer: ReturnType<typeof setTimeout>
  const abort = () => {
    clearTimeout(timer)
    deferred.reject(new Error('milky: reconnect aborted'))
  }

  timer = setTimeout(() => {
    signal.removeEventListener('abort', abort)
    deferred.resolve()
  }, ms)

  signal.addEventListener('abort', abort, { once: true })
  return deferred.promise
}

export function joinURL(baseURL: string | URL, endpoint: string): URL {
  const normalized = new URL(baseURL)

  if (!normalized.pathname.endsWith('/')) {
    normalized.pathname = `${normalized.pathname}/`
  }

  return new URL(endpoint, normalized)
}
