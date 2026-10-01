// SPDX-License-Identifier: AGPL-3.0-only

import { count, eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db/client';
import { anomalyFlags, ledgerEntries, sessions } from '@/lib/db/schema';
import { verifyChain } from '@/lib/ledger';
import { createCollector } from '@/lib/testing/fixtures';
import { seedEvent, seedPaidPayout } from '@/lib/testing/fraud-fixtures';
import {
  NOW,
  PAYOUT_TRUNCATE,
  type PayoutWorld,
  seedPayoutWorld,
} from '@/lib/testing/payout-fixtures';
import { AnomalyReviewError } from './errors';
import { getAnomaly, listAnomalies, reviewAnomaly } from './anomalies';
import { detectPayoutConcentration } from './concentration';
import { runEventDetectors } from './detectors';
import { raiseFlag } from './flags';
import {
  computeReconciliation,
  listReconciliationReports,
  reconciliationPeriodSchema,
  runReconciliation,
} from './reconciliation';
import { recordRecyclerSale, recyclerSaleInputSchema } from './recycler-sales';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('lib/fraud (integration)', () => {
  const db = hasDatabase ? getDb() : undefined!;
  let world: PayoutWorld;

  beforeEach(async () => {
    world = await seedPayoutWorld(db);
  });
  afterAll(async () => {
    await db.execute(PAYOUT_TRUNCATE);
  });

  const flagsOf = async (type: string) =>
    db.select().from(anomalyFlags).where(eq(anomalyFlags.flagType, type));
  const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

  describe('duplicate_photo', () => {
    it('flags the LATER event that reuses a photo — across collectors and supervisors', async () => {
      const original = await seedEvent(db, world, { photoSha256: 'd'.repeat(64) });
      const other = await createCollector(db, { alias: 'Other', publicCode: 'TS-9001' });
      const copy = await seedEvent(db, world, {
        photoSha256: 'd'.repeat(64),
        collectorId: other.id,
        supervisorId: world.otherSupervisorId,
      });

      await runEventDetectors(db, original);
      expect(await flagsOf('duplicate_photo')).toHaveLength(0);

      await runEventDetectors(db, copy);
      const [flag] = await flagsOf('duplicate_photo');
      expect(flag).toMatchObject({
        collectionEventId: copy,
        collectorId: other.id,
        supervisorId: world.otherSupervisorId,
        sessionId: world.sessionId,
        context: { duplicateOfEventId: original, sameCollector: false },
      });
    });

    it('is idempotent — a re-run adds no second flag', async () => {
      await seedEvent(db, world, { photoSha256: 'd'.repeat(64) });
      const copy = await seedEvent(db, world, { photoSha256: 'd'.repeat(64) });
      await runEventDetectors(db, copy);
      await runEventDetectors(db, copy);
      expect(await flagsOf('duplicate_photo')).toHaveLength(1);
    });
  });

  describe('identical_weight_repeat (N = 4)', () => {
    const weigh = (minute: number, weightKg = '2.500', extra = {}) =>
      seedEvent(db, world, { weightKg, recordedAt: at(minute), ...extra });

    it('does not fire on the 3rd identical weight, fires on exactly the 4th, and again on the 5th', async () => {
      const ids = [await weigh(1), await weigh(2), await weigh(3)];
      await runEventDetectors(db, ids[2]!);
      expect(await flagsOf('identical_weight_repeat')).toHaveLength(0);

      const fourth = await weigh(4);
      await runEventDetectors(db, fourth);
      const flags = await flagsOf('identical_weight_repeat');
      expect(flags.map((f) => f.collectionEventId)).toEqual([fourth]);

      const fifth = await weigh(5);
      await runEventDetectors(db, fifth);
      expect(await flagsOf('identical_weight_repeat')).toHaveLength(2);

      await runEventDetectors(db, fifth); // idempotent
      expect(await flagsOf('identical_weight_repeat')).toHaveLength(2);
    });

    it('a different weight, material or supervisor breaks the run', async () => {
      await weigh(1);
      await weigh(2);
      await weigh(3, '2.501');
      const fourth = await weigh(4);
      await runEventDetectors(db, fourth);
      expect(await flagsOf('identical_weight_repeat')).toHaveLength(0);

      await weigh(10, '3.000');
      await weigh(11, '3.000');
      await weigh(12, '3.000', { material: 'HDPE' });
      const last = await weigh(13, '3.000', { supervisorId: world.otherSupervisorId });
      await runEventDetectors(db, last);
      expect(await flagsOf('identical_weight_repeat')).toHaveLength(0);
    });

    it('judges capture order, not arrival order — the late-arriving first weight completes the run', async () => {
      await weigh(2);
      await weigh(3);
      const last = await weigh(4);
      const first = await weigh(1); // arrives last, but was weighed first
      await runEventDetectors(db, first);
      expect((await flagsOf('identical_weight_repeat')).map((f) => f.collectionEventId)).toEqual([
        last,
      ]);
    });
  });

  describe('gps_outlier', () => {
    // A box around (lat -1.29, lng 36.82).
    const bounds = {
      type: 'Polygon',
      coordinates: [
        [
          [36.8, -1.3],
          [36.84, -1.3],
          [36.84, -1.28],
          [36.8, -1.28],
          [36.8, -1.3],
        ],
      ],
    };
    beforeEach(async () => {
      await db.update(sessions).set({ geoBounds: bounds }).where(eq(sessions.id, world.sessionId));
    });

    it('flags a fix outside the session bounds', async () => {
      const id = await seedEvent(db, world, { gps: { lat: -1.5, lng: 36.82 } });
      await runEventDetectors(db, id);
      const [flag] = await flagsOf('gps_outlier');
      expect(flag).toMatchObject({ collectionEventId: id, context: { lat: -1.5, lng: 36.82 } });
    });

    it('does not flag inside, on the edge, with no fix, or with no bounds', async () => {
      const inside = await seedEvent(db, world, { gps: { lat: -1.29, lng: 36.82 } });
      const onEdge = await seedEvent(db, world, { gps: { lat: -1.3, lng: 36.82 } });
      const noFix = await seedEvent(db, world);
      for (const id of [inside, onEdge, noFix]) {
        await runEventDetectors(db, id);
      }
      await db.update(sessions).set({ geoBounds: null }).where(eq(sessions.id, world.sessionId));
      const unbounded = await seedEvent(db, world, { gps: { lat: 50, lng: 50 } });
      await runEventDetectors(db, unbounded);
      expect(await flagsOf('gps_outlier')).toHaveLength(0);
    });
  });

  describe('weight_outlier (min events 20, k 6)', () => {
    /** `n` prior PET events weighing 2.0–3.0 kg in 0.1 steps (median 2.5). */
    async function history(n: number) {
      for (let i = 0; i < n; i += 1) {
        await seedEvent(db, world, { weightKg: (2 + (i % 11) / 10).toFixed(3) });
      }
    }

    it('stays silent with fewer than 20 prior events, however wild the weight', async () => {
      await history(19);
      const wild = await seedEvent(db, world, { weightKg: '900.000' });
      await runEventDetectors(db, wild);
      expect(await flagsOf('weight_outlier')).toHaveLength(0);
    });

    it('flags a wild weight once there are 20 prior events, not an ordinary one', async () => {
      await history(20);
      const ordinary = await seedEvent(db, world, { weightKg: '2.700' });
      const wild = await seedEvent(db, world, { weightKg: '900.000' });
      await runEventDetectors(db, ordinary);
      expect(await flagsOf('weight_outlier')).toHaveLength(0);
      await runEventDetectors(db, wild);
      const [flag] = await flagsOf('weight_outlier');
      expect(flag).toMatchObject({
        collectionEventId: wild,
        context: { material: 'PET', weightKg: '900.000', history: 21 },
      });
    });

    it('judges each material on its own history', async () => {
      await history(20);
      const firstHdpe = await seedEvent(db, world, { material: 'HDPE', weightKg: '900.000' });
      await runEventDetectors(db, firstHdpe);
      expect(await flagsOf('weight_outlier')).toHaveLength(0);
    });
  });

  describe('payout_concentration', () => {
    /** Paid sats per collector: one event each, 1 sat per 0.01 kg is irrelevant — sats are given directly. */
    async function paidSession(satsPerCollector: number[]) {
      for (const [i, sats] of satsPerCollector.entries()) {
        const collector = await createCollector(db, { publicCode: `TS-${8000 + i}` });
        const event = await seedEvent(db, world, { collectorId: collector.id });
        await seedPaidPayout(db, event, collector.id, sats);
      }
    }

    it('flags a session whose paid sats are concentrated (Gini ≥ threshold), once while open', async () => {
      await paidSession([400, 400, 400, 400, 40_000]);
      const first = await detectPayoutConcentration(db, world.sessionId);
      expect(first).toMatchObject({ collectors: 5, flagged: true });
      expect(first.gini).toBeGreaterThan(0.6);

      expect((await detectPayoutConcentration(db, world.sessionId)).flagged).toBe(false);
      const [flag] = await flagsOf('payout_concentration');
      expect(flag).toMatchObject({ sessionId: world.sessionId, collectionEventId: null });
      expect(await flagsOf('payout_concentration')).toHaveLength(1);
    });

    it('does not flag an even spread, nor fewer than 5 collectors however skewed', async () => {
      await paidSession([1000, 1000, 1000, 1000, 1000]);
      expect((await detectPayoutConcentration(db, world.sessionId)).flagged).toBe(false);

      await db.execute(PAYOUT_TRUNCATE);
      world = await seedPayoutWorld(db);
      await paidSession([1, 1, 1, 100_000]);
      const four = await detectPayoutConcentration(db, world.sessionId);
      expect(four).toMatchObject({ collectors: 4, flagged: false });
      expect(await flagsOf('payout_concentration')).toHaveLength(0);
    });
  });

  describe('recycler sales', () => {
    const sale = (over = {}) =>
      recyclerSaleInputSchema.parse({
        material: 'PET',
        grossKg: 10.5,
        tareKg: 0.25,
        buyer: 'Kibera Recyclers',
        soldAt: '2026-06-10T12:00:00Z',
        ...over,
      });

    it('computes the net weight exactly and anchors the sale on the ledger atomically', async () => {
      const { sale: recorded, created } = await recordRecyclerSale(db, sale(), world.adminId);
      expect(created).toBe(true);
      expect(recorded).toMatchObject({ grossKg: 10.5, tareKg: 0.25, weightKg: 10.25 });

      const [entry] = await db
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.id, recorded.id));
      expect(entry).toMatchObject({ entryType: 'recycler_sale', seq: recorded.ledgerSeq });
      expect(await verifyChain(db)).toMatchObject({ ok: true });
    });

    it('is idempotent on the client id and writes no second ledger entry', async () => {
      const id = '7d1f4a6e-3b52-4c80-9a11-0f2e5d6c7b88';
      const first = await recordRecyclerSale(db, sale({ id }), world.adminId);
      const second = await recordRecyclerSale(db, sale({ id, grossKg: 99 }), world.adminId);
      expect(second.created).toBe(false);
      expect(second.sale).toEqual(first.sale);
      const [ledger] = await db.select({ n: count() }).from(ledgerEntries);
      expect(ledger?.n).toBe(1);
    });

    it('rejects tare above gross, a 4th decimal and a non-positive gross', () => {
      expect(() => sale({ grossKg: 5, tareKg: 5.001 })).toThrow();
      expect(() => sale({ grossKg: 5.0001 })).toThrow();
      expect(() => sale({ grossKg: 0 })).toThrow();
      expect(sale({ grossKg: 5, tareKg: 5 })).toMatchObject({ grossKg: 5, tareKg: 5 }); // net 0 is allowed
    });
  });

  describe('reconciliation', () => {
    const period = (over = {}) =>
      reconciliationPeriodSchema.parse({
        from: '2026-06-10T00:00:00Z',
        to: '2026-06-11T00:00:00Z',
        ...over,
      });

    /** `kg` of PET collected inside the period, in 25 kg events (max one event is 999.999). */
    async function collect(kg: number, material = 'PET') {
      const ids: string[] = [];
      for (let left = kg; left > 0; left -= 25) {
        ids.push(await seedEvent(db, world, { material, weightKg: Math.min(25, left).toFixed(3) }));
      }
      return ids;
    }
    const sell = (grossKg: number, material = 'PET', soldAt = '2026-06-10T15:00:00Z') =>
      recordRecyclerSale(
        db,
        recyclerSaleInputSchema.parse({ material, grossKg, buyer: 'B', soldAt }),
        world.adminId,
      );

    it('a variance exactly at the tolerance is within it; one gram over is flagged', async () => {
      await collect(100);
      await sell(95); // variance 5.000 = 5.000 %
      expect((await computeReconciliation(db, period()))[0]).toMatchObject({
        material: 'PET',
        collectedKg: '100.000',
        recyclerKg: '95.000',
        varianceKg: '5.000',
        variancePct: '5.000',
        tolerancePct: '5.000',
        status: 'within_tolerance',
      });

      await sell(0.001); // recycler 95.001 → variance 4.999
      expect((await computeReconciliation(db, period()))[0]).toMatchObject({
        varianceKg: '4.999',
        status: 'within_tolerance',
      });
    });

    it('flags 5.001 % under-delivery and 6 % over-delivery', async () => {
      await collect(100);
      await sell(94.999);
      expect((await computeReconciliation(db, period()))[0]).toMatchObject({
        varianceKg: '5.001',
        variancePct: '5.001',
        status: 'flagged',
      });

      await db.execute(PAYOUT_TRUNCATE);
      world = await seedPayoutWorld(db);
      await collect(100);
      await sell(106);
      expect((await computeReconciliation(db, period()))[0]).toMatchObject({
        varianceKg: '-6.000',
        variancePct: '-6.000',
        status: 'flagged',
      });
    });

    it('sums decimals exactly (no float drift) and reports paid kg from paid payouts only', async () => {
      const a = await seedEvent(db, world, { weightKg: '0.100' });
      await seedEvent(db, world, { weightKg: '0.200' });
      await seedPaidPayout(db, a, world.collectorId, 40);
      await sell(0.3);
      expect((await computeReconciliation(db, period()))[0]).toMatchObject({
        collectedKg: '0.300',
        paidKg: '0.100',
        recyclerKg: '0.300',
        varianceKg: '0.000',
        status: 'within_tolerance',
      });
    });

    it('no recycler sales → no_recycler_data (not a pass); no collections but a sale → flagged', async () => {
      await collect(10);
      expect((await computeReconciliation(db, period()))[0]).toMatchObject({
        collectedKg: '10.000',
        recyclerKg: '0.000',
        status: 'no_recycler_data',
      });

      await sell(7, 'aluminium');
      const rows = await computeReconciliation(db, period());
      expect(rows.find((r) => r.material === 'aluminium')).toMatchObject({
        collectedKg: '0.000',
        recyclerKg: '7.000',
        variancePct: '0.000',
        status: 'flagged',
      });
      expect(await computeReconciliation(db, period({ material: 'PET' }))).toHaveLength(1);
    });

    it('periods include the start and exclude the end', async () => {
      await seedEvent(db, world, {
        weightKg: '1.000',
        recordedAt: new Date('2026-06-10T00:00:00Z'),
      });
      await seedEvent(db, world, {
        weightKg: '2.000',
        recordedAt: new Date('2026-06-11T00:00:00Z'),
      });
      await sell(1, 'PET', '2026-06-11T00:00:00Z'); // sold exactly at the end: not in this period
      expect((await computeReconciliation(db, period()))[0]).toMatchObject({
        collectedKg: '1.000',
        recyclerKg: '0.000',
      });
    });

    it('rejects an inverted period', () => {
      expect(() => period({ from: '2026-06-11T00:00:00Z', to: '2026-06-10T00:00:00Z' })).toThrow();
    });

    it('a run persists one report per material, snapshots the tolerance and raises a mass-balance flag', async () => {
      await collect(100);
      await sell(80);
      const reports = await runReconciliation(db, period(), world.adminId);
      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({
        status: 'flagged',
        variancePct: '20.000',
        createdBy: world.adminId,
      });

      const [flag] = await flagsOf('mass_balance_variance');
      expect(flag).toMatchObject({ collectionEventId: null });
      expect(flag?.context).toMatchObject({
        reportId: reports[0]!.id,
        material: 'PET',
        varianceKg: '20.000',
      });

      await runReconciliation(db, period(), world.adminId); // a new run is new rows
      expect((await listReconciliationReports(db)).reports).toHaveLength(2);
      expect(await flagsOf('mass_balance_variance')).toHaveLength(2);
    });

    it('a run within tolerance raises no flag', async () => {
      await collect(100);
      await sell(100);
      await runReconciliation(db, period(), world.adminId);
      expect(await flagsOf('mass_balance_variance')).toHaveLength(0);
    });

    it('reports are never updated: the DB keeps the tolerance that was in force', async () => {
      await collect(100);
      await sell(100);
      const [report] = await runReconciliation(db, period(), world.adminId);
      const [stored] = await db.execute<{ tolerance_pct: string }>(
        sql`select tolerance_pct from reconciliation_reports where id = ${report!.id}`,
      );
      expect(stored?.tolerance_pct).toBe('5.000');
    });
  });

  describe('anomaly review', () => {
    const adminB = async () =>
      (await import('@/lib/testing/fixtures')).createStaff(db, 'admin', 'Second admin');

    async function flag() {
      const event = await seedEvent(db, world);
      await raiseFlag(db, {
        type: 'weight_outlier',
        eventId: event,
        collectorId: world.collectorId,
        supervisorId: world.recorderId,
        context: { weightKg: '900.000' },
      });
      const [row] = await flagsOf('weight_outlier');
      return row!.id;
    }

    it('lists open flags with their collector and supervisor, then by status', async () => {
      const id = await flag();
      const open = await listAnomalies(db);
      expect(open.anomalies).toHaveLength(1);
      expect(open.anomalies[0]).toMatchObject({
        id,
        type: 'weight_outlier',
        status: 'open',
        collector: { alias: 'Amina' },
        supervisor: { name: 'Brian' },
        context: { weightKg: '900.000' },
      });
      await reviewAnomaly(db, id, { outcome: 'dismissed' }, world.adminId);
      expect((await listAnomalies(db)).anomalies).toHaveLength(0);
      expect((await listAnomalies(db, { status: 'dismissed' })).anomalies).toHaveLength(1);
      expect((await listAnomalies(db, { status: 'all' })).anomalies).toHaveLength(1);
    });

    it('records who, when and why; the same verdict again changes nothing', async () => {
      const id = await flag();
      const first = await reviewAnomaly(
        db,
        id,
        { outcome: 'confirmed', note: 'checked photo' },
        world.adminId,
      );
      expect(first.changed).toBe(true);
      expect(first.anomaly).toMatchObject({
        status: 'confirmed',
        reviewedBy: world.adminId,
        reviewNote: 'checked photo',
      });
      expect(first.anomaly.reviewedAt).toBeInstanceOf(Date);

      const again = await reviewAnomaly(
        db,
        id,
        { outcome: 'confirmed', note: 'ignored' },
        world.adminId,
      );
      expect(again.changed).toBe(false);
      expect(again.anomaly.reviewNote).toBe('checked photo');
    });

    it('the same admin cannot flip their own verdict; a different admin can, and history keeps the old one', async () => {
      const id = await flag();
      await reviewAnomaly(db, id, { outcome: 'dismissed', note: 'looks fine' }, world.adminId);
      await expect(
        reviewAnomaly(db, id, { outcome: 'confirmed' }, world.adminId),
      ).rejects.toBeInstanceOf(AnomalyReviewError);

      const other = await adminB();
      const { anomaly, changed } = await reviewAnomaly(
        db,
        id,
        { outcome: 'confirmed', note: 'no, fraud' },
        other.id,
      );
      expect(changed).toBe(true);
      expect(anomaly).toMatchObject({ status: 'confirmed', reviewedBy: other.id });
      expect((anomaly.context as { history: unknown[] }).history).toEqual([
        expect.objectContaining({
          outcome: 'dismissed',
          reviewedBy: world.adminId,
          note: 'looks fine',
        }),
      ]);
      expect((anomaly.context as { weightKg: string }).weightKg).toBe('900.000'); // original context kept
    });

    it('404s an unknown flag', async () => {
      await expect(getAnomaly(db, '00000000-0000-4000-8000-000000000000')).rejects.toThrow(
        'not found',
      );
    });

    it('paginates newest first', async () => {
      for (let i = 0; i < 3; i += 1) {
        await raiseFlag(db, { type: 'off_hours', context: { i } });
      }
      const page1 = await listAnomalies(db, {}, { limit: 2 });
      expect(page1.anomalies).toHaveLength(2);
      expect(page1.nextCursor).not.toBeNull();
      const page2 = await listAnomalies(db, {}, { limit: 2, cursor: page1.nextCursor! });
      expect(page2.anomalies).toHaveLength(1);
      expect(page2.nextCursor).toBeNull();
    });
  });
});
