// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Integration tests against a real Postgres (M1 exit criteria). Skipped
 * unless `DATABASE_URL` is set — CI's `integration` job (`.github/workflows/ci.yml`)
 * runs `pnpm db:migrate` against an ephemeral Postgres service first, then
 * `pnpm test`, which exercises this file for real. Run locally with:
 *
 *   docker compose up -d postgres
 *   DATABASE_URL=postgresql://taka_sats:local-development-only@localhost:5432/taka_sats pnpm db:migrate
 *   DATABASE_URL=postgresql://taka_sats:local-development-only@localhost:5432/taka_sats pnpm test
 */

import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db/client';
import { collectors, tagHistory } from '@/lib/db/schema';
import { createStaff, resetCollectorTables, type StaffFixture } from '@/lib/testing/fixtures';
import {
  CollectorNotAuthorizedError,
  enrolCollector,
  findActiveTagMapping,
  isTagRevoked,
  ProvisioningDisabledError,
  reissueTag,
  revokeTag,
  TagAlreadyActiveError,
} from './index';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('lib/collectors (integration)', () => {
  const db = hasDatabase ? getDb() : undefined!;
  let admin: StaffFixture;

  beforeEach(async () => {
    await resetCollectorTables(db);
    admin = await createStaff(db, 'admin');
  });

  afterAll(async () => {
    await resetCollectorTables(db);
  });

  it('enrols a collector with only an alias', async () => {
    const collector = await enrolCollector(db, { alias: 'Amina' }, admin);
    expect(collector.alias).toBe('Amina');
    expect(collector.status).toBe('active'); // staff with collector:authorize register pre-authorized
    expect(collector.addressSource).toBe('byo'); // settings.custody.default_address_source
    expect(collector.lightningAddress).toBeNull();
    expect(collector.nfcTagId).toBeNull();
  });

  it('rejects enrolling as provisioned while provisioning is disabled (gate G1)', async () => {
    await expect(
      enrolCollector(db, { alias: 'Brian', addressSource: 'provisioned' }, admin),
    ).rejects.toThrow(ProvisioningDisabledError);
  });

  it('rejects an empty alias', async () => {
    await expect(enrolCollector(db, { alias: '   ' }, admin)).rejects.toThrow();
  });

  describe('tag lifecycle', () => {
    it('issues, reissues (history preserved), and revokes', async () => {
      const collector = await enrolCollector(db, { alias: 'Amina' }, admin);

      const first = await reissueTag(db, { collectorId: collector.id, newTagId: 'TAG-001' });
      expect(first.tagId).toBe('TAG-001');
      expect(first.revokedAt).toBeNull();

      const [afterFirst] = await db
        .select()
        .from(collectors)
        .where(sql`${collectors.id} = ${collector.id}`);
      expect(afterFirst?.nfcTagId).toBe('TAG-001');

      // Reissue: old tag closes, new tag becomes active, history keeps both rows.
      const second = await reissueTag(db, { collectorId: collector.id, newTagId: 'TAG-002' });
      expect(second.tagId).toBe('TAG-002');

      const history = await db
        .select()
        .from(tagHistory)
        .where(sql`${tagHistory.collectorId} = ${collector.id}`);
      expect(history).toHaveLength(2);
      expect(history.find((h) => h.tagId === 'TAG-001')?.revokedAt).not.toBeNull();
      expect(history.find((h) => h.tagId === 'TAG-002')?.revokedAt).toBeNull();

      const [afterReissue] = await db
        .select()
        .from(collectors)
        .where(sql`${collectors.id} = ${collector.id}`);
      expect(afterReissue?.nfcTagId).toBe('TAG-002');

      // Revoke the active tag: collector's denormalised tag clears; earnings-affecting
      // fields (alias, id) are untouched.
      const revoked = await revokeTag(db, { tagId: 'TAG-002' });
      expect(revoked?.revokedAt).not.toBeNull();

      const [afterRevoke] = await db
        .select()
        .from(collectors)
        .where(sql`${collectors.id} = ${collector.id}`);
      expect(afterRevoke?.nfcTagId).toBeNull();
      expect(afterRevoke?.alias).toBe('Amina'); // untouched
    });

    it('rejects mapping a tag id that is already active for another collector', async () => {
      const a = await enrolCollector(db, { alias: 'Amina' }, admin);
      const b = await enrolCollector(db, { alias: 'Brian' }, admin);

      await reissueTag(db, { collectorId: a.id, newTagId: 'SHARED-TAG' });
      await expect(reissueTag(db, { collectorId: b.id, newTagId: 'SHARED-TAG' })).rejects.toThrow(
        TagAlreadyActiveError,
      );
    });

    it('allows a revoked tag id to be reissued to a different collector', async () => {
      const a = await enrolCollector(db, { alias: 'Amina' }, admin);
      const b = await enrolCollector(db, { alias: 'Brian' }, admin);

      await reissueTag(db, { collectorId: a.id, newTagId: 'RECYCLED-TAG' });
      await revokeTag(db, { tagId: 'RECYCLED-TAG' });

      const reissuedToB = await reissueTag(db, { collectorId: b.id, newTagId: 'RECYCLED-TAG' });
      expect(reissuedToB.collectorId).toBe(b.id);

      const mapping = await findActiveTagMapping(db, 'RECYCLED-TAG');
      expect(mapping?.collector.id).toBe(b.id);
    });

    it('revoking one tag does not affect another collector (revocation is per tag_id)', async () => {
      const a = await enrolCollector(db, { alias: 'Amina' }, admin);
      const b = await enrolCollector(db, { alias: 'Brian' }, admin);
      await reissueTag(db, { collectorId: a.id, newTagId: 'TAG-A' });
      await reissueTag(db, { collectorId: b.id, newTagId: 'TAG-B' });

      await revokeTag(db, { tagId: 'TAG-A' });

      const [reloadedB] = await db
        .select()
        .from(collectors)
        .where(sql`${collectors.id} = ${b.id}`);
      expect(reloadedB?.nfcTagId).toBe('TAG-B');
      expect(await isTagRevoked(db, 'TAG-B')).toBe(false);
      expect(await isTagRevoked(db, 'TAG-A')).toBe(true);
    });

    it('revoking a tag with no active mapping is a no-op, not an error', async () => {
      const result = await revokeTag(db, { tagId: 'NEVER-ISSUED' });
      expect(result).toBeNull();
    });

    it('refuses to issue a tag to a collector who is not authorized (D-25)', async () => {
      const supervisor = await createStaff(db, 'supervisor');
      const pending = await enrolCollector(db, { alias: 'Pending' }, supervisor);
      expect(pending.status).toBe('pending');

      await expect(
        reissueTag(db, { collectorId: pending.id, newTagId: 'TAG-NOPE' }),
      ).rejects.toThrow(CollectorNotAuthorizedError);
      expect(await findActiveTagMapping(db, 'TAG-NOPE')).toBeNull();
    });

    it('findActiveTagMapping returns null for an unknown tag', async () => {
      expect(await findActiveTagMapping(db, 'NOPE')).toBeNull();
    });
  });
});
