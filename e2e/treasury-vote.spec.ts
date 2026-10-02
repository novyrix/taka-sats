// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from '@playwright/test';
import { ADMINS } from './fixtures/accounts';
import { personContext } from './helpers';

/**
 * The treasury funding vote with three admins in three browsers: the proposer cannot approve,
 * two others do, the transfer reference is recorded, and arrival is only accepted when the hot
 * wallet balance shows the funds (here it does not, so the proposal honestly stays transferred).
 */
test('treasury vote: propose, two other admins approve, record the transfer, arrival is checked', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const one = await personContext(browser, ADMINS[0], '/admin');
  const two = await personContext(browser, ADMINS[1], '/admin');
  const three = await personContext(browser, ADMINS[2], '/admin');
  const card = (page: typeof one.page) => page.locator('li').filter({ hasText: '50,000 sats' });

  // Admin One proposes a refill.
  await one.page.goto('/treasury');
  await expect(one.page.getByText('Not configured')).toBeVisible();
  await one.page.getByTestId('propose-amount').fill('50000');
  await one.page.getByTestId('propose-submit').click();
  await expect(card(one.page)).toBeVisible();
  await expect(card(one.page)).toContainText('Proposed');
  // The separation of duties is visible: the proposer has no Approve button and is told why.
  await expect(card(one.page).getByTestId('signoff')).toHaveCount(0);
  await expect(card(one.page).getByTestId('duty-note')).toContainText('cannot approve');
  // And the API refuses even if the button were forced.
  const proposalId = await one.page.evaluate(async () => {
    const res = await fetch('/api/v1/treasury/topups?limit=1');
    return ((await res.json()) as { topups: { id: string }[] }).topups[0]?.id ?? '';
  });
  const refused = await one.page.evaluate(async (id) => {
    const res = await fetch(`/api/v1/treasury/topups/${id}/signoff`, { method: 'POST' });
    return {
      status: res.status,
      code: ((await res.json()) as { error: { code: string } }).error.code,
    };
  }, proposalId);
  expect(refused).toEqual({ status: 403, code: 'self_approval' });

  // Admin Two approves: one of two.
  await two.page.goto('/treasury');
  await card(two.page).getByTestId('signoff').click();
  await expect(card(two.page)).toContainText('1 of 2: Admin Two');
  await expect(card(two.page).getByRole('button', { name: 'You approved' })).toBeDisabled();

  // Admin Three approves: quorum reached.
  await three.page.goto('/treasury');
  await card(three.page).getByTestId('signoff').click();
  await expect(card(three.page)).toContainText('Approved, transfer needed');

  // The proposer records the transfer made in the pool wallet.
  await one.page.goto('/treasury');
  await card(one.page).getByTestId('transfer-reference').fill('e2etx0123456789abcdef');
  await card(one.page).getByTestId('record-transfer').click();
  await expect(card(one.page)).toContainText('Transferred, waiting for arrival');
  await expect(card(one.page)).toContainText('e2etx0123456789abcdef');

  // Arrival is judged by the hot wallet balance, never by a person's say-so.
  await two.page.goto('/treasury');
  await card(two.page).getByTestId('check-arrival').click();
  await expect(two.page.getByText('have not shown up')).toBeVisible();
  await expect(card(two.page)).toContainText('Transferred, waiting for arrival');

  // Every step is on the ledger.
  await one.page.goto('/ledger?type=treasury_topup');
  await expect(one.page.getByRole('cell', { name: 'Treasury refill' }).first()).toBeVisible();

  for (const person of [one, two, three]) {
    await person.context.close();
  }
});
