// SPDX-License-Identifier: AGPL-3.0-only

import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { CollectorNotFoundError } from '@/lib/collectors';
import { getDb } from '@/lib/db/client';
import { resetCollectorTables } from '@/lib/testing/fixtures';
import { collectorPaymentDestinations, collectors } from '@/lib/db/schema';
import type { CollectorWalletProvisioner } from '@/lib/lightning/LNbitsProvider';
import { provisionCollectorWallet } from './provisionCollectorWallet';

const hasDatabase = Boolean(process.env.DATABASE_URL);

function fakeProvisioner(): CollectorWalletProvisioner & { calls: number } {
  const p = {
    calls: 0,
    async createCollectorWallet(label: string) {
      p.calls += 1;
      return { lnbitsWalletId: `wallet-for-${label}`, lnurlp: 'lnurl1fakeprovisioned' };
    },
  };
  return p;
}

describe.skipIf(!hasDatabase)('provisionCollectorWallet (integration)', () => {
  const db = hasDatabase ? getDb() : undefined!;

  beforeEach(async () => {
    await resetCollectorTables(db);
  });

  afterAll(async () => {
    await resetCollectorTables(db);
  });

  async function insertCollector(addressSource: 'byo' | 'provisioned'): Promise<string> {
    const [row] = await db
      .insert(collectors)
      .values({
        alias: 'Amina',
        addressSource,
        enrolledAt: new Date(),
        publicCode: 'TS-0001',
        status: 'active',
      })
      .returning({ id: collectors.id });
    return row!.id;
  }

  it('mints a wallet + LNURLp and stores them on the row', async () => {
    const id = await insertCollector('provisioned');
    const provisioner = fakeProvisioner();

    await provisionCollectorWallet(db, provisioner, { collectorId: id });

    const [row] = await db.select().from(collectors).where(eq(collectors.id, id));
    expect(provisioner.calls).toBe(1);
    expect(row?.lnbitsWalletId).toBe(`wallet-for-${id}`);
    expect(row?.lnurlPayRaw).toBe('lnurl1fakeprovisioned');
    expect(row?.lightningAddress).toBeNull();

    // Payouts read the destinations table, so the minted wallet is recorded there too.
    const destinations = await db
      .select()
      .from(collectorPaymentDestinations)
      .where(eq(collectorPaymentDestinations.collectorId, id));
    expect(destinations).toHaveLength(1);
    expect(destinations[0]).toMatchObject({
      type: 'lnurl_pay',
      address: 'lnurl1fakeprovisioned',
      status: 'verified',
      createdBy: null,
    });
  });

  it('is idempotent — a retry does not mint a second wallet', async () => {
    const id = await insertCollector('provisioned');
    const provisioner = fakeProvisioner();

    await provisionCollectorWallet(db, provisioner, { collectorId: id });
    await provisionCollectorWallet(db, provisioner, { collectorId: id });

    expect(provisioner.calls).toBe(1);
  });

  it('no-ops for a BYO collector (defensive)', async () => {
    const id = await insertCollector('byo');
    const provisioner = fakeProvisioner();

    await provisionCollectorWallet(db, provisioner, { collectorId: id });

    expect(provisioner.calls).toBe(0);
  });

  it('throws CollectorNotFoundError for an unknown id', async () => {
    const provisioner = fakeProvisioner();
    await expect(
      provisionCollectorWallet(db, provisioner, {
        collectorId: '00000000-0000-0000-0000-000000000000',
      }),
    ).rejects.toThrow(CollectorNotFoundError);
  });
});

describe('provisionCollectorWallet — payload validation (no DB)', () => {
  it('rejects a non-UUID collectorId', async () => {
    await expect(
      provisionCollectorWallet(null as never, fakeProvisioner(), { collectorId: 'nope' }),
    ).rejects.toThrow();
  });
});
