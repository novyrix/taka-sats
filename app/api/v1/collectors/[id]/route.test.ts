// SPDX-License-Identifier: AGPL-3.0-only

import { eq } from 'drizzle-orm';
import type { Session } from 'next-auth';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/auth';
import { getDb } from '@/lib/db/client';
import { collectorPaymentDestinations, collectors } from '@/lib/db/schema';
import { createCollector, createStaff, resetCollectorTables } from '@/lib/testing/fixtures';
import { GET } from './route';

const authMock = auth as unknown as { mockResolvedValue: (value: Session | null) => void };

function sessionFor(role: string, id = 'actor-1'): Session {
  return {
    user: { id, role: role as never, locale: 'en' },
    expires: '2099-01-01T00:00:00.000Z',
  };
}

function getRequest(id: string): NextRequest {
  return new NextRequest(`http://localhost/api/v1/collectors/${id}`);
}

describe('GET /api/v1/collectors/:id — auth (no DB required)', () => {
  it('401s with no session', async () => {
    authMock.mockResolvedValue(null);
    const response = await GET(getRequest('11111111-1111-4111-8111-111111111111'), {
      params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }),
    });
    expect(response.status).toBe(401);
  });

  it('400s on a non-UUID id', async () => {
    authMock.mockResolvedValue(sessionFor('supervisor'));
    const response = await GET(getRequest('not-a-uuid'), {
      params: Promise.resolve({ id: 'not-a-uuid' }),
    });
    expect(response.status).toBe(400);
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('GET /api/v1/collectors/:id — integration', () => {
  const db = hasDatabase ? getDb() : undefined!;

  beforeEach(async () => {
    authMock.mockResolvedValue(sessionFor('supervisor'));
    await resetCollectorTables(db);
  });

  afterAll(async () => {
    await resetCollectorTables(db);
  });

  it('returns the collector', async () => {
    const collector = await createCollector(db);
    const response = await GET(getRequest(collector.id), {
      params: Promise.resolve({ id: collector.id }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.collector.alias).toBe('Amina');
    expect(body.collector.reference.payload).toBe(`takasats:${collector.publicCode}`);
    expect(body.destination).toBeNull(); // no payout destination attached yet
  });

  async function withWallet(registeredBy?: string) {
    const collector = await createCollector(db, registeredBy ? { registeredBy } : {});
    await db.insert(collectorPaymentDestinations).values({
      collectorId: collector.id,
      type: 'lightning_address',
      address: 'sample-card@flow.paybee.buzz',
      providerHint: 'paybee',
      status: 'verified',
      verifiedAt: new Date(),
    });
    await db
      .update(collectors)
      .set({ lightningAddress: 'sample-card@flow.paybee.buzz' })
      .where(eq(collectors.id, collector.id));
    return collector;
  }

  const read = (id: string) => GET(getRequest(id), { params: Promise.resolve({ id }) });

  it('staff see the live payout destination, address included', async () => {
    const collector = await withWallet();
    authMock.mockResolvedValue(sessionFor('hub_lead'));
    const body = await (await read(collector.id)).json();
    expect(body.destination).toMatchObject({
      address: 'sample-card@flow.paybee.buzz',
      providerHint: 'paybee',
      status: 'verified',
    });
    expect(body.collector.lightningAddress).toBe('sample-card@flow.paybee.buzz');
    expect(body.destination).not.toHaveProperty('createdBy');
  });

  it('the registering supervisor sees the address too', async () => {
    const me = await createStaff(db, 'supervisor');
    const collector = await withWallet(me.id);
    authMock.mockResolvedValue(sessionFor('supervisor', me.id));
    const body = await (await read(collector.id)).json();
    expect(body.destination.address).toBe('sample-card@flow.paybee.buzz');
  });

  it('any other supervisor sees that a wallet exists and is verified — never whose it is', async () => {
    const collector = await withWallet(); // not registered by 'actor-1'
    authMock.mockResolvedValue(sessionFor('supervisor'));
    const body = await (await read(collector.id)).json();
    expect(body.destination).toMatchObject({
      address: null,
      status: 'verified',
      providerHint: 'paybee',
    });
    expect(body.collector.lightningAddress).toBeNull();
    expect(body.collector.lnurlPayRaw).toBeNull();
    expect(JSON.stringify(body)).not.toContain('sample-card');
  });

  it('404s for an unknown id', async () => {
    const response = await GET(getRequest('99999999-9999-4999-8999-999999999999'), {
      params: Promise.resolve({ id: '99999999-9999-4999-8999-999999999999' }),
    });
    expect(response.status).toBe(404);
  });
});
