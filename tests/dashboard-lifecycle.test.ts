import { vi } from 'vitest'
import { DashboardLifecycle } from '../src/ui/dashboardLifecycle.js'

describe('DashboardLifecycle', () => {
  test('removes event listeners on teardown via abort signal', async () => {
    const lifecycle = new DashboardLifecycle()
    const target = new EventTarget()
    const handler = vi.fn()

    lifecycle.listen(target, 'ping', handler as EventListener)
    target.dispatchEvent(new Event('ping'))
    expect(handler).toHaveBeenCalledTimes(1)

    lifecycle.teardown()
    target.dispatchEvent(new Event('ping'))
    expect(handler).toHaveBeenCalledTimes(1)
  })

  test('prevents managed timeouts from firing after teardown', async () => {
    vi.useFakeTimers()
    const lifecycle = new DashboardLifecycle()
    const callback = vi.fn()

    lifecycle.setTimeout(callback, 50)
    lifecycle.teardown()
    await vi.advanceTimersByTimeAsync(60)

    expect(callback).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  test('runs registered teardown callbacks exactly once', () => {
    const lifecycle = new DashboardLifecycle()
    const disposer = vi.fn()

    lifecycle.onTeardown(disposer)
    lifecycle.teardown()
    lifecycle.teardown()

    expect(disposer).toHaveBeenCalledTimes(1)
  })
})
