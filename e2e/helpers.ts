// SPDX-License-Identifier: AGPL-3.0-only

import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';
import type { Account } from './fixtures/accounts';

const SHOT = path.join(__dirname, 'fixtures', 'shot.png');

/** Sign in through the real login form. Returns once the redirect after sign-in has happened. */
export async function login(page: Page, account: Account, landing: string): Promise<void> {
  await page.goto('/login');
  await page.fill('#identifier', account.phone);
  await page.fill('#password', account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(`**${landing}`);
}

/** A fresh, isolated browser session (its own cookies) for one person. */
export async function personContext(
  browser: Browser,
  account: Account,
  landing: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, account, landing);
  return { context, page };
}

/** `YYYY-MM-DDTHH:mm` in the browser's local time, for a datetime-local input. */
export function localInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export async function expectNoErrorNotice(page: Page): Promise<void> {
  await expect(page.getByTestId('error-notice')).toHaveCount(0);
}

/** Record one 2.5 kg PET collection through the five-screen flow (works with the network off). */
export async function recordCollection(page: Page, search: string, alias: RegExp): Promise<void> {
  await page.getByRole('textbox', { name: 'Search name or code' }).fill(search);
  await page.getByRole('button', { name: alias }).click();
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
  await page.getByRole('button', { name: 'Confirm collection' }).click();
  await expect(page.getByText('Saved and queued')).toBeVisible();
}
