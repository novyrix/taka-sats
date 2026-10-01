// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `/api/v1/treasury` over the route handlers (M5-7): the RBAC wall first (no database), then the
 * whole funding vote through HTTP against a real Postgres, including the refusals a steward
 * should meet (self-approval, cap, a closed proposal) and what the response must never carry.
 */

import type { Session } from 'next-auth';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/jobs', () => ({ enqueueSweepPayoutsSafely: vi.fn(async () => undefined) }));
vi.mock('@/lib/lightning', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/lightning')>()),
  getLightningProvider: vi.fn(),
}));

import { auth } from '@/auth';
import { getDb } from '@/lib/db/client';
import { enqueueSweepPayoutsSafely } from '@/lib/jobs';
import { getLightningProvider } from '@/lib/lightning';
import {
  clearTreasuryConfig,
  configureTreasury,
  makeRail,
  type Stewards,
  seedStewards,
} from '@/lib/testing/treasury-fixtures';
import { GET as OVERVIEW } from './route';
import { GET as LIST, POST as PROPOSE } from './topups/route';
import { GET as DETAIL } from './topups/[id]/route';
import { POST as SIGNOFF } from './topups/[id]/signoff/route';
import { POST as TRANSFER } from './topups/[id]/transfer/route';
import { POST as CANCEL } from './topups/[id]/cancel/route';
import { POST as REJECT } from './topups/[id]/reject/route';
import { POST as CONFIRM } from './topups/[id]/confirm/route';

const authMock = auth as unknown as { mockResolvedValue: (value: Session | null) => void };
const session = (id: string, role: string): Session => ({
  user: { id, role: role as never, locale: 'en' },
  expires: '2099-01-01T00:00:00.000Z',
});
const UNKNOWN = '00000000-0000-4000-8000-000000000000';
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });
const url = (path: string) => `http://localhost/api/v1/treasury${path}`;
const get = (path: string) => new NextRequest(url(path));
const post = (path: string, body?: unknown) =>
  new NextRequest(url(path), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });

/** Every treasury endpoint, callable with a path-less request, for the RBAC sweep. */
const ENDPOINTS: readonly (readonly [string, () => Promise<Response>])[] = [
  ['GET /treasury', () => OVERVIEW()],
  ['GET /treasury/topups', () => LIST(get('/topups'))],
  ['POST /treasury/topups', () => PROPOSE(post('/topups', { amountSats: 1000 }))],
  ['GET /treasury/topups/:id', () => DETAIL(get(`/topups/${UNKNOWN}`), idParams(UNKNOWN))],
  ['POST …/signoff', () => SIGNOFF(post(`/topups/${UNKNOWN}/signoff`), idParams(UNKNOWN))],
  [
    'POST …/transfer',
    () => TRANSFER(post(`/topups/${UNKNOWN}/transfer`, { reference: 'abc' }), idParams(UNKNOWN)),
  ],
  ['POST …/cancel', () => CANCEL(post(`/topups/${UNKNOWN}/cancel`, {}), idParams(UNKNOWN))],
  ['POST …/reject', () => REJECT(post(`/topups/${UNKNOWN}/reject`, {}), idParams(UNKNOWN))],
  ['POST …/confirm', () => CONFIRM(post(`/topups/${UNKNOWN}/confirm`), idParams(UNKNOWN))],
];

describe('/api/v1/treasury: the RBAC wall (no database)', () => {
  it.each(ENDPOINTS)('401 without a session: %s', async (_name, call) => {
    authMock.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });

  it.each(ENDPOINTS)('403 for supervisor, hub_lead and partner: %s', async (_name, call) => {
    for (const role of ['supervisor', 'hub_lead', 'partner']) {
      authMock.mockResolvedValue(session('someone', role));
      expect((await call()).status).toBe(403);
    }
  });

  it('400 for a malformed id, amount, reference or body (before any database access)', async () => {
    authMock.mockResolvedValue(session('a', 'admin'));
    expect((await DETAIL(get('/topups/nope'), idParams('nope'))).status).toBe(400);
    expect((await SIGNOFF(post('/topups/nope/signoff'), idParams('nope'))).status).toBe(400);
    for (const body of [
      { amountSats: 0 },
      { amountSats: -5 },
      { amountSats: 1.5 },
      { amountSats: '100' },
      { amountSats: null },
      {},
      { amountSats: 100, destination: 'attacker@example.com' }, // no field may carry a destination
      { amountSats: 100, id: 'not-a-uuid' },
      null,
    ]) {
      const response = await PROPOSE(post('/topups', body));
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        'invalid_request',
      );
    }
    expect(
      (await TRANSFER(post(`/topups/${UNKNOWN}/transfer`, {}), idParams(UNKNOWN))).status,
    ).toBe(400);
    expect(
      (
        await TRANSFER(
          post(`/topups/${UNKNOWN}/transfer`, { reference: 'has space' }),
          idParams(UNKNOWN),
        )
      ).status,
    ).toBe(400);
    expect((await LIST(get('/topups?status=bogus'))).status).toBe(400);
    expect((await LIST(get('/topups?limit=0'))).status).toBe(400);
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('/api/v1/treasury: the vote over HTTP', () => {
  let s: Stewards;
  let wallet: ReturnType<typeof makeRail>;
  // Response bodies are asserted field by field; a loose type keeps that readable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = async (response: Response) => (await response.json()) as Record<string, any>;
  const as = (who: { id: string; role: string }) =>
    authMock.mockResolvedValue(session(who.id, who.role));

  beforeEach(async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    configureTreasury({ approvals: 2, cap: 0 });
    s = await seedStewards(getDb());
    wallet = makeRail(1000);
    vi.mocked(getLightningProvider).mockReturnValue(wallet.rail as never);
    vi.mocked(enqueueSweepPayoutsSafely).mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    clearTreasuryConfig();
  });

  async function propose(amountSats = 50_000): Promise<string> {
    as(s.proposer);
    const response = await PROPOSE(post('/topups', { amountSats, note: 'two weeks' }));
    expect(response.status).toBe(201);
    return (await json(response)).topup.id as string;
  }
  async function signoff(who: { id: string; role: string }, id: string): Promise<Response> {
    as(who);
    return SIGNOFF(post(`/topups/${id}/signoff`), idParams(id));
  }
  async function approved(): Promise<string> {
    const id = await propose();
    await signoff(s.b, id);
    await signoff(s.c, id);
    return id;
  }

  it('runs the whole vote: propose, two approvals, transfer recorded, arrival confirmed', async () => {
    as(s.proposer);
    const id = crypto.randomUUID();
    const created = await PROPOSE(post('/topups', { id, amountSats: 50_000, note: 'two weeks' }));
    expect(created.status).toBe(201);
    expect(await json(created)).toMatchObject({
      changed: true,
      topup: {
        id,
        status: 'proposed',
        amountSats: 50_000,
        note: 'two weeks',
        approvalsRequired: 2,
        proposedBy: { id: s.proposer.id, name: 'Proposer' },
        approvals: [],
        transfer: null,
        outcome: null,
      },
    });

    // A resend is the same proposal, not a second one.
    const resent = await PROPOSE(post('/topups', { id, amountSats: 50_000 }));
    expect(resent.status).toBe(200);
    expect(await json(resent)).toMatchObject({ changed: false, topup: { id } });
    expect(
      (await json(await LIST(get('/topups')))).topups.filter((t: { id: string }) => t.id === id),
    ).toHaveLength(1);

    // The first approval does not reach the quorum; the second does.
    const first = await signoff(s.b, id);
    expect(first.status).toBe(200);
    expect(await json(first)).toMatchObject({
      changed: true,
      topup: { status: 'proposed', approvals: [{ by: { id: s.b.id } }] },
    });
    const second = await signoff(s.c, id);
    expect(await json(second)).toMatchObject({
      changed: true,
      topup: { status: 'approved', floatBaselineSats: 1000 },
    });

    // The transfer is signed in the pool wallet; a steward records its reference.
    as(s.d);
    const transferred = await TRANSFER(
      post(`/topups/${id}/transfer`, { reference: 'AbC123' }),
      idParams(id),
    );
    expect(transferred.status).toBe(200);
    expect(await json(transferred)).toMatchObject({
      changed: true,
      topup: { status: 'transferred', transfer: { reference: 'abc123', by: { id: s.d.id } } },
    });

    // The funds have not arrived: not an error, and not confirmed.
    const waiting = await CONFIRM(post(`/topups/${id}/confirm`), idParams(id));
    expect(waiting.status).toBe(200);
    expect(await json(waiting)).toMatchObject({
      changed: false,
      arrived: false,
      topup: { status: 'transferred' },
    });
    expect(enqueueSweepPayoutsSafely).not.toHaveBeenCalled();

    // They arrive: confirmed, and the payouts waiting for funds are woken.
    wallet.state.balance = 1000 + 50_000;
    const confirmed = await CONFIRM(post(`/topups/${id}/confirm`), idParams(id));
    expect(await json(confirmed)).toMatchObject({
      changed: true,
      arrived: true,
      topup: { status: 'confirmed', outcome: { by: { id: s.d.id } } },
    });
    expect(enqueueSweepPayoutsSafely).toHaveBeenCalledTimes(1);

    const detail = await json(await DETAIL(get(`/topups/${id}`), idParams(id)));
    expect(detail.topup.approvals.map((a: { by: { name: string } }) => a.by.name)).toEqual([
      'Steward B',
      'Steward C',
    ]);
  });

  it('403 self_approval when the proposer tries to approve or reject their own proposal', async () => {
    const id = await propose();
    const approve = await signoff(s.proposer, id);
    expect(approve.status).toBe(403);
    expect((await json(approve)).error.code).toBe('self_approval');

    as(s.proposer);
    const reject = await REJECT(post(`/topups/${id}/reject`, {}), idParams(id));
    expect(reject.status).toBe(403);
    expect((await json(reject)).error.code).toBe('self_approval');

    const detail = await json(await DETAIL(get(`/topups/${id}`), idParams(id)));
    expect(detail.topup).toMatchObject({ status: 'proposed', approvals: [] });
  });

  it('a resent approval is 200 with changed:false, and counts once', async () => {
    const id = await propose();
    expect((await json(await signoff(s.b, id))).changed).toBe(true);
    const again = await signoff(s.b, id);
    expect(again.status).toBe(200);
    expect(await json(again)).toMatchObject({
      changed: false,
      topup: { status: 'proposed', approvals: [{ by: { id: s.b.id } }] },
    });
  });

  it('409 invalid_state when approving a cancelled, rejected or already-approved proposal', async () => {
    const cancelled = await propose();
    as(s.proposer);
    expect(
      (await CANCEL(post(`/topups/${cancelled}/cancel`, {}), idParams(cancelled))).status,
    ).toBe(200);
    const afterCancel = await signoff(s.b, cancelled);
    expect(afterCancel.status).toBe(409);
    expect(await json(afterCancel)).toMatchObject({
      error: { code: 'invalid_state', details: { status: 'cancelled' } },
    });

    const rejected = await propose();
    as(s.b);
    expect(
      (
        await REJECT(
          post(`/topups/${rejected}/reject`, { reason: 'too large' }),
          idParams(rejected),
        )
      ).status,
    ).toBe(200);
    const afterReject = await signoff(s.c, rejected);
    expect(afterReject.status).toBe(409);
    expect((await json(afterReject)).error.details.status).toBe('rejected');

    const done = await approved();
    const late = await signoff(s.d, done);
    expect(late.status).toBe(409);
    expect((await json(late)).error.details.status).toBe('approved');
  });

  it('403 when someone other than the proposer cancels', async () => {
    const id = await propose();
    as(s.b);
    expect((await CANCEL(post(`/topups/${id}/cancel`, {}), idParams(id))).status).toBe(403);
  });

  it('refuses a proposal above the cap with 422 hot_wallet_cap_exceeded and the room left', async () => {
    configureTreasury({ cap: 10_000 });
    wallet.state.balance = 4000;
    as(s.proposer);
    const over = await PROPOSE(post('/topups', { amountSats: 6001 }));
    expect(over.status).toBe(422);
    expect(await json(over)).toMatchObject({
      error: {
        code: 'hot_wallet_cap_exceeded',
        details: { capSats: 10_000, headroomSats: 6000 },
      },
    });
    expect((await PROPOSE(post('/topups', { amountSats: 6000 }))).status).toBe(201);
  });

  it('503 float_unavailable (without leaking the rail) when a cap is set and the balance cannot be read', async () => {
    configureTreasury({ cap: 10_000 });
    wallet.state.failing = true;
    as(s.proposer);
    const response = await PROPOSE(post('/topups', { amountSats: 100 }));
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).toContain('float_unavailable');
    expect(text).not.toContain('super-secret-value');
  });

  it('409 conflict when a transfer reference is reused on another proposal', async () => {
    const first = await approved();
    const second = await approved();
    as(s.d);
    expect(
      (await TRANSFER(post(`/topups/${first}/transfer`, { reference: 'txid-1' }), idParams(first)))
        .status,
    ).toBe(200);
    const clash = await TRANSFER(
      post(`/topups/${second}/transfer`, { reference: 'TXID-1' }),
      idParams(second),
    );
    expect(clash.status).toBe(409);
    expect((await json(clash)).error.code).toBe('conflict');
  });

  it('409 invalid_state when the transfer is recorded before the vote has passed', async () => {
    const id = await propose();
    as(s.d);
    const early = await TRANSFER(
      post(`/topups/${id}/transfer`, { reference: 'abc' }),
      idParams(id),
    );
    expect(early.status).toBe(409);
    expect((await json(early)).error.details.status).toBe('proposed');
  });

  it('404 for an unknown proposal on every action', async () => {
    as(s.proposer);
    expect((await DETAIL(get(`/topups/${UNKNOWN}`), idParams(UNKNOWN))).status).toBe(404);
    expect((await SIGNOFF(post(`/topups/${UNKNOWN}/signoff`), idParams(UNKNOWN))).status).toBe(404);
    expect((await CANCEL(post(`/topups/${UNKNOWN}/cancel`, {}), idParams(UNKNOWN))).status).toBe(
      404,
    );
    expect((await CONFIRM(post(`/topups/${UNKNOWN}/confirm`), idParams(UNKNOWN))).status).toBe(404);
  });

  it('the overview carries the float, the cap, the pending proposals and an unconfigured pool', async () => {
    configureTreasury({ cap: 200_000 });
    wallet.state.balance = 150_000; // well under the default low-balance alert of 200,000
    await propose(2000);
    as(s.b);
    const body = await json(await OVERVIEW());
    expect(body).toMatchObject({
      hotWallet: { available: 150_000, lowBalance: true, error: null },
      cap: { sats: 200_000 },
      approvalsRequired: 2,
      inFlightSats: 2000,
      pendingPayouts: { count: 0, totalSats: 0 },
      pool: { configured: false, balanceSats: null },
    });
    expect(body.pendingTopups).toHaveLength(1);
  });

  it('the overview still answers when the hot wallet cannot be read, and says so', async () => {
    wallet.state.failing = true;
    as(s.b);
    const response = await OVERVIEW();
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text).hotWallet).toEqual({
      available: null,
      asOf: null,
      lowBalance: null,
      error: 'float_unavailable',
    });
    expect(text).not.toContain('super-secret-value');
  });
});
