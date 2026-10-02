// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/lib/db/client';
import { collectors } from '@/lib/db/schema';
import { FIELD_SUPERVISOR } from './fixtures/accounts';
import { login, recordCollection } from './helpers';

/**
 * The server refuses a collection (the collector was revoked while the phone was offline). The
 * supervisor must see that it needs attention, tap through to the item, read the reason in plain
 * words (translated from the stable code), and, once the cause is fixed, send it again.
 */
test('a refused collection shows its reason and can be sent again once fixed', async ({
  page,
  context,
}) => {
  test.setTimeout(150_000);
  await login(page, FIELD_SUPERVISOR, '/enrol');
  await page.goto('/weigh');
  await page.getByRole('button', { name: /Record a collection/ }).click();
  await expect(page.getByRole('textbox', { name: 'Search name or code' })).toBeVisible();

  await context.setOffline(true);
  await recordCollection(page, 'Amina', /Amina E2E/);

  const db = getDb();
  const setStatus = (status: 'active' | 'revoked') =>
    db.update(collectors).set({ status }).where(eq(collectors.alias, 'Amina E2E'));
  try {
    await setStatus('revoked');
    await context.setOffline(false);

    const bar = page.getByTestId('sync-bar');
    await expect(bar).toHaveAttribute('data-mode', 'needsAttention', { timeout: 30_000 });
    await expect(bar).toContainText('1 collection needs attention');

    // Tap the bar: it leads to the offending item, with the reason in plain words.
    await bar.click();
    await page.waitForURL('**/session');
    const item = page.getByTestId('queue-item').first();
    await expect(item).toHaveAttribute('data-state', 'needs_attention');
    await expect(page.getByTestId('attention-reason')).toContainText('not authorized yet');

    // The collector is authorized again: Try again sends the same event and it confirms.
    await setStatus('active');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(item).toHaveAttribute('data-state', 'confirmed', { timeout: 30_000 });
  } finally {
    await setStatus('active');
    await closeDb();
  }
});
