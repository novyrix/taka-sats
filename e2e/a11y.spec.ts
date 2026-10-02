// SPDX-License-Identifier: AGPL-3.0-only

import { test } from '@playwright/test';
import { ADMINS, FIELD_SUPERVISOR } from './fixtures/accounts';
import { audit, login } from './helpers';

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
    '/rates',
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
