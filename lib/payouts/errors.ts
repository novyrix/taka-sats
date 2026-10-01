// SPDX-License-Identifier: AGPL-3.0-only

export class PayoutNotFoundError extends Error {
  constructor(what: string) {
    super(`Not found: ${what}`);
    this.name = 'PayoutNotFoundError';
  }
}

/** The payout is not in a state that allows the requested action. */
export class PayoutStateError extends Error {
  constructor(
    public readonly status: string,
    action: string,
  ) {
    super(`Cannot ${action} a payout in status "${status}"`);
    this.name = 'PayoutStateError';
  }
}

/** Why an approval was refused — the separation-of-duties rule (FR-3.2) lives here. */
export class PayoutApprovalError extends Error {
  constructor(public readonly reason: 'not_permitted' | 'self_approval') {
    super(
      reason === 'self_approval'
        ? 'The supervisor who recorded the collection cannot approve its payout'
        : 'This role cannot approve payouts',
    );
    this.name = 'PayoutApprovalError';
  }
}

/** A pagination cursor that did not come from this API. */
export class PayoutCursorError extends Error {
  constructor() {
    super('Invalid pagination cursor');
    this.name = 'PayoutCursorError';
  }
}

/**
 * Why a stuck-payout resolution (or provider check) was refused. Every reason is a rule that
 * stops one person, one mistake or one forged reference from settling money on their own.
 */
export class PayoutResolveError extends Error {
  constructor(
    public readonly reason:
      | 'not_permitted'
      | 'not_resolvable'
      | 'self_resolution'
      | 'reference_required'
      | 'reference_in_use'
      | 'reference_mismatch'
      | 'provider_disagrees'
      | 'resolution_final'
      | 'nothing_to_check',
    message: string,
  ) {
    super(message);
    this.name = 'PayoutResolveError';
  }
}
