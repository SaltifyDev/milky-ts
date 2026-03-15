export type { Emitter as EventEmitter, WildcardHandler } from 'mitt'
export { default as createEventEmitter } from 'mitt'
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

export function joinURL(baseURL: string | URL, endpoint: string): URL {
  const normalized = new URL(baseURL)

  if (!normalized.pathname.endsWith('/')) {
    normalized.pathname = `${normalized.pathname}/`
  }

  return new URL(endpoint, normalized)
}
