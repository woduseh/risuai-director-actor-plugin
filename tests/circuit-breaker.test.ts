import { CircuitBreaker } from '../src/runtime/circuitBreaker.js'

describe('CircuitBreaker', () => {
  test('opens after threshold failures and closes after cooldown', () => {
    let now = 1_000
    const breaker = new CircuitBreaker(3, 500, () => now)

    expect(breaker.isOpen()).toBe(false)

    breaker.recordFailure('a')
    breaker.recordFailure('b')
    breaker.recordFailure('c')

    expect(breaker.isOpen()).toBe(true)
    expect(breaker.getState().failures).toBe(3)

    now += 499
    expect(breaker.isOpen()).toBe(true)

    now += 2
    expect(breaker.isOpen()).toBe(false)
  })

  test('resets failure count on success', () => {
    const breaker = new CircuitBreaker(2, 1000)

    breaker.recordFailure('a')
    breaker.recordSuccess()

    expect(breaker.getState().failures).toBe(0)
  })

  test('stays closed when failures are below threshold', () => {
    const breaker = new CircuitBreaker(3, 1000)

    breaker.recordFailure('x')
    breaker.recordFailure('y')

    expect(breaker.isOpen()).toBe(false)
    expect(breaker.getState().failures).toBe(2)
  })

  test('getState returns serializable snapshot', () => {
    let now = 5000
    const breaker = new CircuitBreaker(2, 300, () => now)

    breaker.recordFailure('err1')
    breaker.recordFailure('err2')

    const state = breaker.getState()
    expect(state).toEqual({
      failures: 2,
      open: true,
      lastFailureReason: 'err2',
      openedAt: 5000,
      cooldownMs: 300,
      threshold: 2,
    })

    // verify JSON-round-trip (serializable)
    expect(JSON.parse(JSON.stringify(state))).toEqual(state)
  })

  test('auto-close after cooldown resets failures', () => {
    let now = 0
    const breaker = new CircuitBreaker(1, 100, () => now)

    breaker.recordFailure('boom')
    expect(breaker.isOpen()).toBe(true)

    now = 100
    expect(breaker.isOpen()).toBe(false)
    expect(breaker.getState().failures).toBe(0)
  })

  test('records lastFailureReason correctly', () => {
    const breaker = new CircuitBreaker(5, 1000)

    breaker.recordFailure('first')
    breaker.recordFailure('second')

    expect(breaker.getState().lastFailureReason).toBe('second')
  })

  test('success clears lastFailureReason', () => {
    const breaker = new CircuitBreaker(5, 1000)

    breaker.recordFailure('oops')
    breaker.recordSuccess()

    expect(breaker.getState().lastFailureReason).toBeNull()
  })

  test('can re-open after auto-close if new failures hit threshold', () => {
    let now = 0
    const breaker = new CircuitBreaker(2, 100, () => now)

    breaker.recordFailure('a')
    breaker.recordFailure('b')
    expect(breaker.isOpen()).toBe(true)

    now = 200 // cooldown passes
    expect(breaker.isOpen()).toBe(false)

    // new failures re-open
    breaker.recordFailure('c')
    breaker.recordFailure('d')
    expect(breaker.isOpen()).toBe(true)
    expect(breaker.getState().openedAt).toBe(200)
  })
})
