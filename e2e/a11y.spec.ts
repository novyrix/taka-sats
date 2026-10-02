// SPDX-License-Identifier: AGPL-3.0-only

import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { ADMINS, FIELD_SUPERVISOR } from './fixtures/accounts';
import { login } from './helpers';

/**
 * Accessibility pass: axe-core over the public pages, every operator console page and the
 * supervisor pages. Serious and critical violations fail the build; the full list of lesser
 * findings is printed so they can be worked down.
 */
async function audit(page: Page, route: string): Promise<void> {
  await page.goto(route);
  await page.waitForLoadState('networkidle');
  // Let client components finish their first fetch.
  await page.waitForTimeout(800);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  const minor = results.violations.filter((v) => !blocking.includes(v));
  if (minor.length > 0) {
    console.log(
      `[a11y] ${route} minor: ${minor.map((v) => `${v.id} x${v.nodes.length}`).join(', ')}`,
    );
  }
  expect(
    blocking.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes
        .slice(0, 3)
        .map((n) => `${n.target.join(' ')} :: ${n.failureSummary?.split('\n')[1] ?? ''}`),
    })),
    `${route} has serious or critical accessibility violations`,
  ).toEqual([]);
}

test.describe('public pages', () => {
  for (const route of ['/', '/about', '/login']) {
    test(`axe: ${route}`, async ({ page }) => {
      await audit(page, route);
    });
  }
});

test.describe('operator console', () => {
  const pages = [
    '/admin',
    '/collectors',
    '/payouts',
    '/events',
    '/treasury',
    '/anomalies',
    '/reconciliation',
    '/ledger',
    '/sessions',
    '/sessions/new',
    '/rotations',
    '/staff',
  ];
  for (const route of pages) {
    test(`axe: ${route}`, async ({ page }) => {
      await login(page, ADMINS[0], '/admin');
      await audit(page, route);
    });
  }
});

test.describe('supervisor pages', () => {
  for (const route of ['/enrol', '/lookup', '/session', '/weigh']) {
    test(`axe: ${route}`, async ({ page }) => {
      await login(page, FIELD_SUPERVISOR, '/enrol');
      await audit(page, route);
    });
  }
});
