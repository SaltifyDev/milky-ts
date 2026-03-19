export class FakeWebSocket extends EventTarget {
  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSING = 2
  readonly CLOSED = 3

  readyState = this.CONNECTING
  closeCalls = 0

  constructor(readonly url?: string | URL) {
    super()
  }

  open(): void {
    if (this.readyState === this.CLOSED) {
      return
    }

    this.readyState = this.OPEN
    this.dispatchEvent(new Event('open'))
  }

  sendMessage(data: unknown): void {
    this.sendRawMessage(JSON.stringify(data))
  }

  sendRawMessage(data: string): void {
    this.dispatchEvent(new MessageEvent('message', {
      data,
    }))
  }

  fail(event: Event = new Event('error')): void {
    this.dispatchEvent(event)
  }

  close(): void {
    this.closeCalls += 1

    if (this.readyState === this.CLOSED) {
      return
    }

    this.readyState = this.CLOSED
    this.dispatchEvent(new Event('close'))
  }
}

export class FakeEventSource extends EventTarget {
  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSED = 2

  readyState = this.CONNECTING
  closeCalls = 0

  constructor(readonly url?: string | URL) {
    super()
  }

  open(): void {
    if (this.readyState === this.CLOSED) {
      return
    }

    this.readyState = this.OPEN
    this.dispatchEvent(new Event('open'))
  }

  sendMessage(data: unknown): void {
    this.sendRawMessage(JSON.stringify(data))
  }

  sendRawMessage(data: string): void {
    this.dispatchEvent(new MessageEvent('milky_event', {
      data,
    }))
  }

  fail({ closed = false, event = new Event('error') }: { closed?: boolean, event?: Event } = {}): void {
    this.readyState = closed ? this.CLOSED : this.CONNECTING
    this.dispatchEvent(event)
  }

  close(): void {
    this.closeCalls += 1
    this.readyState = this.CLOSED
  }
}
