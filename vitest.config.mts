// SPDX-License-Identifier: AGPL-3.0-only

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['{lib,app,components,scripts}/**/*.{test,spec}.{ts,tsx}'],
    // Integration suites (lib/collectors, app/api/v1/**) share ONE real
    // Postgres via DATABASE_URL and each does `truncate ... cascade` in
    // beforeEach. Running test files in parallel let one file's truncate
    // wipe another file's mid-test data — sequential files avoids that.
    // The suite is small; this costs nothing worth optimising away.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.ts'],
      exclude: ['lib/**/*.{test,spec}.ts', 'lib/**/README.md'],
    },
  },
});
