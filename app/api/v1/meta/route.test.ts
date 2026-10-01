// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('GET /api/v1/meta', () => {
  it('is public and describes the deployment without secrets', async () => {
    const response = GET();
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.programme).toMatchObject({
      fiatCurrency: 'KES',
      defaultLocale: 'en',
      publicBaseUrl: 'https://taka.afribit.africa',
    });
    expect(body.collectors).toEqual({
      authorizationRequired: true,
      codePrefix: 'TS',
      defaultSiteCode: null,
    });
    expect(typeof body.lightning.floatProvider).toBe('string');
    expect(typeof body.lightning.demo).toBe('boolean');
  });

  it('exposes nothing that looks like a secret or a key', async () => {
    const text = JSON.stringify(await GET().json());
    expect(text).not.toMatch(/key|secret|password|token|DATABASE_URL/i);
  });
});
