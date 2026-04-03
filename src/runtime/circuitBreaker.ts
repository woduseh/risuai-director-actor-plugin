export interface CircuitBreakerState {
  failures: number;
  open: boolean;
  lastFailureReason: string | null;
  openedAt: number | null;
  cooldownMs: number;
  threshold: number;
}

export class CircuitBreaker {
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly clock: () => number;

  private failures = 0;
  private open = false;
  private lastFailureReason: string | null = null;
  private openedAt: number | null = null;

  constructor(
    threshold: number,
    cooldownMs: number,
    clock: () => number = Date.now,
  ) {
    this.threshold = threshold;
    this.cooldownMs = cooldownMs;
    this.clock = clock;
  }

  recordFailure(reason: string): void {
    this.failures++;
    this.lastFailureReason = reason;
    if (this.failures >= this.threshold) {
      this.open = true;
      this.openedAt = this.clock();
    }
  }

  recordSuccess(): void {
    this.failures = 0;
    this.open = false;
    this.openedAt = null;
    this.lastFailureReason = null;
  }

  isOpen(): boolean {
    if (!this.open) return false;
    if (this.openedAt !== null && this.clock() - this.openedAt >= this.cooldownMs) {
      this.open = false;
      this.failures = 0;
      this.openedAt = null;
      return false;
    }
    return true;
  }

  getState(): CircuitBreakerState {
    return {
      failures: this.failures,
      open: this.isOpen(),
      lastFailureReason: this.lastFailureReason,
      openedAt: this.openedAt,
      cooldownMs: this.cooldownMs,
      threshold: this.threshold,
    };
  }
}
