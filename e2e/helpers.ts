// SPDX-License-Identifier: AGPL-3.0-only

import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { Account } from './fixtures/accounts';

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
