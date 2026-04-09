/* eslint-disable ts/method-signature-style */

import type { Event as MilkyEvent } from '@/gen/proto'
import mitt from 'mitt'

const subscribeClose = Symbol('MilkyEventSourceImpl.subscribeClose')
const finishAsyncIteration = Symbol('MilkyEventSourceImpl.finishAsyncIteration')

type DeepReadonly<T>
  = T extends (...args: any[]) => unknown ? T
    : T extends readonly (infer U)[] ? readonly DeepReadonly<U>[]
      : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
        : T

function makeDeepReadonly<T>(value: T, seen = new WeakSet<object>()): DeepReadonly<T> {
  if (value == null || typeof value !== 'object') {
    return value as DeepReadonly<T>
  }

  if (seen.has(value)) {
    return value as DeepReadonly<T>
  }

  seen.add(value)

  // Recursively freeze nested objects
  for (const nested of Object.values(value)) {
    if (nested != null && typeof nested === 'object') {
      makeDeepReadonly(nested, seen)
    }
  }

  return Object.freeze(value) as DeepReadonly<T>
}

export type ReadonlyMilkyEvent = DeepReadonly<MilkyEvent>

export type MilkyEventSourceEventMap = {
  error: ErrorEvent
  push: ReadonlyMilkyEvent
  open: Event
} & {
  [P in MilkyEvent['event_type']]: DeepReadonly<Extract<MilkyEvent, { event_type: P }>>
}

type MilkyEventSourceEventKey = keyof MilkyEventSourceEventMap

export interface MilkyEventSource extends AsyncIterable<ReadonlyMilkyEvent> {
  on<K extends MilkyEventSourceEventKey>(
    type: K,
    listener: (ev: MilkyEventSourceEventMap[K]) => any,
  ): void
  on(
    type: string,
    listener: (ev: unknown) => any,
  ): void
  off<K extends MilkyEventSourceEventKey>(
    type: K,
    listener: (ev: MilkyEventSourceEventMap[K]) => any,
  ): void
  off(
    type: string,
    listener: (ev: unknown) => any,
  ): void

  readonly readyState: number
  readonly CONNECTING: 0
  readonly OPEN: 1
  readonly CLOSED: 2

  close(): void
  [Symbol.dispose](): void
  [Symbol.asyncIterator](): AsyncIterableIterator<ReadonlyMilkyEvent>
}

export interface MilkyEventSourceTerminate<Result> {
  (result: Result): void
  readonly promise: Promise<Result>
}

export class MilkyEventSourceController {
  private _closeHandler: () => void = () => {}
  private _closed = false

  constructor(readonly source: MilkyEventSourceImpl) {}

  createTerminate<Result>(): MilkyEventSourceTerminate<Result> {
    const deferred = Promise.withResolvers<Result>()
    let settled = false
    const finish = ((result: Result) => {
      if (settled) {
        return
      }

      settled = true
      this.markClosed()
      deferred.resolve(result)
    }) as MilkyEventSourceTerminate<Result>

    return Object.assign(finish, {
      promise: deferred.promise,
    })
  }

  setCloseHandler(closeHandler: () => void): void {
    this._closeHandler = closeHandler
  }

  markConnecting(): void {
    if (!this._closed) {
      this.source.readyState = this.source.CONNECTING
    }
  }

  markClosed(): void {
    if (this._closed) {
      return
    }

    this._closed = true
    this.source.readyState = this.source.CLOSED
    this.source[finishAsyncIteration]()
  }

  dispatchOpen(): void {
    if (this._closed) {
      return
    }

    this.source.readyState = this.source.OPEN
    this.source.emit('open', new Event('open'))
  }

  dispatchMessage(message: MilkyEvent): void {
    if (this._closed) {
      return
    }

    const readonlyMessage = makeDeepReadonly(message)
    this.source.emit('push', readonlyMessage)

    if (this._closed) {
      return
    }

    this.source.emit(readonlyMessage.event_type, readonlyMessage as never)
  }

  dispatchError(error: unknown): void {
    if (this._closed) {
      return
    }

    this.source.emit('error', new ErrorEvent('error', {
      error,
      message: error instanceof Error ? error.message : String(error),
    }))
  }

  forwardFrom(source: MilkyEventSource): () => void {
    const onOpen = () => {
      this.dispatchOpen()
    }

    const onPush = (event: MilkyEventSourceEventMap['push']) => {
      this.dispatchMessage(event as MilkyEvent)
    }

    const onError = (event: MilkyEventSourceEventMap['error']) => {
      this.dispatchError(event.error ?? event)
    }

    source.on('open', onOpen)
    source.on('push', onPush)
    source.on('error', onError)

    return () => {
      source.off('open', onOpen)
      source.off('push', onPush)
      source.off('error', onError)
    }
  }

  close(): void {
    if (this._closed) {
      return
    }

    this.markClosed()
    this._closeHandler()
  }
}

export class MilkyEventSourceImpl implements MilkyEventSource {
  private _closeListeners = new Set<() => void>()
  private _emitter = mitt<MilkyEventSourceEventMap>()

  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSED = 2
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2

  readyState = this.CONNECTING
  readonly controller: MilkyEventSourceController

  constructor(setup?: (controller: MilkyEventSourceController) => void) {
    this.controller = new MilkyEventSourceController(this)
    setup?.(this.controller)
  }

  close(): void {
    this.controller.close()
  }

  [Symbol.dispose](): void {
    this.close()
  }

  on<K extends MilkyEventSourceEventKey>(
    type: K,
    listener: (ev: MilkyEventSourceEventMap[K]) => any,
  ): void
  on(
    type: string,
    listener: (ev: unknown) => any,
  ): void
  on(type: string, listener: (ev: unknown) => any): void {
    this._emitter.on(type as never, listener as never)
  }

  off<K extends MilkyEventSourceEventKey>(
    type: K,
    listener: (ev: MilkyEventSourceEventMap[K]) => any,
  ): void
  off(
    type: string,
    listener: (ev: unknown) => any,
  ): void
  off(type: string, listener: (ev: unknown) => any): void {
    this._emitter.off(type as never, listener as never)
  }

  emit<K extends MilkyEventSourceEventKey>(
    type: K,
    event: MilkyEventSourceEventMap[K],
  ): void {
    this._emitter.emit(type, event)
  }

  [subscribeClose](listener: () => void): () => void {
    if (this.readyState === this.CLOSED) {
      listener()
      return () => {}
    }

    this._closeListeners.add(listener)
    return () => {
      this._closeListeners.delete(listener)
    }
  }

  [finishAsyncIteration](): void {
    const listeners = [...this._closeListeners]
    this._closeListeners.clear()
    for (const listener of listeners) {
      listener()
    }
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<ReadonlyMilkyEvent> {
    const queue: ReadonlyMilkyEvent[] = []
    const deferreds: Array<(result: IteratorResult<ReadonlyMilkyEvent>) => void> = []
    let done = this.readyState === this.CLOSED
    let unsubscribeClose = () => {}

    const cleanup = () => {
      // eslint-disable-next-line ts/no-use-before-define
      this.off('push', onPush)
      unsubscribeClose()
    }

    const finish = () => {
      if (done) {
        return
      }

      done = true
      cleanup()
      while (deferreds.length > 0) {
        deferreds.shift()!({
          done: true,
          value: undefined,
        })
      }
    }

    const onPush = (event: MilkyEventSourceEventMap['push']) => {
      if (done) {
        return
      }

      const deferred = deferreds.shift()
      if (deferred) {
        deferred({
          done: false,
          value: event,
        })
        return
      }

      queue.push(event)
    }

    if (!done) {
      this.on('push', onPush)
      unsubscribeClose = this[subscribeClose](finish)
    }

    return {
      next: async () => {
        const message = queue.shift()
        if (message) {
          return {
            done: false,
            value: message,
          }
        }

        if (done) {
          return {
            done: true,
            value: undefined,
          }
        }

        return await new Promise(resolve => deferreds.push(resolve))
      },
      return: async () => {
        finish()
        return {
          done: true,
          value: undefined,
        }
      },
      [Symbol.asyncIterator]() {
        return this
      },
    }
  }
}
