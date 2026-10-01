// SPDX-License-Identifier: AGPL-3.0-only

export class TopupNotFoundError extends Error {
  constructor(what: string) {
    super(`Not found: ${what}`);
    this.name = 'TopupNotFoundError';
  }
}

/** The proposal is not in a state that allows the requested action. */
export class TopupStateError extends Error {
  constructor(
    public readonly status: string,
    action: string,
  ) {
    super(`Cannot ${action} a funding proposal in status "${status}"`);
    this.name = 'TopupStateError';
  }
}

/** Why a steward action was refused: the separation-of-duties rules (ADR-0020 §3) live here. */
export class TopupApprovalError extends Error {
  constructor(public readonly reason: 'not_permitted' | 'self_approval' | 'not_proposer') {
    super(
      reason === 'self_approval'
        ? 'The steward who proposed a top-up cannot approve or reject it; cancel it instead'
        : reason === 'not_proposer'
          ? 'Only the steward who proposed a top-up can cancel it; another steward rejects it'
          : 'This role cannot take part in the funding vote',
    );
    this.name = 'TopupApprovalError';
  }
}

/** A value the vote cannot accept: an amount that is not a positive whole number of sats, an empty reference. */
export class TopupInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TopupInputError';
  }
}

/** A proposal that would take the hot wallet above `treasury.hot_wallet_cap_sats`. */
export class TopupCapError extends Error {
  constructor(
    public readonly capSats: number,
    public readonly headroomSats: number,
  ) {
    super('The proposal would take the hot wallet above its cap');
    this.name = 'TopupCapError';
  }
}

/** The hot wallet's balance could not be read, and the action needs it. Nothing is guessed. */
export class TopupFloatUnavailableError extends Error {
  constructor() {
    super('The hot-wallet float could not be read');
    this.name = 'TopupFloatUnavailableError';
  }
}

/** A resent request that does not match what is already stored (same id, other content). */
export class TopupConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TopupConflictError';
  }
}
