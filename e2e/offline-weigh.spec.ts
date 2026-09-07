// SPDX-License-Identifier: AGPL-3.0-only

import path from 'node:path';
import { expect, test } from '@playwright/test';
import { FIELD_SUPERVISOR } from './fixtures/accounts';

const SHOT = path.join(__dirname, 'fixtures', 'shot.png');

/**
 * M3-11 — the milestone exit criterion. Load the PWA online, sign in, prime the
 * weigh cache; then go **offline** and record a full collection event. It must
 * land in IndexedDB as `queued`, with a `collection_event` (and a `photo`)
 * outbox entry, and nothing may have needed the network.
 */
test('offline: weigh a collector end to end → event is queued in IndexedDB', async ({
  page,
  context,
}) => {
  // ── sign in (online) ──────────────────────────────────────────────────────
  await page.goto('/login');
  await page.fill('#identifier', FIELD_SUPERVISOR.phone);
  await page.fill('#password', FIELD_SUPERVISOR.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/enrol');

  // ── prime the weigh cache (online) ────────────────────────────────────────
  await page.goto('/weigh');
  await expect(page.getByLabel('Search by name')).toBeVisible();

  // ── network off ──────────────────────────────────────────────────────────
  await context.setOffline(true);

  // collector — from the cached list, no network
  await page.getByLabel('Search by name').fill('Amina');
  await page.getByRole('button', { name: /Amina E2E/ }).click();

  // material
  await page.getByRole('button', { name: /PET/ }).click();

  // weight — 2.5 kg on the keypad
  for (const key of ['2', '.', '5']) {
    await page.getByRole('button', { name: key, exact: true }).click();
  }
  await page.getByRole('button', { name: 'Next' }).click();

  // photo — set the hidden file input directly
  await page.setInputFiles('input[type="file"]', SHOT);

  // geolocation is unavailable in headless → a reason is required before save
  const reason = page.locator('#geo-reason');
  await expect(reason).toBeVisible();
  await reason.fill('e2e: headless, no GPS');

  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('Saved — queued')).toBeVisible();

  // ── assert the offline store ─────────────────────────────────────────────
  const store = await page.evaluate(async () => {
    const open = (): Promise<IDBDatabase> =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('takasats-sync');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    const all = (db: IDBDatabase, name: string): Promise<unknown[]> =>
      new Promise((resolve, reject) => {
        const req = db.transaction(name).objectStore(name).getAll();
        req.onsuccess = () => resolve(req.result as unknown[]);
        req.onerror = () => reject(req.error);
      });
    const db = await open();
    const events = (await all(db, 'events')) as {
      syncStatus: { state: string };
      material: string;
      weightKg: number;
    }[];
    const outbox = (await all(db, 'outbox')) as { kind: string }[];
    db.close();
    return { events, kinds: outbox.map((o) => o.kind).sort() };
  });

  expect(store.events).toHaveLength(1);
  expect(store.events[0]?.syncStatus.state).toBe('queued');
  expect(store.events[0]?.material).toBe('PET');
  expect(store.events[0]?.weightKg).toBe(2.5);
  expect(store.kinds).toEqual(['collection_event', 'photo']);
});
