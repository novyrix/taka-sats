// SPDX-License-Identifier: AGPL-3.0-only

import path from 'node:path';
import { expect, test } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/lib/db/client';
import { collectors, payouts } from '@/lib/db/schema';
import { processPayoutJob } from '@/lib/jobs';
import { FakeLightningProvider } from '@/lib/lightning/FakeLightningProvider';
import { ADMINS, HUB_LEAD, STORY_SUPERVISOR } from './fixtures/accounts';
import { audit, expectNoErrorNotice, localInput, personContext } from './helpers';

const SHOT = path.join(__dirname, 'fixtures', 'shot.png');
const ALIAS = 'Story Collector';
const WALLET = 'story-collector@example.com';

/**
 * The whole product story, in a real browser against a production build and the test database,
 * on the demo (fake) payment rail:
 *
 *   admin creates and starts a session and assigns a supervisor
 *   -> supervisor registers a collector (waiting for authorization)
 *   -> hub lead authorizes
 *   -> supervisor weighs OFFLINE, goes online, the event syncs and shows confirmed
 *   -> a second person (an admin) approves the payout
 *   -> the payout worker pays
 *   -> the events page shows the verification picture, the ledger verifies
 *
 * One honest shortcut: the payout WORKER is not a separate process in this harness. The step that
 * the worker performs (`processPayoutJob`, the same handler `worker/runner.ts` registers) is
 * called from the test process with the fake provider. Everything else goes through the UI.
 */
/** What the worker does with a payout: drive it as far as it can go (idempotent). */
async function runWorker(alias: string): Promise<string> {
  const db = getDb();
  const [collector] = await db.select().from(collectors).where(eq(collectors.alias, alias));
  const [payout] = await db.select().from(payouts).where(eq(payouts.collectorId, collector!.id));
  await processPayoutJob(db, new FakeLightningProvider(), { payoutId: payout!.id });
  const [after] = await db.select().from(payouts).where(eq(payouts.id, payout!.id));
  return after!.status;
}

test('the full story: session, enrolment, authorization, offline weigh, sync, approval, payout, proof', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const admin = await personContext(browser, ADMINS[0], '/admin');
  const hub = await personContext(browser, HUB_LEAD, '/admin');
  const second = await personContext(browser, ADMINS[1], '/admin');
  const sup = await personContext(browser, STORY_SUPERVISOR, '/enrol');

  // 1. Admin: create a session, assign the supervisor, start it.
  {
    const page = admin.page;
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
    await page.goto('/sessions/new');
    await page.fill('#location', 'Story Hub');
    await page.fill('#start', localInput(new Date(Date.now() - 3_600_000)));
    await page.fill('#end', localInput(new Date(Date.now() + 8 * 3_600_000)));
    await page.getByLabel('Story Sup').check();
    await page.getByRole('button', { name: 'Create session' }).click();
    await page.waitForURL(/\/sessions\/[0-9a-f-]{36}$/);
    await page.getByTestId('start-session').click();
    await expect(page.getByText('Active', { exact: true }).first()).toBeVisible();
  }

  // 2. Supervisor: register a collector and attach the receive address. Pending authorization.
  {
    const page = sup.page;
    await page.goto('/enrol');
    await page.fill('#alias', ALIAS);
    await page.getByRole('button', { name: 'Scan their wallet QR' }).click();
    await expect(page.locator('#manualCode')).toBeVisible({ timeout: 30_000 });
    await page.fill('#manualCode', WALLET);
    await page.getByRole('button', { name: 'Use this code' }).click();
    await page.getByTestId('finish-pending').click();
    await expect(page.getByTestId('public-code')).toHaveText(/^TS-/);
    await expect(page.getByTestId('pending-note')).toBeVisible();
    // The supervisor can see the registration is waiting.
    await page.goto('/enrol');
    await expect(page.getByTestId('my-pending')).toContainText(ALIAS);
  }

  // 3. Hub lead: the collector is in the pending queue; authorize it.
  {
    const page = hub.page;
    await page.goto('/collectors');
    const row = page.getByTestId('collector-row').filter({ hasText: ALIAS });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Awaiting authorization');
    await row.getByTestId('authorize').click();
    await expect(page.getByTestId('collector-row').filter({ hasText: ALIAS })).toHaveCount(0);
    await expectNoErrorNotice(page);
  }

  // 4. Supervisor: prime the cache online, then weigh OFFLINE.
  {
    const page = sup.page;
    await page.goto('/weigh');
    await page.getByRole('button', { name: /Record a collection/ }).click();
    await expect(page.getByRole('textbox', { name: 'Search name or code' })).toBeVisible();
    await sup.context.setOffline(true);

    await page.getByRole('textbox', { name: 'Search name or code' }).fill('Story');
    await page.getByRole('button', { name: new RegExp(ALIAS) }).click();
    await page.getByRole('button', { name: 'Use selected collector' }).click();
    await page.getByRole('button', { name: /PET/ }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    for (const key of ['2', '.', '5']) {
      await page.getByRole('button', { name: key, exact: true }).click();
    }
    await page.getByRole('button', { name: 'Next' }).click();
    await page.setInputFiles('input[type="file"]', SHOT);
    await page.locator('#geo-reason').fill('e2e: headless, no GPS');
    await page.getByRole('button', { name: 'Continue' }).click();
    // A double tap on Save must record exactly one collection.
    await page.getByRole('button', { name: 'Confirm collection' }).dblclick();
    await expect(page.getByText('Saved and queued')).toBeVisible();
  }

  // 5. Back online: the event syncs and the queue shows it confirmed.
  {
    const page = sup.page;
    await sup.context.setOffline(false);
    await page.goto('/session');
    const items = page.getByTestId('queue-item');
    await expect(items).toHaveCount(1);
    await expect
      .poll(
        async () => {
          const sync = page.getByTestId('sync-now');
          if (await sync.isEnabled()) {
            // The button can turn disabled between the check and the click: never wait on it.
            await sync.click({ timeout: 1_000 }).catch(() => undefined);
          }
          return items.first().getAttribute('data-state');
        },
        { timeout: 30_000 },
      )
      .toBe('confirmed');
  }

  // The worker prices the payout and holds it for a second person (pilot mode holds everything).
  expect(await runWorker(ALIAS)).toBe('pending_approval');

  // 6. A second person approves the payout (an admin; the supervisor who recorded it cannot).
  {
    const page = second.page;
    await page.goto('/payouts?status=pending_approval');
    const row = page.getByTestId('payout-row').filter({ hasText: ALIAS });
    await expect(row).toBeVisible();
    await row.getByTestId('approve-payout').click();
    await expect(page.getByTestId('payout-row').filter({ hasText: ALIAS })).toHaveCount(0);
  }

  // 7. The worker pays (see the note above: the handler is called from here).
  try {
    expect(await runWorker(ALIAS)).toBe('paid');
  } finally {
    await closeDb();
  }

  // 8. The events page shows how we know.
  {
    const page = admin.page;
    await page.goto('/events');
    await page.getByTestId('event-row').first().getByRole('link').first().click();
    const checks = page.getByTestId('checks');
    await expect(checks).toBeVisible();
    for (const key of [
      'collector_authorized',
      'session_window',
      'rate_in_force',
      'payout',
      'ledger_anchor',
    ]) {
      await expect(page.getByTestId(`check-${key}`)).toHaveAttribute('data-status', 'pass');
    }
    // No GPS in headless: the supervisor's reason is shown, as a note for a person.
    await expect(page.getByTestId('check-gps_inside')).toHaveAttribute('data-status', 'warn');
    await expect(page.getByTestId('check-gps_inside')).toContainText('e2e: headless, no GPS');
  }

  // 9. The ledger verifies, and it contains the collection and the payout.
  {
    const page = admin.page;
    await page.goto('/ledger');
    await page.getByTestId('verify-ledger').click();
    await expect(page.getByTestId('verify-result')).toHaveAttribute('data-ok', 'true');
    await expect(page.getByRole('cell', { name: 'Payout', exact: true }).first()).toBeVisible();
  }

  // Accessibility with real data on the page: the pages a person actually works in.
  {
    const page = admin.page;
    await audit(page, '/payouts');
    await audit(page, '/collectors?x=1');
    await audit(page, '/events');
    await audit(page, '/anomalies');
    await audit(page, '/reconciliation');
  }
  await audit(sup.page, '/session');

  for (const person of [admin, hub, second, sup]) {
    await person.context.close();
  }
});
