// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The funding vote (ADR-0020, M5-7). The first block needs no database: it proves the cheap
 * refusals happen before anything is read or written. The second runs against a real Postgres
 * (skipped without DATABASE_URL) and tries to break the vote: a proposer approving their own
 * proposal, an approver counted twice, approving a closed proposal, beating the cap, racing.
 */

import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@/lib/db/client';
import { getDb } from '@/lib/db/client';
import { pgErrorCode } from '@/lib/db/pg-errors';
import { ledgerEntries, payouts, treasuryTopups, treasuryTopupSignoffs } from '@/lib/db/schema';
import { verifyChain } from '@/lib/ledger';
import type { Role } from '@/lib/auth/permissions';
import type {
  LightningProvider,
  PayoutDestination,
  PayResult,
} from '@/lib/lightning/LightningProvider';
import { confirmTreasuryTopups } from '@/lib/jobs/confirmTreasuryTopups';
import { createPayoutForEvent, processPayout } from '@/lib/payouts';
import { sats, type Sats } from '@/lib/money';
import { resetSettingsCache } from '@/lib/config';
import { createStaff } from '@/lib/testing/fixtures';
import {
  NOW,
  seedCollectionEvent,
  seedPayoutWorld,
  seedSnapshot,
} from '@/lib/testing/payout-fixtures';
import {
  clearTreasuryConfig,
  configureTreasury,
  makeRail,
  type Stewards,
  seedStewards,
} from '@/lib/testing/treasury-fixtures';
import {
  approveTopup,
  cancelTopup,
  confirmTopup,
  getTopupView,
  getTreasuryOverview,
  listTopups,
  normaliseTransferReference,
  proposeTopup,
  recordTopupTransfer,
  rejectTopup,
  TopupApprovalError,
  TopupCapError,
  TopupConflictError,
  TopupFloatUnavailableError,
  TopupInputError,
  TopupNotFoundError,
  TopupStateError,
} from './index';

const UNKNOWN = '00000000-0000-4000-8000-000000000000';

describe('treasury funding vote: refusals that need no database', () => {
  // These calls must fail before touching the database, so a dummy one proves it.
  const db = undefined as unknown as Database;
  const { rail } = makeRail(0);

  it('only an admin steward may propose, approve, reject, cancel or confirm', async () => {
    for (const role of ['supervisor', 'hub_lead', 'partner'] as const) {
      const actor = { id: UNKNOWN, role };
      await expect(proposeTopup(db, rail, { amountSats: 1000, actor })).rejects.toMatchObject({
        reason: 'not_permitted',
      });
      await expect(approveTopup(db, rail, { topupId: UNKNOWN, actor })).rejects.toBeInstanceOf(
        TopupApprovalError,
      );
      await expect(rejectTopup(db, { topupId: UNKNOWN, actor })).rejects.toBeInstanceOf(
        TopupApprovalError,
      );
      await expect(cancelTopup(db, { topupId: UNKNOWN, actor })).rejects.toBeInstanceOf(
        TopupApprovalError,
      );
      await expect(
        recordTopupTransfer(db, rail, { topupId: UNKNOWN, reference: 'abc', actor }),
      ).rejects.toBeInstanceOf(TopupApprovalError);
      await expect(confirmTopup(db, rail, { topupId: UNKNOWN, actor })).rejects.toBeInstanceOf(
        TopupApprovalError,
      );
    }
  });

  it.each([0, -1, -1000, 1.5, 0.1, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, '100', null])(
    'a proposed amount of %s is refused',
    async (amount) => {
      await expect(
        proposeTopup(db, rail, {
          amountSats: amount as number,
          actor: { id: UNKNOWN, role: 'admin' },
        }),
      ).rejects.toBeInstanceOf(TopupInputError);
    },
  );

  it.each(['', '   ', 'has space', 'tab\there', 'x'.repeat(201), 'café'])(
    'a transfer reference of %j is refused',
    (reference) => {
      expect(() => normaliseTransferReference(reference)).toThrow(TopupInputError);
    },
  );

  it('normalises a reference: trimmed and lower-cased, so one txid cannot hide behind its case', () => {
    expect(normaliseTransferReference('  AbC123  ')).toBe('abc123');
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('treasury funding vote: integration', () => {
  const db = hasDatabase ? getDb() : undefined!;
  let s: Stewards;
  const steward = (who: { id: string; role: string }) => ({ id: who.id, role: who.role as Role });

  /** Four admin stewards on top of the payout world (which truncates everything first). */
  async function stewardsOnPayoutWorld() {
    const world = await seedPayoutWorld(db);
    s = {
      ...s,
      proposer: await createStaff(db, 'admin', 'Proposer'),
      b: await createStaff(db, 'admin', 'Steward B'),
      c: await createStaff(db, 'admin', 'Steward C'),
      d: await createStaff(db, 'admin', 'Steward D'),
    };
    return world;
  }

  beforeEach(async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    configureTreasury({ approvals: 2, cap: 0 });
    s = await seedStewards(db);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    clearTreasuryConfig();
    delete process.env.TAKASATS__PAYOUTS__SECOND_SIGNOFF_THRESHOLD_SATS;
    delete process.env.TAKASATS__PAYOUTS__REQUIRE_APPROVAL_FIRST_PAYOUT;
    resetSettingsCache();
  });
  afterAll(async () => {
    if (hasDatabase) {
      await db.execute(
        sql`truncate treasury_topup_signoffs, treasury_topups, ledger_entries, supervisors cascade`,
      );
    }
  });

  async function topupLedgerCount(): Promise<number> {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.entryType, 'treasury_topup'));
    return row?.n ?? 0;
  }
  async function signoffCount(topupId: string): Promise<number> {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(treasuryTopupSignoffs)
      .where(eq(treasuryTopupSignoffs.topupId, topupId));
    return rows[0]?.n ?? 0;
  }
  async function statusOf(topupId: string): Promise<string> {
    const [row] = await db
      .select({ status: treasuryTopups.status })
      .from(treasuryTopups)
      .where(eq(treasuryTopups.id, topupId));
    return row?.status ?? 'missing';
  }
  async function propose(amount = 100_000, rail = makeRail(0).rail) {
    const { topup } = await proposeTopup(db, rail, {
      amountSats: amount,
      note: 'two weeks of payouts',
      actor: steward(s.proposer),
    });
    return topup;
  }
  /** Propose, then two other stewards approve: the proposal is `approved`. */
  async function approvedTopup(rail = makeRail(0).rail, amount = 100_000) {
    const topup = await propose(amount, rail);
    await approveTopup(db, rail, { topupId: topup.id, actor: steward(s.b) });
    const { topup: approved } = await approveTopup(db, rail, {
      topupId: topup.id,
      actor: steward(s.c),
    });
    return approved;
  }

  describe('proposing', () => {
    it('records the proposal and anchors it on the ledger chain', async () => {
      const before = await topupLedgerCount();
      const { topup, changed } = await proposeTopup(db, makeRail(0).rail, {
        amountSats: 250_000,
        note: '  refill  ',
        actor: steward(s.proposer),
      });
      expect(changed).toBe(true);
      expect(topup).toMatchObject({
        status: 'proposed',
        amountSats: 250_000,
        note: 'refill',
        proposedBy: s.proposer.id,
        approvalsRequired: 2,
      });
      expect(await topupLedgerCount()).toBe(before + 1);
      expect(await verifyChain(db)).toMatchObject({ ok: true });
    });

    it('snapshots the approvals required, so a later config change cannot weaken a vote in flight', async () => {
      const topup = await propose();
      configureTreasury({ approvals: 1 });
      const [row] = await db.select().from(treasuryTopups).where(eq(treasuryTopups.id, topup.id));
      expect(row?.approvalsRequired).toBe(2);
      await approveTopup(db, makeRail(0).rail, { topupId: topup.id, actor: steward(s.b) });
      expect(await statusOf(topup.id)).toBe('proposed'); // one approval is not enough: it needs two
    });

    it('is idempotent by client id: a resend returns the stored proposal and writes nothing', async () => {
      const id = crypto.randomUUID();
      const rail = makeRail(0).rail;
      const first = await proposeTopup(db, rail, {
        id,
        amountSats: 5000,
        actor: steward(s.proposer),
      });
      const ledgerAfterFirst = await topupLedgerCount();
      const again = await proposeTopup(db, rail, {
        id,
        amountSats: 5000,
        actor: steward(s.proposer),
      });
      expect(first.changed).toBe(true);
      expect(again).toMatchObject({ changed: false });
      expect(again.topup.id).toBe(id);
      expect(await topupLedgerCount()).toBe(ledgerAfterFirst);
      const rows = await db.select().from(treasuryTopups);
      expect(rows).toHaveLength(1);
    });

    it('refuses a resent id carrying a different amount or a different proposer', async () => {
      const id = crypto.randomUUID();
      const rail = makeRail(0).rail;
      await proposeTopup(db, rail, { id, amountSats: 5000, actor: steward(s.proposer) });
      await expect(
        proposeTopup(db, rail, { id, amountSats: 6000, actor: steward(s.proposer) }),
      ).rejects.toBeInstanceOf(TopupConflictError);
      await expect(
        proposeTopup(db, rail, { id, amountSats: 5000, actor: steward(s.b) }),
      ).rejects.toBeInstanceOf(TopupConflictError);
    });

    it('writes nothing when the amount is refused', async () => {
      const before = await topupLedgerCount();
      await expect(
        proposeTopup(db, makeRail(0).rail, { amountSats: 0, actor: steward(s.proposer) }),
      ).rejects.toBeInstanceOf(TopupInputError);
      expect(await topupLedgerCount()).toBe(before);
      expect(await db.select().from(treasuryTopups)).toHaveLength(0);
    });
  });

  describe('the hot-wallet cap', () => {
    it('refuses a proposal that would take the hot wallet above the cap', async () => {
      configureTreasury({ cap: 1000 });
      const { rail } = makeRail(400);
      await expect(
        proposeTopup(db, rail, { amountSats: 601, actor: steward(s.proposer) }),
      ).rejects.toMatchObject({ name: 'TopupCapError', capSats: 1000, headroomSats: 600 });
      const ok = await proposeTopup(db, rail, { amountSats: 600, actor: steward(s.proposer) });
      expect(ok.changed).toBe(true); // exactly at the cap is allowed
    });

    it('counts funding already in flight, so two proposals cannot add up past the cap', async () => {
      configureTreasury({ cap: 1000 });
      const { rail } = makeRail(0);
      await proposeTopup(db, rail, { amountSats: 700, actor: steward(s.proposer) });
      await expect(
        proposeTopup(db, rail, { amountSats: 301, actor: steward(s.b) }),
      ).rejects.toBeInstanceOf(TopupCapError);
      await proposeTopup(db, rail, { amountSats: 300, actor: steward(s.b) });
    });

    it('frees the room again when a proposal is cancelled or rejected', async () => {
      configureTreasury({ cap: 1000 });
      const { rail } = makeRail(0);
      const first = await proposeTopup(db, rail, { amountSats: 1000, actor: steward(s.proposer) });
      await expect(
        proposeTopup(db, rail, { amountSats: 1, actor: steward(s.b) }),
      ).rejects.toBeInstanceOf(TopupCapError);
      await cancelTopup(db, { topupId: first.topup.id, actor: steward(s.proposer) });
      const second = await proposeTopup(db, rail, { amountSats: 1000, actor: steward(s.b) });
      await rejectTopup(db, { topupId: second.topup.id, actor: steward(s.c) });
      await proposeTopup(db, rail, { amountSats: 1000, actor: steward(s.c) });
    });

    it('does not guess when the float cannot be read: it refuses, and leaks nothing about the rail', async () => {
      configureTreasury({ cap: 1000 });
      const { rail, state } = makeRail(0);
      state.failing = true;
      const error = await proposeTopup(db, rail, {
        amountSats: 1,
        actor: steward(s.proposer),
      }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TopupFloatUnavailableError);
      expect(String((error as Error).message)).not.toContain('super-secret-value');
      expect(await db.select().from(treasuryTopups)).toHaveLength(0);
    });

    it('needs no float reading when no cap is set', async () => {
      const { rail, state } = makeRail(0);
      state.failing = true;
      const ok = await proposeTopup(db, rail, { amountSats: 1, actor: steward(s.proposer) });
      expect(ok.changed).toBe(true);
    });

    it('five simultaneous proposals cannot beat the cap', async () => {
      configureTreasury({ cap: 1000 });
      const { rail } = makeRail(0);
      const results = await Promise.allSettled(
        [s.proposer, s.b, s.c, s.d, s.proposer].map((who) =>
          proposeTopup(db, rail, { amountSats: 300, actor: steward(who) }),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
      for (const r of results.filter((x) => x.status === 'rejected')) {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(TopupCapError);
      }
    });
  });

  describe('approving', () => {
    it('the proposer cannot approve their own proposal: refused, and nothing is recorded', async () => {
      const topup = await propose();
      const before = await topupLedgerCount();
      await expect(
        approveTopup(db, makeRail(0).rail, { topupId: topup.id, actor: steward(s.proposer) }),
      ).rejects.toMatchObject({ reason: 'self_approval' });
      expect(await signoffCount(topup.id)).toBe(0);
      expect(await topupLedgerCount()).toBe(before);
    });

    it('the database also refuses a proposer as approver, even bypassing the code', async () => {
      const topup = await propose();
      const refused = await db
        .insert(treasuryTopupSignoffs)
        .values({
          topupId: topup.id,
          supervisorId: s.proposer.id,
          ledgerEntryId: topup.ledgerEntryId,
        })
        .catch((error: unknown) => error);
      expect(pgErrorCode(refused)).toBe('23514'); // check_violation, from the trigger
      expect(await signoffCount(topup.id)).toBe(0);
    });

    it('approvals can never be edited or removed, and a closed proposal takes none, even written straight to the table', async () => {
      const topup = await propose();
      const rail = makeRail(0).rail;
      await approveTopup(db, rail, { topupId: topup.id, actor: steward(s.b) });
      const edited = await db
        .execute(sql`update treasury_topup_signoffs set approved_at = now()`)
        .catch((error: unknown) => error);
      const removed = await db
        .execute(sql`delete from treasury_topup_signoffs`)
        .catch((error: unknown) => error);
      expect(pgErrorCode(edited)).toBe('23001'); // restrict_violation
      expect(pgErrorCode(removed)).toBe('23001');
      expect(await signoffCount(topup.id)).toBe(1);

      // A closed proposal takes no new approvals, even written straight to the table.
      await rejectTopup(db, { topupId: topup.id, actor: steward(s.c) });
      const late = await db
        .insert(treasuryTopupSignoffs)
        .values({
          topupId: topup.id,
          supervisorId: s.d.id,
          ledgerEntryId: topup.ledgerEntryId,
        })
        .catch((error: unknown) => error);
      expect(pgErrorCode(late)).toBe('23514');
    });

    it('a duplicate approval does not count twice', async () => {
      const topup = await propose();
      const rail = makeRail(0).rail;
      const first = await approveTopup(db, rail, { topupId: topup.id, actor: steward(s.b) });
      const ledgerAfterFirst = await topupLedgerCount();
      const again = await approveTopup(db, rail, { topupId: topup.id, actor: steward(s.b) });
      expect(first.changed).toBe(true);
      expect(again.changed).toBe(false);
      expect(await signoffCount(topup.id)).toBe(1);
      expect(await statusOf(topup.id)).toBe('proposed'); // two approvals are required, one person gave one
      expect(await topupLedgerCount()).toBe(ledgerAfterFirst);
    });

    it('reaches the quorum only with distinct approvers, then records the float baseline', async () => {
      const topup = await propose();
      const { rail } = makeRail(4321);
      await approveTopup(db, rail, { topupId: topup.id, actor: steward(s.b) });
      expect(await statusOf(topup.id)).toBe('proposed');
      const { topup: approved } = await approveTopup(db, rail, {
        topupId: topup.id,
        actor: steward(s.c),
      });
      expect(approved.status).toBe('approved');
      expect(approved.floatBaselineSats).toBe(4321);
      expect(approved.floatBaselineAt).toBeInstanceOf(Date);
    });

    it('still approves when the float cannot be read (the baseline is taken later)', async () => {
      const topup = await propose();
      const { rail, state } = makeRail(10);
      state.failing = true;
      await approveTopup(db, rail, { topupId: topup.id, actor: steward(s.b) });
      const { topup: approved } = await approveTopup(db, rail, {
        topupId: topup.id,
        actor: steward(s.c),
      });
      expect(approved.status).toBe('approved');
      expect(approved.floatBaselineSats).toBeNull();
    });

    it('cannot approve a cancelled proposal', async () => {
      const topup = await propose();
      await cancelTopup(db, { topupId: topup.id, actor: steward(s.proposer) });
      await expect(
        approveTopup(db, makeRail(0).rail, { topupId: topup.id, actor: steward(s.b) }),
      ).rejects.toMatchObject({ name: 'TopupStateError', status: 'cancelled' });
      expect(await signoffCount(topup.id)).toBe(0);
    });

    it('cannot approve a rejected proposal, not even one who approved before it was rejected', async () => {
      const topup = await propose();
      const rail = makeRail(0).rail;
      await approveTopup(db, rail, { topupId: topup.id, actor: steward(s.b) });
      await rejectTopup(db, { topupId: topup.id, actor: steward(s.c), reason: 'too much' });
      await expect(
        approveTopup(db, rail, { topupId: topup.id, actor: steward(s.d) }),
      ).rejects.toMatchObject({ name: 'TopupStateError', status: 'rejected' });
      await expect(
        approveTopup(db, rail, { topupId: topup.id, actor: steward(s.b) }),
      ).rejects.toBeInstanceOf(TopupStateError);
      expect(await signoffCount(topup.id)).toBe(1);
    });

    it('a further approver after the quorum is refused: nothing extra is counted', async () => {
      const topup = await approvedTopup();
      await expect(
        approveTopup(db, makeRail(0).rail, { topupId: topup.id, actor: steward(s.d) }),
      ).rejects.toMatchObject({ name: 'TopupStateError', status: 'approved' });
      expect(await signoffCount(topup.id)).toBe(2);
    });

    it('a resent approval after the quorum is a harmless no-op for an approver already counted', async () => {
      const topup = await approvedTopup();
      const again = await approveTopup(db, makeRail(0).rail, {
        topupId: topup.id,
        actor: steward(s.b),
      });
      expect(again.changed).toBe(false);
      expect(await signoffCount(topup.id)).toBe(2);
    });

    it('an unknown proposal is not found', async () => {
      await expect(
        approveTopup(db, makeRail(0).rail, { topupId: UNKNOWN, actor: steward(s.b) }),
      ).rejects.toBeInstanceOf(TopupNotFoundError);
    });

    it('concurrent approvals never double count: with 2 required and 3 racing, exactly 2 are counted', async () => {
      const topup = await propose();
      const rail = makeRail(0).rail;
      const results = await Promise.allSettled(
        [s.b, s.c, s.d].map((who) =>
          approveTopup(db, rail, { topupId: topup.id, actor: steward(who) }),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
      const refused = results.filter((r) => r.status === 'rejected');
      expect(refused).toHaveLength(1);
      expect((refused[0] as PromiseRejectedResult).reason).toBeInstanceOf(TopupStateError);
      expect(await signoffCount(topup.id)).toBe(2);
      expect(await statusOf(topup.id)).toBe('approved');
      expect(await verifyChain(db)).toMatchObject({ ok: true });
    });

    it('the same steward approving twice at once is counted once', async () => {
      const topup = await propose();
      const rail = makeRail(0).rail;
      const results = await Promise.all([
        approveTopup(db, rail, { topupId: topup.id, actor: steward(s.b) }),
        approveTopup(db, rail, { topupId: topup.id, actor: steward(s.b) }),
      ]);
      expect(results.map((r) => r.changed).sort()).toEqual([false, true]);
      expect(await signoffCount(topup.id)).toBe(1);
    });

    it('with one approval required, a single other steward approves; the proposer still cannot', async () => {
      configureTreasury({ approvals: 1 });
      const topup = await propose();
      const rail = makeRail(0).rail;
      await expect(
        approveTopup(db, rail, { topupId: topup.id, actor: steward(s.proposer) }),
      ).rejects.toMatchObject({ reason: 'self_approval' });
      const { topup: approved } = await approveTopup(db, rail, {
        topupId: topup.id,
        actor: steward(s.b),
      });
      expect(approved.status).toBe('approved');
    });
  });

  describe('cancelling and rejecting', () => {
    it('only the proposer cancels; another steward rejects; the proposer cannot reject their own', async () => {
      const topup = await propose();
      await expect(
        cancelTopup(db, { topupId: topup.id, actor: steward(s.b) }),
      ).rejects.toMatchObject({ reason: 'not_proposer' });
      await expect(
        rejectTopup(db, { topupId: topup.id, actor: steward(s.proposer) }),
      ).rejects.toMatchObject({ reason: 'self_approval' });
      expect(await statusOf(topup.id)).toBe('proposed');

      const { topup: rejected } = await rejectTopup(db, {
        topupId: topup.id,
        actor: steward(s.b),
        reason: 'not this month',
      });
      expect(rejected).toMatchObject({ status: 'rejected', outcomeBy: s.b.id });
      expect(rejected.outcomeReason).toBe('not this month');
    });

    it('both are idempotent and each writes one ledger entry', async () => {
      const topup = await propose();
      const before = await topupLedgerCount();
      const first = await cancelTopup(db, { topupId: topup.id, actor: steward(s.proposer) });
      const again = await cancelTopup(db, { topupId: topup.id, actor: steward(s.proposer) });
      expect([first.changed, again.changed]).toEqual([true, false]);
      expect(await topupLedgerCount()).toBe(before + 1);
    });

    it('a cancelled proposal cannot be rejected and a rejected one cannot be cancelled', async () => {
      const a = await propose();
      await cancelTopup(db, { topupId: a.id, actor: steward(s.proposer) });
      await expect(rejectTopup(db, { topupId: a.id, actor: steward(s.b) })).rejects.toBeInstanceOf(
        TopupStateError,
      );
      const b = await propose();
      await rejectTopup(db, { topupId: b.id, actor: steward(s.b) });
      await expect(
        cancelTopup(db, { topupId: b.id, actor: steward(s.proposer) }),
      ).rejects.toBeInstanceOf(TopupStateError);
    });

    it('an approved proposal can still be stopped, but not once the transfer is recorded', async () => {
      const rail = makeRail(0).rail;
      const approved = await approvedTopup(rail);
      await recordTopupTransfer(db, rail, {
        topupId: approved.id,
        reference: 'abc123',
        actor: steward(s.proposer),
      });
      await expect(
        cancelTopup(db, { topupId: approved.id, actor: steward(s.proposer) }),
      ).rejects.toMatchObject({ name: 'TopupStateError', status: 'transferred' });
      await expect(
        rejectTopup(db, { topupId: approved.id, actor: steward(s.d) }),
      ).rejects.toMatchObject({
        status: 'transferred',
      });
      const other = await approvedTopup(rail);
      await rejectTopup(db, { topupId: other.id, actor: steward(s.d) });
      expect(await statusOf(other.id)).toBe('rejected');
    });
  });

  describe('recording the transfer', () => {
    it('only an approved proposal can have its transfer recorded', async () => {
      const rail = makeRail(0).rail;
      const topup = await propose();
      await expect(
        recordTopupTransfer(db, rail, { topupId: topup.id, reference: 'abc', actor: steward(s.b) }),
      ).rejects.toMatchObject({ name: 'TopupStateError', status: 'proposed' });
      await cancelTopup(db, { topupId: topup.id, actor: steward(s.proposer) });
      await expect(
        recordTopupTransfer(db, rail, { topupId: topup.id, reference: 'abc', actor: steward(s.b) }),
      ).rejects.toBeInstanceOf(TopupStateError);
    });

    it('records the reference (normalised), who recorded it, and a ledger entry', async () => {
      const rail = makeRail(0).rail;
      const approved = await approvedTopup(rail);
      const before = await topupLedgerCount();
      const { topup, changed } = await recordTopupTransfer(db, rail, {
        topupId: approved.id,
        reference: '  ABC123DEF  ',
        actor: steward(s.d),
      });
      expect(changed).toBe(true);
      expect(topup).toMatchObject({
        status: 'transferred',
        transferReference: 'abc123def',
        transferredBy: s.d.id,
      });
      expect(await topupLedgerCount()).toBe(before + 1);
    });

    it('is idempotent for the same reference and a conflict for a different one', async () => {
      const rail = makeRail(0).rail;
      const approved = await approvedTopup(rail);
      const input = { topupId: approved.id, actor: steward(s.d) };
      await recordTopupTransfer(db, rail, { ...input, reference: 'tx-1' });
      const before = await topupLedgerCount();
      const again = await recordTopupTransfer(db, rail, { ...input, reference: 'TX-1' });
      expect(again.changed).toBe(false);
      expect(await topupLedgerCount()).toBe(before);
      await expect(
        recordTopupTransfer(db, rail, { ...input, reference: 'tx-2' }),
      ).rejects.toBeInstanceOf(TopupConflictError);
    });

    it('one transfer can never be claimed as the funding of two proposals', async () => {
      const rail = makeRail(0).rail;
      const first = await approvedTopup(rail);
      await recordTopupTransfer(db, rail, {
        topupId: first.id,
        reference: 'same-txid',
        actor: steward(s.d),
      });
      const second = await approvedTopup(rail);
      await expect(
        recordTopupTransfer(db, rail, {
          topupId: second.id,
          reference: 'SAME-TXID',
          actor: steward(s.d),
        }),
      ).rejects.toBeInstanceOf(TopupConflictError);
      expect(await statusOf(second.id)).toBe('approved');
    });

    it('does not guess a baseline: with none and an unreadable float, nothing is recorded', async () => {
      const { rail, state } = makeRail(0);
      state.failing = true;
      const approved = await approvedTopup(rail);
      expect(approved.floatBaselineSats).toBeNull();
      await expect(
        recordTopupTransfer(db, rail, {
          topupId: approved.id,
          reference: 'abc',
          actor: steward(s.d),
        }),
      ).rejects.toBeInstanceOf(TopupFloatUnavailableError);
      expect(await statusOf(approved.id)).toBe('approved');
      state.failing = false;
      state.balance = 77;
      const { topup } = await recordTopupTransfer(db, rail, {
        topupId: approved.id,
        reference: 'abc',
        actor: steward(s.d),
      });
      expect(topup.floatBaselineSats).toBe(77);
    });
  });

  describe('confirming arrival', () => {
    async function transferred(rail: ReturnType<typeof makeRail>['rail'], amount = 100_000) {
      const approved = await approvedTopup(rail, amount);
      const { topup } = await recordTopupTransfer(db, rail, {
        topupId: approved.id,
        reference: `txid-${approved.id.slice(0, 8)}`,
        actor: steward(s.d),
      });
      return topup;
    }

    it('does not confirm on anyone saying so: the balance must show the funds', async () => {
      const { rail, state } = makeRail(500);
      const topup = await transferred(rail);
      state.balance = 500 + 99_999; // one sat short
      const result = await confirmTopup(db, rail, { topupId: topup.id, actor: steward(s.b) });
      expect(result).toMatchObject({ changed: false, arrived: false });
      expect(await statusOf(topup.id)).toBe('transferred');
    });

    it('confirms once the float has risen by the amount, and anchors it on the ledger', async () => {
      const { rail, state } = makeRail(500);
      const topup = await transferred(rail);
      const before = await topupLedgerCount();
      state.balance = 500 + 100_000;
      const result = await confirmTopup(db, rail, { topupId: topup.id, actor: steward(s.b) });
      expect(result).toMatchObject({ changed: true, arrived: true });
      expect(result.topup).toMatchObject({ status: 'confirmed', outcomeBy: s.b.id });
      expect(await topupLedgerCount()).toBe(before + 1);
      expect(await verifyChain(db)).toMatchObject({ ok: true });
      const again = await confirmTopup(db, rail, { topupId: topup.id, actor: steward(s.b) });
      expect(again).toMatchObject({ changed: false, arrived: true });
      expect(await topupLedgerCount()).toBe(before + 1);
    });

    it('credits what payouts have spent since the baseline, so spending does not hide an arrival', async () => {
      const world = await stewardsOnPayoutWorld();
      const { rail, state } = makeRail(500);
      const topup = await transferred(rail, 5000); // baseline 500
      // A 1000-sat payout goes out after the baseline: the wallet received 5000 and paid 1000.
      const created = await createPayoutForEvent(db, await seedCollectionEvent(db, world));
      await db
        .update(payouts)
        .set({
          status: 'sending',
          amountSats: 1000,
          amountFiatMinor: 100,
          exchangeSnapshotId: await seedSnapshot(db, new Date()),
          attemptedAt: new Date(Date.now() + 5000),
        })
        .where(eq(payouts.id, created.id));
      state.balance = 500 + 5000 - 1000;
      const result = await confirmTopup(db, rail, { topupId: topup.id, actor: steward(s.b) });
      expect(result).toMatchObject({ changed: true, arrived: true });
    });

    it('a payout that went out BEFORE the baseline is not credited', async () => {
      const world = await stewardsOnPayoutWorld();
      const { rail, state } = makeRail(500);
      const created = await createPayoutForEvent(db, await seedCollectionEvent(db, world));
      await db
        .update(payouts)
        .set({
          status: 'sending',
          amountSats: 1000,
          amountFiatMinor: 100,
          exchangeSnapshotId: await seedSnapshot(db, new Date()),
          attemptedAt: new Date(Date.now() - 3_600_000),
        })
        .where(eq(payouts.id, created.id));
      const topup = await transferred(rail, 5000);
      state.balance = 500 + 5000 - 1000;
      const result = await confirmTopup(db, rail, { topupId: topup.id, actor: steward(s.b) });
      expect(result).toMatchObject({ changed: false, arrived: false });
    });

    it('cannot confirm a proposal whose transfer was never recorded', async () => {
      const rail = makeRail(0).rail;
      const topup = await approvedTopup(rail);
      await expect(
        confirmTopup(db, rail, { topupId: topup.id, actor: steward(s.b) }),
      ).rejects.toMatchObject({ name: 'TopupStateError', status: 'approved' });
    });

    it('does not guess when the balance cannot be read', async () => {
      const { rail, state } = makeRail(0);
      const topup = await transferred(rail);
      state.failing = true;
      await expect(
        confirmTopup(db, rail, { topupId: topup.id, actor: steward(s.b) }),
      ).rejects.toBeInstanceOf(TopupFloatUnavailableError);
      expect(await statusOf(topup.id)).toBe('transferred');
    });

    it('the worker pass confirms what has arrived and leaves the rest', async () => {
      const { rail, state } = makeRail(0);
      const arrived = await transferred(rail, 1000);
      const waiting = await transferred(rail, 2000);
      state.balance = 1000; // both baselines are 0: 1000 covers the first, not the second
      const enqueue = vi.fn(async () => undefined);
      const first = await confirmTreasuryTopups(db, rail, enqueue);
      expect(first.confirmed).toBe(1);
      expect(await statusOf(arrived.id)).toBe('confirmed');
      expect(await statusOf(waiting.id)).toBe('transferred');
      state.balance = 2000;
      expect((await confirmTreasuryTopups(db, rail, enqueue)).confirmed).toBe(1);
    });

    it('a payout parked for lack of funds resumes after the refill is confirmed, and is then paid once', async () => {
      process.env.TAKASATS__PAYOUTS__SECOND_SIGNOFF_THRESHOLD_SATS = '1000000';
      process.env.TAKASATS__PAYOUTS__REQUIRE_APPROVAL_FIRST_PAYOUT = 'false';
      resetSettingsCache();
      const world = await stewardsOnPayoutWorld();

      // The payout: 2.5 kg of PET = 1000 sats. The hot wallet holds 300, so it must wait.
      const wallet = makeRail(300);
      const sent: number[] = [];
      const payRail: Pick<LightningProvider, 'kind' | 'pay' | 'getFloatBalance'> = {
        kind: 'fake',
        getFloatBalance: wallet.rail.getFloatBalance,
        pay: vi.fn(
          async (
            _destination: PayoutDestination,
            amount: Sats,
            key: string,
          ): Promise<PayResult> => {
            sent.push(amount);
            wallet.state.balance -= amount;
            return { paymentRef: key, amount, feeSats: sats(0), settledAt: NOW };
          },
        ),
      };
      const created = await createPayoutForEvent(db, await seedCollectionEvent(db, world));
      expect(await processPayout(db, payRail, created.id, NOW)).toMatchObject({
        status: 'pending_float',
        lastError: 'insufficient_float',
      });
      expect(sent).toHaveLength(0);

      // The vote: propose, two approvals, signed elsewhere, recorded, then the funds land.
      const approved = await approvedTopup(wallet.rail, 5000);
      await recordTopupTransfer(db, wallet.rail, {
        topupId: approved.id,
        reference: 'pool-transfer-1',
        actor: steward(s.d),
      });
      const enqueue = vi.fn(async () => undefined);
      expect((await confirmTreasuryTopups(db, wallet.rail, enqueue)).confirmed).toBe(0); // not there yet
      expect(enqueue).not.toHaveBeenCalled();

      wallet.state.balance = 300 + 5000;
      expect(await confirmTreasuryTopups(db, wallet.rail, enqueue)).toMatchObject({ confirmed: 1 });
      expect(enqueue).toHaveBeenCalledWith({ payoutId: created.id }); // woken by the existing sweep

      expect(await processPayout(db, payRail, created.id, NOW)).toMatchObject({ status: 'paid' });
      expect(sent).toEqual([1000]); // exactly once
      expect(await verifyChain(db)).toMatchObject({ ok: true });
    });
  });

  describe('the whole flow on the ledger', () => {
    it('writes one entry per state change, names each steward in the record, and the chain verifies', async () => {
      const { rail, state } = makeRail(1000);
      const before = await topupLedgerCount();

      const topup = await propose(50_000, rail); // 1
      await approveTopup(db, rail, { topupId: topup.id, actor: steward(s.b) }); // 2
      await approveTopup(db, rail, { topupId: topup.id, actor: steward(s.c) }); // 3
      await recordTopupTransfer(db, rail, {
        topupId: topup.id,
        reference: 'full-flow-tx',
        actor: steward(s.d),
      }); // 4
      state.balance = 1000 + 50_000;
      await confirmTopup(db, rail, { topupId: topup.id, actor: null }); // 5 (the worker)
      expect(await topupLedgerCount()).toBe(before + 5);

      const view = await getTopupView(db, topup.id);
      expect(view).toMatchObject({
        status: 'confirmed',
        amountSats: 50_000,
        proposedBy: { id: s.proposer.id, name: 'Proposer' },
        approvalsRequired: 2,
        transfer: { reference: 'full-flow-tx', by: { name: 'Steward D' } },
        outcome: { by: null },
      });
      expect(view?.approvals.map((a) => a.by.name)).toEqual(['Steward B', 'Steward C']);
      expect(await verifyChain(db)).toMatchObject({ ok: true, count: before + 5 });
    });

    it('rejection and cancellation are on the chain too', async () => {
      const before = await topupLedgerCount();
      const a = await propose();
      await rejectTopup(db, { topupId: a.id, actor: steward(s.b) });
      const b = await propose();
      await cancelTopup(db, { topupId: b.id, actor: steward(s.proposer) });
      expect(await topupLedgerCount()).toBe(before + 4);
      expect(await verifyChain(db)).toMatchObject({ ok: true });
    });
  });

  describe('reading', () => {
    it('lists newest first, filters by status and pages with an opaque cursor', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        ids.push((await propose(1000 + i)).id);
      }
      await cancelTopup(db, { topupId: ids[0]!, actor: steward(s.proposer) });
      const all = await listTopups(db, {}, { limit: 2 });
      expect(all.topups.map((t) => t.id)).toEqual([ids[2], ids[1]]);
      expect(all.nextCursor).not.toBeNull();
      const rest = await listTopups(db, {}, { limit: 2, cursor: all.nextCursor! });
      expect(rest.topups.map((t) => t.id)).toEqual([ids[0]]);
      expect(rest.nextCursor).toBeNull();
      const cancelled = await listTopups(db, { status: 'cancelled' });
      expect(cancelled.topups.map((t) => t.id)).toEqual([ids[0]]);
    });

    it('the overview shows the float, the cap and its headroom, pending proposals, and an unconfigured pool', async () => {
      configureTreasury({ cap: 10_000 });
      const { rail, state } = makeRail(2000);
      await proposeTopup(db, rail, { amountSats: 3000, actor: steward(s.proposer) });
      const overview = await getTreasuryOverview(db, rail);
      expect(overview.hotWallet).toMatchObject({ available: 2000, lowBalance: true, error: null });
      expect(overview.cap).toEqual({ sats: 10_000, headroomSats: 5000 });
      expect(overview.inFlightSats).toBe(3000);
      expect(overview.pendingTopups).toHaveLength(1);
      expect(overview.pool).toEqual({ configured: false, balanceSats: null });
      expect(overview.pendingPayouts).toEqual({ count: 0, totalSats: 0 });

      state.failing = true;
      const blind = await getTreasuryOverview(db, rail);
      expect(blind.hotWallet).toEqual({
        available: null,
        asOf: null,
        lowBalance: null,
        error: 'float_unavailable',
      });
      expect(blind.cap.headroomSats).toBeNull();
      expect(JSON.stringify(blind)).not.toContain('super-secret-value');
    });
  });
});
