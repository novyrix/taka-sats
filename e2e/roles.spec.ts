// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from '@playwright/test';
import { FIELD_SUPERVISOR, HUB_LEAD } from './fixtures/accounts';
import { login } from './helpers';

/** What each role can reach in the browser. The API checks every scope itself; this is the visible half. */
test.describe('roles', () => {
  test('a hub lead sees the vetting and payout screens, and none of the money-stewardship ones', async ({
    page,
  }) => {
    await login(page, HUB_LEAD, '/admin');
    const nav = page.getByRole('navigation', { name: 'Operator console' });
    for (const name of ['Overview', 'Collectors', 'Payouts', 'Events']) {
      await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
    }
    for (const name of ['Treasury', 'Ledger', 'Anomalies', 'Reconciliation', 'Staff', 'Rates']) {
      await expect(nav.getByRole('link', { name, exact: true })).toHaveCount(0);
    }

    // Typing the address does not help: admin-only screens send a hub lead back to the overview.
    for (const path of ['/treasury', '/ledger', '/staff', '/anomalies']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/admin$/);
    }

    // And the server refuses the data itself.
    const statuses = await page.evaluate(async () => {
      const out: Record<string, number> = {};
      for (const path of ['/treasury', '/ledger', '/supervisors', '/anomalies']) {
        out[path] = (await fetch(`/api/v1${path}`)).status;
      }
      return out;
    });
    expect(statuses).toEqual({
      '/treasury': 403,
      '/ledger': 403,
      '/supervisors': 403,
      '/anomalies': 403,
    });
  });

  test('a supervisor cannot open the console or read what is not theirs', async ({ page }) => {
    await login(page, FIELD_SUPERVISOR, '/enrol');
    await page.goto('/admin');
    // Bounced out of the console (the login page forwards a signed-in person on to the app).
    await expect(page).not.toHaveURL(/\/admin/);

    const statuses = await page.evaluate(async () => {
      const out: Record<string, number> = {};
      for (const path of [
        '/treasury',
        '/ledger',
        '/supervisors',
        '/anomalies',
        '/collectors?status=all',
      ]) {
        out[path] = (await fetch(`/api/v1${path}`)).status;
      }
      return out;
    });
    expect(Object.values(statuses).every((status) => status === 403)).toBe(true);
  });

  test('without a session the console sends you to sign in and the API answers 401', async ({
    page,
  }) => {
    await page.goto('/payouts');
    await expect(page).toHaveURL(/\/login$/);
    const status = await page.evaluate(async () => (await fetch('/api/v1/payouts')).status);
    expect(status).toBe(401);
  });
});
