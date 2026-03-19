import { expect, it } from 'vitest'
import {
  createTimeout,
  joinURL,
  raceWithAbort,
  sleep,
  sleepWithAbort,
  toArray,
  withTimeout,
} from '@/utils'

it('converts single values and arrays to arrays', () => {
  expect(toArray(1)).toEqual([1])
  expect(toArray([1, 2])).toEqual([1, 2])
})

it('sleeps asynchronously', async () => {
  let settled = false
  const pending = sleep(0).then(() => {
    settled = true
  })

  expect(settled).toBe(false)
  await pending
  expect(settled).toBe(true)
})

it('creates timeout rejections and runs callbacks', async () => {
  let timedOut = false
  const timeout = createTimeout(5, () => {
    timedOut = true
  })

  await expect(timeout.promise).rejects.toThrow('milky: timed out after 5ms')
  expect(timedOut).toBe(true)
})

it('creates inert timeouts when no duration is provided', async () => {
  const timeout = createTimeout()
  const outcome = await Promise.race([
    timeout.promise.then(() => 'resolved', () => 'rejected'),
    sleep(5).then(() => 'pending'),
  ])

  timeout.cancel()

  expect(outcome).toBe('pending')
})

it('resolves timed promises from promise and function inputs', async () => {
  await expect(withTimeout(Promise.resolve('value'), 20)).resolves.toBe('value')
  await expect(withTimeout(async () => 'value', 20)).resolves.toBe('value')
})

it('races promises with abort signals', async () => {
  await expect(raceWithAbort(undefined, Promise.resolve('value'), () => {})).resolves.toBe('value')

  const alreadyAborted = new AbortController()
  alreadyAborted.abort()
  let immediateAbortCalls = 0

  await expect(raceWithAbort(alreadyAborted.signal, Promise.resolve('value'), () => {
    immediateAbortCalls += 1
  })).rejects.toThrow('aborted')
  expect(immediateAbortCalls).toBe(1)

  const controller = new AbortController()
  let abortCalls = 0
  const pending = raceWithAbort(controller.signal, new Promise<string>(() => {}), () => {
    abortCalls += 1
  })

  controller.abort()

  await expect(pending).rejects.toThrow('aborted')
  expect(abortCalls).toBe(1)
})

it('sleeps with abort support', async () => {
  await expect(sleepWithAbort(new AbortController().signal, 1)).resolves.toBeUndefined()

  const controller = new AbortController()
  const pending = sleepWithAbort(controller.signal, 20)
  controller.abort()

  await expect(pending).rejects.toThrow('milky: reconnect aborted')

  const alreadyAborted = new AbortController()
  alreadyAborted.abort()
  await expect(sleepWithAbort(alreadyAborted.signal, 1)).rejects.toThrow('milky: reconnect aborted')
})

it('joins URLs against normalized base paths', () => {
  expect(joinURL('https://example.com/base', '/events').toString()).toBe('https://example.com/events')
  expect(joinURL('https://example.com/base', 'api/get_login_info').toString()).toBe('https://example.com/base/api/get_login_info')
  expect(joinURL(new URL('https://example.com/base/'), 'events').toString()).toBe('https://example.com/base/events')
})
