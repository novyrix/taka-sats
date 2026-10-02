// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Credential-login throttle. Counts FAILED sign-ins per identifier in a sliding window; once an
 * identifier has `maxFailures` of them, every attempt for it is refused (even with the right
 * password, or the lock would only slow a guesser down) until the oldest failure ages out.
 *
 * Why per identifier and not per IP: behind the Vercel/Cloudflare proxy every caller shares an
 * address and a forwarded header is attacker-controlled. The cost is that someone can lock a known
 * identifier out for one window; that is a nuisance, not a breach, and the window is short.
 *
 * In memory, per process (a restart resets it). The store is bounded so random identifiers cannot
 * grow it without limit. Pure apart from the clock, which is injectable.
 */

export type ThrottleOptions = {
  readonly maxFailures: number;
  readonly windowMs: number;
  /** Most identifiers tracked at once; beyond it the oldest are dropped. */
  readonly maxTracked?: number;
  readonly now?: () => number;
};

export class LoginThrottle {
  private readonly failures = new Map<string, number[]>();
  private readonly now: () => number;
  private readonly maxTracked: number;

  constructor(private readonly options: ThrottleOptions) {
    this.now = options.now ?? Date.now;
    this.maxTracked = options.maxTracked ?? 10_000;
  }

  private static key(identifier: string): string {
    return identifier.trim().toLowerCase().normalize('NFKC');
  }

  private recent(key: string): number[] {
    const cutoff = this.now() - this.options.windowMs;
    const kept = (this.failures.get(key) ?? []).filter((at) => at > cutoff);
    if (kept.length === 0) {
      this.failures.delete(key);
    } else {
      this.failures.set(key, kept);
    }
    return kept;
  }

  get enabled(): boolean {
    return this.options.maxFailures > 0;
  }

  /** True when this identifier may not attempt a login right now. */
  isLocked(identifier: string): boolean {
    return (
      this.enabled && this.recent(LoginThrottle.key(identifier)).length >= this.options.maxFailures
    );
  }

  /** Seconds until the identifier may try again (0 when it is not locked). */
  retryAfterSeconds(identifier: string): number {
    if (!this.isLocked(identifier)) {
      return 0;
    }
    const oldest = this.recent(LoginThrottle.key(identifier))[0] ?? this.now();
    return Math.max(1, Math.ceil((oldest + this.options.windowMs - this.now()) / 1000));
  }

  recordFailure(identifier: string): void {
    if (!this.enabled) {
      return;
    }
    const key = LoginThrottle.key(identifier);
    const list = this.recent(key);
    list.push(this.now());
    this.failures.set(key, list);
    while (this.failures.size > this.maxTracked) {
      const oldest = this.failures.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.failures.delete(oldest);
    }
  }

  /** A successful sign-in clears the identifier's failures. */
  recordSuccess(identifier: string): void {
    this.failures.delete(LoginThrottle.key(identifier));
  }
}
