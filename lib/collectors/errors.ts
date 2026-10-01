// SPDX-License-Identifier: AGPL-3.0-only

export class CollectorNotFoundError extends Error {
  constructor(collectorId: string) {
    super(`Collector not found: ${collectorId}`);
    this.name = 'CollectorNotFoundError';
  }
}

export class ProvisioningDisabledError extends Error {
  constructor() {
    super(
      "address_source 'provisioned' requires custody.provisioning_enabled = true (gate G1); see lib/config/schema.ts",
    );
    this.name = 'ProvisioningDisabledError';
  }
}

/** The tag id is already the active mapping for a different collector. */
export class TagAlreadyActiveError extends Error {
  constructor(tagId: string) {
    super(`Tag ${tagId} is already the active mapping for another collector`);
    this.name = 'TagAlreadyActiveError';
  }
}

/** The collector is not `active` (D-25): pending authorization, or revoked. */
export class CollectorNotAuthorizedError extends Error {
  constructor(
    collectorId: string,
    public readonly status: string,
  ) {
    super(`Collector ${collectorId} is not authorized (status: ${status})`);
    this.name = 'CollectorNotAuthorizedError';
  }
}

/** The address is already the live payout destination of another collector (D-26). */
export class DestinationInUseError extends Error {
  constructor() {
    // Deliberately generic: never reveal which collector holds the address.
    super('This payment destination is already in use');
    this.name = 'DestinationInUseError';
  }
}

/** Replacing a verified destination needs `collector:authorize` (D-26). */
export class DestinationReplaceForbiddenError extends Error {
  constructor() {
    super('Replacing a collector’s verified payment destination requires hub_lead or admin');
    this.name = 'DestinationReplaceForbiddenError';
  }
}

/**
 * A supervisor may manage the payout wallet only of a collector THEY registered (D-26): the
 * wallet is what authorization vouches for, so it cannot be set by someone who never met them.
 */
export class CollectorNotYoursError extends Error {
  constructor() {
    super('Only the supervisor who registered this collector, or staff, can manage their wallet');
    this.name = 'CollectorNotYoursError';
  }
}

export class DestinationNotFoundError extends Error {
  constructor(destinationId: string) {
    super(`Payment destination not found: ${destinationId}`);
    this.name = 'DestinationNotFoundError';
  }
}

export class TagRevokedError extends Error {
  constructor(tagId: string) {
    super(`Tag ${tagId} has been revoked`);
    this.name = 'TagRevokedError';
  }
}
