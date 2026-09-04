// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Enrol a collector (§7.1, FR-1.2, US-1.1). One required field: `alias`. No
 * ID, phone, DOB, address, or literacy step — the earn-first principle.
 */

import { getSettings } from '@/lib/config';
import type { Database } from '@/lib/db/client';
import { collectors } from '@/lib/db/schema';
import { ProvisioningDisabledError } from './errors';
import { type CollectorRecord, type EnrolCollectorInput, enrolCollectorInputSchema } from './types';

/**
 * Create a `collectors` row with `status = 'active'`. `addressSource`
 * defaults to `custody.default_address_source`; requesting `'provisioned'`
 * while `custody.provisioning_enabled` is false is rejected (gate G1).
 *
 * The Lightning Address itself is attached in a later step — {@link
 * import('./address').attachByoAddress} for BYO, or the M1-6 provisioning
 * job for `provisioned`. A collector with no address yet can still be
 * weighed; payout simply waits (FR-7.4).
 */
export async function enrolCollector(
  db: Database,
  input: EnrolCollectorInput,
): Promise<CollectorRecord> {
  const parsed = enrolCollectorInputSchema.parse(input);
  const settings = getSettings();
  const addressSource = parsed.addressSource ?? settings.custody.default_address_source;

  if (addressSource === 'provisioned' && !settings.custody.provisioning_enabled) {
    throw new ProvisioningDisabledError();
  }

  const [row] = await db
    .insert(collectors)
    .values({ alias: parsed.alias, addressSource, enrolledAt: new Date() })
    .returning();

  if (!row) {
    throw new Error('enrolCollector: insert returned no row');
  }
  return row;
}
