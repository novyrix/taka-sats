// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/lib/db/client';
import { supervisors } from '@/lib/db/schema';
import { FIELD_SUPERVISOR } from './fixtures/accounts';
import { login, recordCollection } from './helpers';

/**
 * A supervisor's account is switched off while they are working offline. When the phone comes
 * back online the server answers 401: the sync bar must say they are signed out, NOTHING queued
 * may be lost, and after the account is back and they sign in again the same event syncs.
 */
test('a 401 on sync keeps the queue; signing in again drains it', async ({ page, context }) => {
  test.setTimeout(150_000);
  await login(page, FIELD_SUPERVISOR, '/enrol');
  await page.goto('/weigh');
  await page.getByRole('button', { name: /Record a collection/ }).click();
  await expect(page.getByRole('textbox', { name: 'Search name or code' })).toBeVisible();

  await context.setOffline(true);
  await recordCollection(page, 'Amina', /Amina E2E/);

  const db = getDb();
  const setActive = (active: boolean) =>
    db.update(supervisors).set({ active }).where(eq(supervisors.phone, FIELD_SUPERVISOR.phone));
  try {
    await setActive(false);
    await context.setOffline(false);

    // The phone drains when it is back online; the server answers 401 and the bar says so.
    const bar = page.getByTestId('sync-bar');
    await expect(bar).toHaveAttribute('data-mode', 'signedOut', { timeout: 30_000 });
    await expect(bar).toContainText('1 saved on this phone');

    await setActive(true);
  } finally {
    await closeDb();
  }

  // Tap the bar to sign in again; the same event drains and confirms. Nothing was lost.
  await page.getByTestId('sync-bar').click();
  await page.waitForURL('**/login');
  await page.context().clearCookies();
  await login(page, FIELD_SUPERVISOR, '/enrol');
  await page.goto('/session');
  const item = page.getByTestId('queue-item').first();
  await expect
    .poll(
      async () => {
        const sync = page.getByTestId('sync-now');
        if (await sync.isEnabled()) {
          await sync.click();
        }
        return item.getAttribute('data-state');
      },
      { timeout: 30_000 },
    )
    .toBe('confirmed');
});
