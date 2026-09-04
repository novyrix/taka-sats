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

export class TagRevokedError extends Error {
  constructor(tagId: string) {
    super(`Tag ${tagId} has been revoked`);
    this.name = 'TagRevokedError';
  }
}
