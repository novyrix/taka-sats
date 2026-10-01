// SPDX-License-Identifier: AGPL-3.0-only

/**
 * End-to-end backend smoke test over real HTTP — run it against a deployment BEFORE a field day
 * (docs/PILOT.md §4). It signs in as an admin and a supervisor and walks the whole loop:
 *
 *   register → (gate) → authorize → weigh → photo → sync (twice) → ledger verifies → payout
 *
 * Every step prints ✓ or ✗ with the reason; the exit code is 1 if anything failed. It creates
 * clearly-named "Smoke …" records — it never deletes or edits anything that already exists.
 *
 *   pnpm pilot:smoke -- --base https://taka.afribit.africa \
 *     --admin-phone +2547… --admin-password '…' \
 *     --supervisor-phone +2547… --supervisor-password '…' \
 *     [--wallet <a Lightning Address — the RECEIVE side of a wallet card>] [--pay-real] \n *     [--admin2-phone … --admin2-password … --admin3-phone … --admin3-password …]
 *
 * Passwords can instead come from SMOKE_ADMIN_PASSWORD / SMOKE_SUPERVISOR_PASSWORD.
 *
 * The payout step needs `--wallet`. If the deployment is a real-money one (`/api/v1/meta` says
 * `demo: false`) the script will NOT approve the payout unless you also pass `--pay-real` — a
 * smoke test must never spend real sats by accident. It weighs 50 g of PET (≈ 9 sats).
 */

import { randomBytes } from 'node:crypto';
import { assembleCollectionEvent, sha256HexBytes } from '@/lib/sync';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Reply = { status: number; body: Json };

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const has = (name: string): boolean => process.argv.includes(`--${name}`);

/** One signed-in session: a tiny cookie jar around fetch. */
class Client {
  private readonly jar = new Map<string, string>();
  constructor(
    private readonly base: string,
    readonly label: string,
  ) {}

  private store(res: Response): void {
    for (const line of res.headers.getSetCookie()) {
      const [pair = ''] = line.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) {
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        if (value === '') {
          this.jar.delete(name);
        } else {
          this.jar.set(name, value);
        }
      }
    }
  }

  private cookie(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async raw(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(`${this.base}${path}`, {
      redirect: 'manual',
      ...init,
      headers: { ...(init.headers as Record<string, string>), cookie: this.cookie() },
    });
    this.store(res);
    return res;
  }

  async call(method: string, path: string, body?: unknown): Promise<Reply> {
    const res = await this.raw(path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    let parsed: Json = {};
    try {
      parsed = text ? (JSON.parse(text) as Json) : {};
    } catch {
      parsed = { raw: text.slice(0, 200) };
    }
    return { status: res.status, body: parsed };
  }

  async signIn(identifier: string, password: string): Promise<Json | null> {
    const csrf = (await (await this.raw('/api/auth/csrf')).json()) as { csrfToken: string };
    await this.raw('/api/auth/callback/credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        csrfToken: csrf.csrfToken,
        identifier,
        password,
        callbackUrl: `${this.base}/`,
      }).toString(),
    });
    const session = (await (await this.raw('/api/auth/session')).json()) as Json | null;
    return session?.user ?? null;
  }
}

let failures = 0;
/** False when we bailed out before running any check (bad usage): never print a verdict then. */
let ran = true;
function step(ok: boolean, label: string, detail?: unknown): boolean {
  console.log(
    `${ok ? '✓' : '✗'} ${label}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`,
  );
  if (!ok) {
    failures += 1;
  }
  return ok;
}

async function waitFor<T>(
  what: string,
  probe: () => Promise<T | null>,
  seconds = 90,
): Promise<T | null> {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const found = await probe();
    if (found) {
      return found;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(`  (gave up waiting for ${what} after ${seconds}s)`);
  return null;
}

async function main(): Promise<void> {
  const base = (arg('base') ?? 'http://localhost:3000').replace(/\/$/, '');
  const adminPhone = arg('admin-phone');
  const supPhone = arg('supervisor-phone');
  const adminPw = arg('admin-password') ?? process.env.SMOKE_ADMIN_PASSWORD;
  const supPw = arg('supervisor-password') ?? process.env.SMOKE_SUPERVISOR_PASSWORD;
  const wallet = arg('wallet');
  if (!adminPhone || !supPhone || !adminPw || !supPw) {
    console.error(
      'Usage: pilot-smoke --base <url> --admin-phone … --admin-password … --supervisor-phone … --supervisor-password … [--wallet <receive address>] [--pay-real] [--admin2-phone … --admin2-password … --admin3-phone … --admin3-password …]',
    );
    ran = false;
    process.exitCode = 2;
    return;
  }

  console.log(`\nSmoke test — ${base}\n`);
  const stamp = new Date().toISOString().slice(11, 19).replaceAll(':', '');

  // ── 1. the deployment is up ────────────────────────────────────────────────
  const anon = new Client(base, 'anon');
  const health = await anon.call('GET', '/api/v1/health');
  if (
    !step(
      health.status === 200 && health.body.ok === true,
      'health: app and database are up',
      health,
    )
  ) {
    return;
  }
  const meta = await anon.call('GET', '/api/v1/meta');
  step(meta.status === 200, 'meta: deployment facts are public', meta);
  const demo = meta.body.lightning?.demo === true;
  console.log(
    `  provider: ${meta.body.lightning?.floatProvider} (${demo ? 'DEMO — nothing is sent' : 'REAL money'})`,
  );

  // ── 2. both roles can sign in ──────────────────────────────────────────────
  const admin = new Client(base, 'admin');
  const sup = new Client(base, 'supervisor');
  const adminUser = await admin.signIn(adminPhone, adminPw);
  const supUser = await sup.signIn(supPhone, supPw);
  if (
    !step(
      adminUser?.role === 'admin' || adminUser?.role === 'hub_lead',
      `sign in: ${adminPhone} is staff with authorize rights`,
      adminUser,
    ) ||
    !step(supUser?.role === 'supervisor', `sign in: ${supPhone} is a supervisor`, supUser)
  ) {
    return;
  }

  const current = await sup.call('GET', '/api/v1/sessions/current');
  if (
    !step(
      current.body.session != null,
      'session: the supervisor has an active session right now',
      current.body,
    )
  ) {
    console.log('  → open one (seed-pilot, or the admin console) and assign this supervisor.');
    return;
  }

  // ── 3. the authorization gate ──────────────────────────────────────────────
  const alias = `Smoke ${stamp}`;
  const reg = await sup.call('POST', '/api/v1/collectors', { alias });
  const collector = reg.body.collector as Json | undefined;
  if (
    !step(
      reg.status === 201 && collector?.status === 'pending',
      'gate: a supervisor-registered collector starts PENDING',
      reg.body,
    )
  ) {
    return;
  }
  step(
    /^[A-Z]+(-[A-Z]+)?-\d{4,}$/.test(collector!.publicCode),
    `identity: public code allocated (${collector!.publicCode})`,
  );
  step(
    collector!.reference?.payload === `takasats:${collector!.publicCode}`,
    'identity: the credential payload carries the code, never a wallet',
  );

  const pre = await sup.call('GET', '/api/v1/weigh/bootstrap');
  step(
    pre.status === 200 && !(pre.body.collectors as Json[]).some((c) => c.id === collector!.id),
    'gate: a pending collector is NOT in the offline cache',
  );

  // ── 4. wallets: Receive accepted, Pay refused, no sharing ──────────────────
  const payQr = await sup.call('POST', `/api/v1/collectors/${collector!.id}/destinations`, {
    rawCode: 'https://card.paybee.buzz/smoke-test',
  });
  step(
    payQr.status === 422 && payQr.body.error?.code === 'spend_credential_rejected',
    "wallet: a card's PAY QR is refused",
    payQr.body,
  );

  let walletOk = false;
  if (wallet) {
    const attach = await sup.call('POST', `/api/v1/collectors/${collector!.id}/destinations`, {
      rawCode: wallet,
    });
    walletOk = step(
      attach.status === 201 && attach.body.destination?.status === 'verified',
      'wallet: the RECEIVE address resolves and is verified',
      attach.body,
    );
    const twin = await sup.call('POST', '/api/v1/collectors', { alias: `${alias} twin` });
    const dup = await sup.call(
      'POST',
      `/api/v1/collectors/${twin.body.collector?.id}/destinations`,
      { rawCode: wallet },
    );
    step(
      dup.status === 409 && dup.body.error?.code === 'destination_in_use',
      'wallet: the same wallet cannot back a second collector',
      dup.body,
    );
  } else {
    console.log(
      '  (skipping the wallet and payout steps — pass --wallet <receive address> to include them)',
    );
  }

  // ── 5. staff authorize ─────────────────────────────────────────────────────
  const selfAuth = await sup.call('POST', `/api/v1/collectors/${collector!.id}/authorization`, {
    decision: 'authorize',
  });
  step(selfAuth.status === 403, 'gate: a supervisor cannot authorize', selfAuth.body);
  const auth = await admin.call('POST', `/api/v1/collectors/${collector!.id}/authorization`, {
    decision: 'authorize',
  });
  step(
    auth.status === 200 && auth.body.collector?.status === 'active',
    'gate: staff authorize the collector',
    auth.body,
  );

  // ── 6. weigh offline-style, upload the photo, sync twice ───────────────────
  const boot = await sup.call('GET', '/api/v1/weigh/bootstrap');
  const rate =
    (boot.body.rates as Json[] | undefined)?.find((r) => r.material === 'PET') ??
    (boot.body.rates as Json[] | undefined)?.[0];
  if (
    !step(
      !!(boot.body.collectors as Json[] | undefined)?.some((c) => c.id === collector!.id),
      'cache: the authorized collector is now in the offline cache',
    ) ||
    !step(!!rate, 'cache: a material rate is configured', boot.body) ||
    !step(
      typeof boot.body.exchangeRate === 'number',
      'cache: a BTC/fiat exchange rate is available (the worker refreshes it)',
      boot.body.exchangeRate,
    )
  ) {
    return;
  }

  const photo = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...randomBytes(32)]);
  const photoSha = await sha256HexBytes(photo);
  const up = await sup.raw('/api/v1/photos', {
    method: 'POST',
    headers: { 'content-type': 'image/jpeg', 'x-photo-sha256': photoSha },
    body: photo,
  });
  step(up.status === 201, 'photo: uploaded and hash-checked', up.status);
  const bad = await sup.raw('/api/v1/photos', {
    method: 'POST',
    headers: { 'content-type': 'image/jpeg', 'x-photo-sha256': 'f'.repeat(64) },
    body: photo,
  });
  step(bad.status === 422, 'photo: bytes that do not match their hash are refused', bad.status);

  const event = await assembleCollectionEvent({
    collectorId: collector!.id,
    supervisorId: supUser!.id,
    sessionId: current.body.session.id ?? current.body.session.sessionId,
    material: rate!.material,
    weightKg: 0.05,
    rateId: rate!.rateId,
    rateFiatMinor: rate!.rateFiatMinor,
    exchangeRate: boot.body.exchangeRate,
    photoSha256: photoSha,
    geo: { kind: 'unavailable', reason: 'smoke test' },
    registrationType: 'tap',
  });
  const { photoUrl: _photoUrl, ...wire } = event;
  const first = await sup.call('POST', '/api/v1/sync/events', { events: [wire] });
  const r1 = first.body.results?.[0] as Json | undefined;
  step(
    first.status === 200 && r1?.status === 'confirmed',
    `sync: the event is confirmed (ledger seq ${r1?.seq})`,
    first.body,
  );
  const second = await sup.call('POST', '/api/v1/sync/events', { events: [wire] });
  step(
    r1?.status === 'confirmed' && second.body.results?.[0]?.seq === r1.seq,
    'sync: resending is idempotent — same seq, no duplicate',
    second.body,
  );

  // ── 7. the record verifies ─────────────────────────────────────────────────
  const verify = await admin.call('GET', '/api/v1/ledger/verify');
  step(
    verify.status === 200 && verify.body.ok === true,
    `ledger: the hash chain verifies (${verify.body.count} entries)`,
    verify.body,
  );

  // ── 7b. what the UI reads back ─────────────────────────────────────────────
  const events = await sup.call('GET', `/api/v1/events?collectorId=${collector!.id}`);
  const row = (events.body.events as Json[] | undefined)?.find((e) => e.id === event.id);
  step(!!row, 'events: the supervisor sees the event they recorded', events.body);
  step(
    !!row && row.photoPath === `/api/v1/photos/${photoSha}` && !('photoUrl' in row),
    'events: the photo is served through the app, never an internal storage URL',
  );
  step(
    !!row && (row.geo?.lat === undefined || row.geo?.lng === undefined),
    "events: a supervisor's view carries no coordinates",
  );
  const stats = await anon.call('GET', '/api/v1/stats/summary');
  step(
    stats.status === 200 &&
      typeof stats.body.events === 'number' &&
      !JSON.stringify(stats.body).includes(alias),
    'stats: the public summary works without a session and names no one',
    stats.body,
  );
  const anomalies = await admin.call('GET', '/api/v1/anomalies');
  step(
    anomalies.status === 200 && Array.isArray(anomalies.body.anomalies),
    'anomalies: staff can list flags',
    anomalies.body,
  );

  // ── 8. payout ──────────────────────────────────────────────────────────────
  if (!wallet || !walletOk) {
    return;
  }
  const payout = await waitFor('the payout to appear', async () => {
    const list = await admin.call('GET', `/api/v1/payouts?eventId=${event.id}`);
    return (list.body.payouts as Json[] | undefined)?.[0] ?? null;
  });
  if (!step(!!payout, 'payout: created automatically when the event was confirmed')) {
    return;
  }
  console.log(
    `  payout state: ${payout!.status}${payout!.amountSats != null ? `, ${payout!.amountSats} sats` : ''}`,
  );
  step(!JSON.stringify(payout).includes('@'), 'payout: the API never returns the wallet address');

  const payoutId = payout!.id as string;
  const selfApprove = await sup.call('POST', `/api/v1/payouts/${payoutId}/approve`);
  step(
    selfApprove.status === 403,
    'payout: the supervisor who recorded it cannot approve it',
    selfApprove.body,
  );

  // A payout waits (`awaiting_rate`) while the BTC/fiat snapshot is stale — e.g. right after a
  // restart. The worker refreshes it on a schedule and a sweep resumes parked payouts every
  // 5 minutes, so allow for that rather than calling it a failure.
  if (payout!.status === 'awaiting_rate' || payout!.status === 'awaiting_destination') {
    console.log(
      '  (waiting for a fresh exchange rate — the worker refreshes it and sweeps every ~5 min)',
    );
  }
  await waitFor(
    'the payout to be priced',
    async () => {
      const r = await admin.call('GET', `/api/v1/payouts/${payoutId}`);
      const p = (r.body.payout ?? r.body) as Json;
      return p.status !== 'awaiting_rate' && p.status !== 'awaiting_destination' ? p : null;
    },
    360,
  );

  const current2 = await admin.call('GET', `/api/v1/payouts/${payoutId}`);
  if ((current2.body.payout ?? current2.body).status === 'pending_approval') {
    if (!demo && !has('pay-real')) {
      console.log(
        '  ! real-money deployment: NOT approving. Re-run with --pay-real to send ~9 sats to --wallet.',
      );
      return;
    }
    const approve = await admin.call('POST', `/api/v1/payouts/${payoutId}/approve`);
    step(approve.status === 200, 'payout: staff approve it', approve.body);
  }
  const done = await waitFor('the payout to settle', async () => {
    const r = await admin.call('GET', `/api/v1/payouts/${payoutId}`);
    const p = (r.body.payout ?? r.body) as Json;
    return p.status === 'paid' || p.status === 'failed' ? p : null;
  });
  step(
    done?.status === 'paid',
    `payout: settled${done ? ` (${done.status})` : ''}`,
    done?.lastError,
  );

  const verify2 = await admin.call('GET', '/api/v1/ledger/verify');
  step(
    verify2.body.ok === true,
    `ledger: still verifies with the payout recorded (${verify2.body.count} entries)`,
    verify2.body,
  );

  await treasuryVote(base, admin, adminUser?.role ?? '');
}

/**
 * Optional (pass `--admin2-phone/--admin2-password/--admin3-phone/--admin3-password` and sign in
 * with an `admin` as the first account): the funding vote end to end over HTTP. A 1 sat proposal,
 * the proposer cannot approve, two other admins approve, the transfer is recorded, and the
 * arrival is NOT accepted on anyone's word. It stops at `transferred`: on a demo rail the float
 * does not rise, and this tool never moves pool funds. The proposal stays in flight (it counts
 * against `treasury.hot_wallet_cap_sats` headroom until someone resolves it).
 */
async function treasuryVote(base: string, admin: Client, role: string): Promise<void> {
  const a2 = { phone: arg('admin2-phone'), pw: arg('admin2-password') };
  const a3 = { phone: arg('admin3-phone'), pw: arg('admin3-password') };
  if (!a2.phone || !a2.pw || !a3.phone || !a3.pw) {
    console.log(
      '  (treasury vote skipped: pass --admin2-* and --admin3-* credentials to include it)',
    );
    return;
  }
  if (role !== 'admin') {
    step(false, 'treasury: the first account must be an admin to propose', role);
    return;
  }
  const b = new Client(base, 'admin2');
  const c = new Client(base, 'admin3');
  const bUser = await b.signIn(a2.phone, a2.pw);
  const cUser = await c.signIn(a3.phone, a3.pw);
  if (
    !step(bUser?.role === 'admin' && cUser?.role === 'admin', 'treasury: two more admins sign in', {
      b: bUser?.role,
      c: cUser?.role,
    })
  ) {
    return;
  }

  const proposed = await admin.call('POST', '/api/v1/treasury/topups', {
    amountSats: 1,
    note: `smoke ${new Date().toISOString().slice(11, 19)}`,
  });
  const id = proposed.body.topup?.id as string | undefined;
  if (
    !step(proposed.status === 201 && !!id, 'treasury: an admin proposes a refill', proposed.body)
  ) {
    return;
  }
  const self = await admin.call('POST', `/api/v1/treasury/topups/${id}/signoff`);
  step(self.status === 403, 'treasury: the proposer cannot approve their own proposal', self.body);
  const first = await b.call('POST', `/api/v1/treasury/topups/${id}/signoff`);
  step(first.status === 200, 'treasury: a second admin approves', first.body);
  const second = await c.call('POST', `/api/v1/treasury/topups/${id}/signoff`);
  step(
    second.status === 200 && second.body.topup?.status === 'approved',
    'treasury: a third admin approves and the quorum is reached',
    second.body,
  );
  const transfer = await admin.call('POST', `/api/v1/treasury/topups/${id}/transfer`, {
    reference: `smoke-${Date.now().toString(16)}`,
  });
  step(
    transfer.status === 200 && transfer.body.topup?.status === 'transferred',
    'treasury: the transfer reference is recorded',
    transfer.body,
  );
  const confirm = await b.call('POST', `/api/v1/treasury/topups/${id}/confirm`);
  step(
    confirm.status === 200 && confirm.body.topup?.status !== 'confirmed',
    'treasury: arrival is not confirmed on someone saying so (the balance must rise)',
    confirm.body,
  );
  const verify = await admin.call('GET', '/api/v1/ledger/verify');
  step(
    verify.body.ok === true,
    'ledger: still verifies with the funding vote recorded',
    verify.body,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    failures += 1;
  })
  .finally(() => {
    if (!ran) {
      return;
    }
    console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) FAILED.\n`);
    process.exitCode = failures === 0 ? 0 : 1;
  });
