// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { LoginThrottle } from './throttle';

function make(over: Partial<ConstructorParameters<typeof LoginThrottle>[0]> = {}) {
  const clock = { t: 1_000_000 };
  const throttle = new LoginThrottle({
    maxFailures: 3,
    windowMs: 60_000,
    now: () => clock.t,
    ...over,
  });
  return { throttle, clock };
}

describe('LoginThrottle', () => {
  it('locks an identifier after the maximum failures, and says for how long', () => {
    const { throttle, clock } = make();
    for (let i = 0; i < 2; i++) {
      throttle.recordFailure('+254700000001');
    }
    expect(throttle.isLocked('+254700000001')).toBe(false);
    throttle.recordFailure('+254700000001');
    expect(throttle.isLocked('+254700000001')).toBe(true);
    expect(throttle.retryAfterSeconds('+254700000001')).toBe(60);
    clock.t += 30_000;
    expect(throttle.retryAfterSeconds('+254700000001')).toBe(30);
  });

  it('lets the identifier back in once the oldest failure ages out of the window', () => {
    const { throttle, clock } = make();
    for (let i = 0; i < 3; i++) {
      throttle.recordFailure('a');
      clock.t += 10_000;
    }
    expect(throttle.isLocked('a')).toBe(true);
    clock.t += 31_000; // the first failure is now older than the window
    expect(throttle.isLocked('a')).toBe(false);
  });

  it('a lock is per identifier: another account is unaffected', () => {
    const { throttle } = make();
    for (let i = 0; i < 3; i++) {
      throttle.recordFailure('victim');
    }
    expect(throttle.isLocked('victim')).toBe(true);
    expect(throttle.isLocked('someone-else')).toBe(false);
  });

  it('case, spacing and unicode variants of an identifier share one counter (no bypass by re-spelling)', () => {
    const { throttle } = make();
    throttle.recordFailure('Admin@Example.com');
    throttle.recordFailure(' admin@example.com ');
    throttle.recordFailure('ADMIN@EXAMPLE.COM');
    expect(throttle.isLocked('admin@example.com')).toBe(true);
    expect(throttle.isLocked('ａｄｍｉｎ@example.com')).toBe(true); // full-width letters
  });

  it('a success clears the failures', () => {
    const { throttle } = make();
    throttle.recordFailure('a');
    throttle.recordFailure('a');
    throttle.recordSuccess('a');
    throttle.recordFailure('a');
    expect(throttle.isLocked('a')).toBe(false);
  });

  it('maxFailures 0 turns it off', () => {
    const { throttle } = make({ maxFailures: 0 });
    for (let i = 0; i < 50; i++) {
      throttle.recordFailure('a');
    }
    expect(throttle.enabled).toBe(false);
    expect(throttle.isLocked('a')).toBe(false);
  });

  it('does not grow without bound under random identifiers', () => {
    const { throttle } = make({ maxTracked: 100 });
    for (let i = 0; i < 1000; i++) {
      throttle.recordFailure(`id-${i}`);
    }
    // The oldest were dropped, the newest are still tracked.
    expect(throttle.isLocked('id-999')).toBe(false);
    for (let i = 0; i < 2; i++) {
      throttle.recordFailure('id-999');
    }
    expect(throttle.isLocked('id-999')).toBe(true);
    expect(throttle['failures'].size).toBeLessThanOrEqual(100);
  });
});
