// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The cardless-identity model against a real Postgres (D-24 / D-25 / D-26,
 * ADR-0017 / ADR-0018): public codes, the authorization gate and its ledger
 * trail, and payment destinations — including the Paybee card whose Pay QR is a
 * spend link and must never be accepted. Skipped without `DATABASE_URL`.
 */

import { bech32 } from 'bech32';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetSettingsCache } from '@/lib/config';
import { getDb } from '@/lib/db/client';
import {
  collectorAuthorizations,
  collectorPaymentDestinations,
  collectors,
  ledgerEntries,
} from '@/lib/db/schema';
import { verifyChain } from '@/lib/ledger';
import { LightningEndpointUnreachableError } from '@/lib/lightning/errors';
import { FakeLightningProvider } from '@/lib/lightning/FakeLightningProvider';
import type { LightningProvider } from '@/lib/lightning/LightningProvider';
import { sats } from '@/lib/money';
import {
  createCollector,
  createStaff,
  resetCollectorTables,
  type StaffFixture,
} from '@/lib/testing/fixtures';
import {
  attachDestination,
  CollectorNotAuthorizedError,
  CollectorNotFoundError,
  CollectorNotYoursError,
  completeDestinationValidation,
  decideCollectorAuthorization,
  DestinationInUseError,
  DestinationNotFoundError,
  DestinationReplaceForbiddenError,
  enrolCollector,
  getLiveDestination,
  listActiveCollectors,
  listDestinations,
  revokeDestination,
  searchCollectors,
} from './index';

const hasDatabase = Boolean(process.env.DATABASE_URL);

/** The two sides of a real Paybee card. */
const PAYBEE_RECEIVE = 'sample-card@flow.paybee.buzz';
const PAYBEE_PAY_SIDE = 'https://card.paybee.buzz/sample-card';

const unreachable: Pick<LightningProvider, 'resolveReceiveAddress'> = {
  resolveReceiveAddress: () => Promise.reject(new LightningEndpointUnreachableError('down')),
};

const accepting: Pick<LightningProvider, 'resolveReceiveAddress'> = {
  resolveReceiveAddress: (raw) =>
    Promise.resolve({
      lnurlOrAddress: raw,
      receiveCapable: true,
      minSendableSats: sats(1),
      maxSendableSats: sats(1_000_000),
    }),
};

describe.skipIf(!hasDatabase)('cardless identity (integration)', () => {
  const db = hasDatabase ? getDb() : undefined!;
  const provider = new FakeLightningProvider();
  let admin: StaffFixture;
  let hubLead: StaffFixture;
  let supervisor: StaffFixture;

  beforeEach(async () => {
    await resetCollectorTables(db);
    admin = await createStaff(db, 'admin');
    hubLead = await createStaff(db, 'hub_lead');
    supervisor = await createStaff(db, 'supervisor');
  });

  afterEach(() => {
    delete process.env.TAKASATS__COLLECTORS__AUTHORIZATION_REQUIRED;
    resetSettingsCache();
  });

  afterAll(async () => {
    await resetCollectorTables(db);
  });

  describe('registration and public codes', () => {
    it("registers a supervisor's collector as pending, with a public code and the registrar", async () => {
      const collector = await enrolCollector(db, { alias: 'Akinyi' }, supervisor);
      expect(collector.status).toBe('pending');
      expect(collector.publicCode).toBe('TS-0001');
      expect(collector.registeredBy).toBe(supervisor.id);
      expect(collector.authorizedBy).toBeNull();
      expect(collector.authorizedAt).toBeNull();
      expect(await db.select().from(collectorAuthorizations)).toHaveLength(0);
    });

    it('allocates sequential codes and honours a site code', async () => {
      const a = await enrolCollector(db, { alias: 'A', siteCode: 'kbr' }, supervisor);
      const b = await enrolCollector(db, { alias: 'B', siteCode: 'KBR' }, supervisor);
      const c = await enrolCollector(db, { alias: 'C' }, supervisor);
      expect([a.publicCode, b.publicCode, c.publicCode]).toEqual([
        'TS-KBR-0001',
        'TS-KBR-0002',
        'TS-0003',
      ]);
    });

    it.each(['hub_lead', 'admin'] as const)(
      'registers a collector %s creates as already authorized — and records who decided',
      async (role) => {
        const actor = role === 'admin' ? admin : hubLead;
        const collector = await enrolCollector(db, { alias: 'Musa' }, actor);
        expect(collector.status).toBe('active');
        expect(collector.authorizedBy).toBe(actor.id);
        expect(collector.authorizedAt).not.toBeNull();

        const [decision] = await db
          .select()
          .from(collectorAuthorizations)
          .where(eq(collectorAuthorizations.collectorId, collector.id));
        expect(decision?.decision).toBe('authorized');
        expect(decision?.decidedBy).toBe(actor.id);
      },
    );

    it('is idempotent on a client-supplied id — same row, same code, one decision', async () => {
      const id = '11111111-1111-4111-8111-111111111111';
      const first = await enrolCollector(db, { id, alias: 'Jane' }, admin);
      const second = await enrolCollector(db, { id, alias: 'Jane (resent)' }, supervisor);
      expect(second.id).toBe(first.id);
      expect(second.publicCode).toBe(first.publicCode);
      expect(second.alias).toBe('Jane');
      expect(await db.select().from(collectorAuthorizations)).toHaveLength(1);
    });

    it('registers everyone as active when the gate is switched off', async () => {
      process.env.TAKASATS__COLLECTORS__AUTHORIZATION_REQUIRED = 'false';
      resetSettingsCache();

      const collector = await enrolCollector(db, { alias: 'Ungated' }, supervisor);
      expect(collector.status).toBe('active');
      // Nobody decided anything, so there is no decision to audit.
      expect(await db.select().from(collectorAuthorizations)).toHaveLength(0);
    });
  });

  describe('the authorization gate', () => {
    it('authorizes a pending collector, anchoring the decision in the ledger', async () => {
      const pending = await enrolCollector(db, { alias: 'Akinyi' }, supervisor);

      const { collector, changed } = await decideCollectorAuthorization(db, {
        collectorId: pending.id,
        decision: 'authorize',
        reason: 'ID seen at the hub',
        actor: hubLead,
      });
      expect(changed).toBe(true);
      expect(collector.status).toBe('active');
      expect(collector.authorizedBy).toBe(hubLead.id);

      const [decision] = await db.select().from(collectorAuthorizations);
      expect(decision?.reason).toBe('ID seen at the hub');
      const [entry] = await db
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.id, decision!.ledgerEntryId));
      expect(entry?.entryType).toBe('collector_authorization');
      expect((await verifyChain(db)).ok).toBe(true);
    });

    it('is idempotent — re-deciding the same state writes nothing', async () => {
      const pending = await enrolCollector(db, { alias: 'Akinyi' }, supervisor);
      await decideCollectorAuthorization(db, {
        collectorId: pending.id,
        decision: 'authorize',
        actor: admin,
      });

      const again = await decideCollectorAuthorization(db, {
        collectorId: pending.id,
        decision: 'authorize',
        actor: admin,
      });
      expect(again.changed).toBe(false);
      expect(await db.select().from(collectorAuthorizations)).toHaveLength(1);
      expect(await db.select().from(ledgerEntries)).toHaveLength(1);
    });

    it('revokes, and re-authorizes — every decision is a new row, history is kept', async () => {
      const c = await enrolCollector(db, { alias: 'Akinyi' }, admin);

      const revoked = await decideCollectorAuthorization(db, {
        collectorId: c.id,
        decision: 'revoke',
        reason: 'duplicate registration',
        actor: admin,
      });
      expect(revoked.collector.status).toBe('revoked');

      const back = await decideCollectorAuthorization(db, {
        collectorId: c.id,
        decision: 'authorize',
        actor: hubLead,
      });
      expect(back.collector.status).toBe('active');
      expect(back.collector.authorizedBy).toBe(hubLead.id);

      const history = await db
        .select()
        .from(collectorAuthorizations)
        .where(eq(collectorAuthorizations.collectorId, c.id));
      expect(history.map((h) => h.decision).sort()).toEqual([
        'authorized',
        'authorized',
        'revoked',
      ]);
      expect((await verifyChain(db)).ok).toBe(true);
    });

    it('throws CollectorNotFoundError for an unknown collector', async () => {
      await expect(
        decideCollectorAuthorization(db, {
          collectorId: '00000000-0000-4000-8000-000000000000',
          decision: 'authorize',
          actor: admin,
        }),
      ).rejects.toThrow(CollectorNotFoundError);
    });

    it('keeps pending and revoked collectors out of the offline cache', async () => {
      const active = await enrolCollector(db, { alias: 'In' }, admin);
      await enrolCollector(db, { alias: 'Waiting' }, supervisor);
      const gone = await enrolCollector(db, { alias: 'Gone' }, admin);
      await decideCollectorAuthorization(db, {
        collectorId: gone.id,
        decision: 'revoke',
        actor: admin,
      });

      const cached = await listActiveCollectors(db);
      expect(cached.map((c) => c.id)).toEqual([active.id]);
      expect(cached[0]?.publicCode).toBe(active.publicCode);
    });
  });

  describe('payment destinations', () => {
    it('attaches a Paybee Receive address: verified, labelled, lower-cased, copied to the collector', async () => {
      const c = await createCollector(db, { registeredBy: supervisor.id });
      const { destination, needsValidation } = await attachDestination(
        db,
        provider,
        { collectorId: c.id, rawCode: `  ${PAYBEE_RECEIVE.toUpperCase()} ` },
        supervisor,
      );

      expect(needsValidation).toBe(false);
      expect(destination).toMatchObject({
        type: 'lightning_address',
        address: PAYBEE_RECEIVE,
        providerHint: 'paybee',
        status: 'verified',
        createdBy: supervisor.id,
      });
      expect(destination.verifiedAt).not.toBeNull();

      const [reloaded] = await db.select().from(collectors).where(eq(collectors.id, c.id));
      expect(reloaded?.lightningAddress).toBe(PAYBEE_RECEIVE);
    });

    it("rejects the Paybee card's PAY side — a spend link — and stores nothing", async () => {
      const c = await createCollector(db, { registeredBy: supervisor.id });
      await expect(
        attachDestination(
          db,
          provider,
          { collectorId: c.id, rawCode: PAYBEE_PAY_SIDE },
          supervisor,
        ),
      ).rejects.toMatchObject({ name: 'SpendCredentialRejectedError' });

      expect(await db.select().from(collectorPaymentDestinations)).toHaveLength(0);
      const [reloaded] = await db.select().from(collectors).where(eq(collectors.id, c.id));
      expect(reloaded?.lightningAddress).toBeNull();
      expect(reloaded?.lnurlPayRaw).toBeNull();
    });

    it('rejects a withdraw code and stores nothing (ADR-0001)', async () => {
      const c = await createCollector(db, { registeredBy: supervisor.id });
      await expect(
        attachDestination(
          db,
          provider,
          { collectorId: c.id, rawCode: 'withdraw@evil.test' },
          supervisor,
        ),
      ).rejects.toThrow();
      expect(await db.select().from(collectorPaymentDestinations)).toHaveLength(0);
    });

    it('rejects something that is not a payment code at all', async () => {
      const c = await createCollector(db, { registeredBy: supervisor.id });
      await expect(
        attachDestination(db, provider, { collectorId: c.id, rawCode: 'Akinyi' }, supervisor),
      ).rejects.toMatchObject({ name: 'InvalidLightningAddressError' });
    });

    it('is idempotent for the same address', async () => {
      const c = await createCollector(db, { registeredBy: supervisor.id });
      const first = await attachDestination(
        db,
        provider,
        { collectorId: c.id, rawCode: 'amina@blink.sv' },
        supervisor,
      );
      const again = await attachDestination(
        db,
        provider,
        { collectorId: c.id, rawCode: 'AMINA@blink.sv' },
        supervisor,
      );
      expect(again.destination.id).toBe(first.destination.id);
      expect(await listDestinations(db, c.id)).toHaveLength(1);
    });

    it('refuses the same wallet spelled another way — a bech32 or LUD-16 URL cannot dodge uniqueness', async () => {
      const a = await createCollector(db, { alias: 'A' });
      await attachDestination(db, provider, { collectorId: a.id, rawCode: 'me@blink.sv' }, admin);

      const spellings = [
        'ME@Blink.SV',
        'https://blink.sv/.well-known/lnurlp/me',
        bech32.encode(
          'lnurl',
          bech32.toWords(Buffer.from('https://blink.sv/.well-known/lnurlp/me')),
          4000,
        ),
      ];
      for (const rawCode of spellings) {
        const ghost = await createCollector(db, { alias: 'Ghost' });
        await expect(
          attachDestination(db, provider, { collectorId: ghost.id, rawCode }, admin),
        ).rejects.toThrow(DestinationInUseError);
        expect(await getLiveDestination(db, ghost.id)).toBeNull();
      }
    });

    it('refuses an address that is live for another collector — without saying whose', async () => {
      const a = await createCollector(db, { alias: 'A' });
      const b = await createCollector(db, { alias: 'B' });
      await attachDestination(
        db,
        provider,
        { collectorId: a.id, rawCode: 'shared@blink.sv' },
        admin,
      );

      const error = await attachDestination(
        db,
        provider,
        { collectorId: b.id, rawCode: 'shared@blink.sv' },
        admin,
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(DestinationInUseError);
      expect((error as Error).message).toBe('This payment destination is already in use');
      expect((error as Error).message).not.toContain(a.id);
      expect(await getLiveDestination(db, b.id)).toBeNull();
    });

    it('lets only staff replace a verified destination, and keeps the history', async () => {
      const c = await createCollector(db, { registeredBy: supervisor.id });
      await attachDestination(
        db,
        provider,
        { collectorId: c.id, rawCode: 'old@blink.sv' },
        supervisor,
      );

      await expect(
        attachDestination(
          db,
          provider,
          { collectorId: c.id, rawCode: 'thief@blink.sv' },
          supervisor,
        ),
      ).rejects.toThrow(DestinationReplaceForbiddenError);
      expect((await getLiveDestination(db, c.id))?.address).toBe('old@blink.sv');

      await attachDestination(
        db,
        provider,
        { collectorId: c.id, rawCode: 'new@blink.sv' },
        hubLead,
      );
      const live = await getLiveDestination(db, c.id);
      expect(live?.address).toBe('new@blink.sv');

      const history = await listDestinations(db, c.id);
      expect(history.map((d) => [d.address, d.status]).sort()).toEqual([
        ['new@blink.sv', 'verified'],
        ['old@blink.sv', 'revoked'],
      ]);
      const [reloaded] = await db.select().from(collectors).where(eq(collectors.id, c.id));
      expect(reloaded?.lightningAddress).toBe('new@blink.sv');
    });

    it('lets the registering supervisor correct a wallet until the collector is authorized', async () => {
      const c = await createCollector(db, { status: 'pending', registeredBy: supervisor.id });
      await attachDestination(
        db,
        unreachable,
        { collectorId: c.id, rawCode: 'typo@blink.sv' },
        supervisor,
      );
      const fixed = await attachDestination(
        db,
        provider,
        { collectorId: c.id, rawCode: 'right@blink.sv' },
        supervisor,
      );
      expect(fixed.destination.status).toBe('verified');
      expect((await getLiveDestination(db, c.id))?.address).toBe('right@blink.sv');
    });

    it('does NOT let a supervisor swap the wallet staff just authorized — even an unverified one', async () => {
      // The attack: attach an unreachable address, let staff authorize after reviewing it,
      // then replace it with the supervisor's own wallet.
      const c = await createCollector(db, { status: 'pending', registeredBy: supervisor.id });
      await attachDestination(
        db,
        unreachable,
        { collectorId: c.id, rawCode: 'shown-to-staff@blink.sv' },
        supervisor,
      );
      await decideCollectorAuthorization(db, {
        collectorId: c.id,
        decision: 'authorize',
        actor: hubLead,
      });

      await expect(
        attachDestination(
          db,
          provider,
          { collectorId: c.id, rawCode: 'mine@blink.sv' },
          supervisor,
        ),
      ).rejects.toThrow(DestinationReplaceForbiddenError);
      expect((await getLiveDestination(db, c.id))?.address).toBe('shown-to-staff@blink.sv');

      // Staff still can.
      const swapped = await attachDestination(
        db,
        provider,
        { collectorId: c.id, rawCode: 'staff-chose@blink.sv' },
        hubLead,
      );
      expect(swapped.destination.address).toBe('staff-chose@blink.sv');
    });

    it('a supervisor who did NOT register the collector cannot set its wallet', async () => {
      // The attack: an active collector whose payouts are parked awaiting a wallet; a second
      // supervisor (another hub, or off shift) attaches their own and releases the backlog.
      const c = await createCollector(db, { status: 'active', registeredBy: supervisor.id });
      const other = await createStaff(db, 'supervisor');

      await expect(
        attachDestination(db, provider, { collectorId: c.id, rawCode: 'thief@blink.sv' }, other),
      ).rejects.toThrow(CollectorNotYoursError);
      expect(await getLiveDestination(db, c.id)).toBeNull();
    });

    it('a collector registered by staff has no supervisor who can set its wallet', async () => {
      const c = await createCollector(db, { status: 'active', registeredBy: admin.id });
      await expect(
        attachDestination(db, provider, { collectorId: c.id, rawCode: 'x@blink.sv' }, supervisor),
      ).rejects.toThrow(CollectorNotYoursError);
      // …but a pre-gate collector (registered_by NULL) is staff-only too.
      const legacy = await createCollector(db, { status: 'active', registeredBy: null });
      await expect(
        attachDestination(
          db,
          provider,
          { collectorId: legacy.id, rawCode: 'y@blink.sv' },
          supervisor,
        ),
      ).rejects.toThrow(CollectorNotYoursError);
    });

    it('the registrar may still add a first wallet to a collector who has none (first-payout approval is the control)', async () => {
      const c = await createCollector(db, { status: 'active', registeredBy: supervisor.id });
      const { destination } = await attachDestination(
        db,
        provider,
        { collectorId: c.id, rawCode: 'first@blink.sv' },
        supervisor,
      );
      expect(destination.status).toBe('verified');
    });

    it('refuses a revoked collector', async () => {
      const c = await createCollector(db, { status: 'revoked' });
      await expect(
        attachDestination(db, provider, { collectorId: c.id, rawCode: 'a@blink.sv' }, admin),
      ).rejects.toThrow(CollectorNotAuthorizedError);
    });

    it('allows a pending collector to receive a destination (so staff can review it)', async () => {
      const c = await enrolCollector(db, { alias: 'Pending' }, supervisor);
      const { destination } = await attachDestination(
        db,
        provider,
        { collectorId: c.id, rawCode: 'pending@blink.sv' },
        supervisor,
      );
      expect(destination.status).toBe('verified');
    });

    it('throws CollectorNotFoundError for an unknown collector', async () => {
      await expect(
        attachDestination(
          db,
          provider,
          { collectorId: '00000000-0000-4000-8000-000000000000', rawCode: 'a@blink.sv' },
          admin,
        ),
      ).rejects.toThrow(CollectorNotFoundError);
    });

    describe('an unreachable wallet host', () => {
      it('stores pending_validation instead of failing', async () => {
        const c = await createCollector(db, { registeredBy: supervisor.id });
        const { destination, needsValidation } = await attachDestination(
          db,
          unreachable,
          { collectorId: c.id, rawCode: PAYBEE_RECEIVE },
          supervisor,
        );
        expect(needsValidation).toBe(true);
        expect(destination.status).toBe('pending_validation');
        expect(destination.verifiedAt).toBeNull();
      });

      it('is verified by the worker once the host answers', async () => {
        const c = await createCollector(db, { registeredBy: supervisor.id });
        const { destination } = await attachDestination(
          db,
          unreachable,
          { collectorId: c.id, rawCode: PAYBEE_RECEIVE },
          supervisor,
        );

        await expect(
          completeDestinationValidation(db, unreachable, destination.id),
        ).rejects.toThrow(LightningEndpointUnreachableError); // pg-boss retries
        expect((await getLiveDestination(db, c.id))?.status).toBe('pending_validation');

        expect(await completeDestinationValidation(db, provider, destination.id)).toBe('verified');
        expect((await getLiveDestination(db, c.id))?.status).toBe('verified');
      });

      it('is marked invalid — and the address freed — when the worker finds it is not receive-capable', async () => {
        const c = await createCollector(db, { registeredBy: supervisor.id });
        const { destination } = await attachDestination(
          db,
          unreachable,
          { collectorId: c.id, rawCode: 'withdraw@evil.test' },
          supervisor,
        );

        expect(await completeDestinationValidation(db, provider, destination.id)).toBe('invalid');
        expect(await getLiveDestination(db, c.id)).toBeNull();
        const [reloaded] = await db
          .select()
          .from(collectorPaymentDestinations)
          .where(eq(collectorPaymentDestinations.id, destination.id));
        expect(reloaded?.validationError).toBe('not_receive_capable');
        const [collector] = await db.select().from(collectors).where(eq(collectors.id, c.id));
        expect(collector?.lightningAddress).toBeNull();

        // The address is no longer held, so another collector's check is the provider's alone.
        const other = await createCollector(db);
        const taken = await attachDestination(
          db,
          accepting,
          { collectorId: other.id, rawCode: 'withdraw@evil.test' },
          admin,
        );
        expect(taken.destination.status).toBe('verified');
      });

      it('is a no-op for a destination that is not pending', async () => {
        const c = await createCollector(db);
        const { destination } = await attachDestination(
          db,
          provider,
          { collectorId: c.id, rawCode: 'ok@blink.sv' },
          admin,
        );
        expect(await completeDestinationValidation(db, provider, destination.id)).toBe('verified');
        expect(
          await completeDestinationValidation(db, provider, '00000000-0000-4000-8000-000000000000'),
        ).toBeNull();
      });
    });

    describe('revokeDestination', () => {
      it('revokes, clears the collector copy, and is idempotent', async () => {
        const c = await createCollector(db);
        const { destination } = await attachDestination(
          db,
          provider,
          { collectorId: c.id, rawCode: 'gone@blink.sv' },
          admin,
        );

        const revoked = await revokeDestination(db, {
          collectorId: c.id,
          destinationId: destination.id,
          actor: admin,
        });
        expect(revoked.status).toBe('revoked');
        expect(revoked.revokedBy).toBe(admin.id);
        expect(await getLiveDestination(db, c.id)).toBeNull();
        const [reloaded] = await db.select().from(collectors).where(eq(collectors.id, c.id));
        expect(reloaded?.lightningAddress).toBeNull();

        const again = await revokeDestination(db, {
          collectorId: c.id,
          destinationId: destination.id,
          actor: admin,
        });
        expect(again.status).toBe('revoked');
      });

      it("will not revoke another collector's destination", async () => {
        const a = await createCollector(db);
        const b = await createCollector(db);
        const { destination } = await attachDestination(
          db,
          provider,
          { collectorId: a.id, rawCode: 'a@blink.sv' },
          admin,
        );
        await expect(
          revokeDestination(db, { collectorId: b.id, destinationId: destination.id, actor: admin }),
        ).rejects.toThrow(DestinationNotFoundError);
        expect((await getLiveDestination(db, a.id))?.status).toBe('verified');
      });
    });
  });

  describe('searchCollectors', () => {
    it('finds by alias or by code (a bare 0042 finds TS-KBR-0042)', async () => {
      await createCollector(db, { alias: 'Akinyi', publicCode: 'TS-KBR-0042' });
      await createCollector(db, { alias: 'Musa', publicCode: 'TS-KBR-0043' });

      expect((await searchCollectors(db, { q: 'akin' })).map((c) => c.alias)).toEqual(['Akinyi']);
      expect((await searchCollectors(db, { q: '0042' })).map((c) => c.alias)).toEqual(['Akinyi']);
      expect((await searchCollectors(db, { q: 'ts-kbr-0043' })).map((c) => c.alias)).toEqual([
        'Musa',
      ]);
    });

    it('treats LIKE wildcards literally', async () => {
      await createCollector(db, { alias: 'Akinyi' });
      expect(await searchCollectors(db, { q: '%' })).toHaveLength(0);
      expect(await searchCollectors(db, { q: '_' })).toHaveLength(0);
    });

    it('defaults to active collectors and can filter by status and registrar', async () => {
      await createCollector(db, { alias: 'In', status: 'active' });
      const mine = await enrolCollector(db, { alias: 'Mine' }, supervisor);
      await enrolCollector(db, { alias: 'Theirs' }, await createStaff(db, 'supervisor'));

      expect((await searchCollectors(db, {})).map((c) => c.alias)).toEqual(['In']);
      expect(
        (await searchCollectors(db, { status: 'pending' })).map((c) => c.alias).sort(),
      ).toEqual(['Mine', 'Theirs']);
      expect(
        (await searchCollectors(db, { status: 'pending', registeredBy: supervisor.id })).map(
          (c) => c.id,
        ),
      ).toEqual([mine.id]);
      expect(await searchCollectors(db, { status: 'all' })).toHaveLength(3);
    });
  });
});
