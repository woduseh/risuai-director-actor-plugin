export class DashboardLifecycle {
  private ac = new AbortController()
  private timers: ReturnType<typeof globalThis.setTimeout>[] = []
  private callbacks: (() => void)[] = []
  private tornDown = false

  listen(
    target: EventTarget,
    type: string,
    handler: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, handler, { ...options, signal: this.ac.signal })
  }

  setTimeout(cb: () => void, ms: number): void {
    const id = globalThis.setTimeout(cb, ms)
    this.timers.push(id)
  }

  onTeardown(cb: () => void): void {
    this.callbacks.push(cb)
  }

  teardown(): void {
    if (this.tornDown) return
    this.tornDown = true

    this.ac.abort()
    for (const id of this.timers) globalThis.clearTimeout(id)
    this.timers.length = 0
    for (const cb of this.callbacks) cb()
    this.callbacks.length = 0
  }
}
