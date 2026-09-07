// SPDX-License-Identifier: AGPL-3.0-only

import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the required e2e suites (Code Style Guide §10): the
 * offline weigh flow (M3-11) and, later, the payout flow (M5-10).
 *
 * `webServer` builds and starts the app once. It needs `DATABASE_URL` and
 * `AUTH_SECRET` in the environment (CI sets both; locally, `.env.local`).
 * `pnpm build:turbo` — the service worker is not needed here: the spec loads
 * online, then `context.setOffline(true)`.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm build:turbo && pnpm exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { E2E: '1' },
  },
});
