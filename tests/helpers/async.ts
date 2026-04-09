export function sleep(ms = 0): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function waitFor(predicate: () => boolean, timeout = 100): Promise<void> {
  const start = performance.now()

  while (!predicate()) {
    if (performance.now() - start > timeout) {
      throw new Error('timed out waiting for condition')
    }

    await sleep(0)
  }
}

export function onceEvent<T = unknown>(
  target: {
    on: (type: string, listener: (event: T) => void) => void
    off: (type: string, listener: (event: T) => void) => void
  },
  type: string,
): Promise<T> {
  return new Promise((resolve) => {
    const listener = (event: T) => {
      target.off(type, listener)
      resolve(event)
    }

    target.on(type, listener)
  })
}

export function createDeferred<T>(): {
  readonly promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void

  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })

  return {
    promise,
    resolve,
    reject,
  }
}
