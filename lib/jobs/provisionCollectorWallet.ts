// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Provisioned enrolment, Path B (§7.1, D-05, gate G1, ROADMAP M1-6). For a
 * collector enrolled without an address while `custody.provisioning_enabled`,
 * mint an LNbits wallet + LNURLp and store it on the row. Idempotent — safe
 * to retry (pg-boss handles the backoff). Zero framework imports (D-04).
 */

import { eq } from 'drizzle-orm';
import { CollectorNotFoundError } from '@/lib/collectors';
import type { Database } from '@/lib/db/client';
import type { CollectorWalletProvisioner } from '@/lib/lightning/LNbitsProvider';
import { collectors } from '@/lib/db/schema';
import {
  provisionCollectorWalletPayloadSchema,
  type ProvisionCollectorWalletPayload,
} from './types';

export type { CollectorWalletProvisioner };

export async function provisionCollectorWallet(
  db: Database,
  provisioner: CollectorWalletProvisioner,
  rawPayload: ProvisionCollectorWalletPayload,
): Promise<void> {
  const { collectorId } = provisionCollectorWalletPayloadSchema.parse(rawPayload);

  const [collector] = await db.select().from(collectors).where(eq(collectors.id, collectorId));
  if (!collector) {
    throw new CollectorNotFoundError(collectorId);
  }

  // Defensive: only the provisioned path mints wallets, and never twice.
  if (collector.addressSource !== 'provisioned') {
    return;
  }
  if (collector.lnbitsWalletId || collector.lightningAddress || collector.lnurlPayRaw) {
    return;
  }

  const { lnbitsWalletId, lnurlp } = await provisioner.createCollectorWallet(collector.id);

  await db
    .update(collectors)
    .set({
      lnbitsWalletId,
      // An LNURLp bech32 string is the payable pointer; it is not an
      // address-shaped identifier, so `lightning_address` stays null (as with BYO LNURLs).
      lnurlPayRaw: lnurlp,
    })
    .where(eq(collectors.id, collector.id));
}
