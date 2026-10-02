// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from '@playwright/test';
import { ADMINS } from './fixtures/accounts';
import { login } from './helpers';

/**
 * Reconciliation in the console: record a recycler sale, see it in the mass balance for the
 * period, and save the report. (Runs after the full-story spec, which leaves PET collected.)
 */
test('record a recycler sale, see the mass balance, save a report', async ({ page }) => {
  await login(page, ADMINS[0], '/admin');
  await page.goto('/reconciliation');

  // A tare heavier than the gross weight is refused before anything is sent.
  await page.getByLabel('Material', { exact: true }).fill('PET');
  await page.getByLabel('Buyer').fill('Test Recyclers');
  await page.getByLabel('Gross weight (kg)').fill('10');
  await page.getByLabel('Tare (kg, optional)').fill('11');
  await page.getByTestId('save-sale').click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Tare cannot exceed gross' }),
  ).toBeVisible();

  await page.getByLabel('Tare (kg, optional)').fill('0.5');
  await page.getByTestId('save-sale').click();
  await expect(page.getByText('Sale recorded.')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Test Recyclers' })).toBeVisible();

  // The accepted weight is gross minus tare, and it appears in the mass balance.
  const pet = page.getByTestId('balance-row').filter({ hasText: 'PET' });
  await expect(pet).toBeVisible();
  await expect(pet).toContainText('9.5 kg');

  await page.getByTestId('save-report').click();
  await expect(page.getByRole('cell', { name: 'PET', exact: true }).nth(1)).toBeVisible();
});
