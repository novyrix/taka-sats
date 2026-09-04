// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Attach a bring-your-own receive address (§7.1 Path A). The raw scanned/
 * submitted code is validated receive-capable and resolvable by the active
 * `LightningProvider` before it ever touches the collector row — a withdraw
 * (`LNURLw`) code is rejected here (ADR-0001, M1-10), not merely at the UI.
 */

import { eq } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';
import { collectors } from '@/lib/db/schema';
import type { LightningProvider } from '@/lib/lightning/LightningProvider';
import { isLightningAddress } from '@/lib/lightning/lnurl';
import { CollectorNotFoundError } from './errors';
import {
  type AttachByoAddressInput,
  attachByoAddressInputSchema,
  type CollectorRecord,
} from './types';

export async function attachByoAddress(
  db: Database,
  provider: Pick<LightningProvider, 'resolveReceiveAddress'>,
  input: AttachByoAddressInput,
): Promise<CollectorRecord> {
  const parsed = attachByoAddressInputSchema.parse(input);

  // Throws NotReceiveCapableError / InvalidLightningAddressError on a bad code.
  await provider.resolveReceiveAddress(parsed.rawCode);

  const [row] = await db
    .update(collectors)
    .set({
      addressSource: 'byo',
      lnurlPayRaw: parsed.rawCode,
      // A raw LNURL/QR payload isn't itself a payable Lightning Address —
      // only set the address column when the code is address-shaped.
      lightningAddress: isLightningAddress(parsed.rawCode) ? parsed.rawCode : null,
    })
    .where(eq(collectors.id, parsed.collectorId))
    .returning();

  if (!row) {
    throw new CollectorNotFoundError(parsed.collectorId);
  }
  return row;
}
