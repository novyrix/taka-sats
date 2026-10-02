// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { buildSecurityHeaders } from '../next.config';

const headers = (dev: boolean) =>
  Object.fromEntries(buildSecurityHeaders(dev).map((h) => [h.key, h.value]));

describe('security headers', () => {
  const prod = headers(false);

  it('sets the standard protective headers', () => {
    expect(prod['X-Content-Type-Options']).toBe('nosniff');
    expect(prod['X-Frame-Options']).toBe('DENY');
    expect(prod['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(prod['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(prod['Strict-Transport-Security']).toMatch(/max-age=\d+/);
  });

  it('the CSP forbids framing, plugins, remote scripts and foreign form targets', () => {
    const csp = prod['Content-Security-Policy'] ?? '';
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*https?:/);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-eval'/); // only in development
    expect(csp).not.toContain('*');
  });

  it('allows what the PWA needs and nothing more: own-origin API, SW, camera, location', () => {
    const csp = prod['Content-Security-Policy'] ?? '';
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("worker-src 'self'");
    expect(csp).toContain("manifest-src 'self'");
    expect(csp).toContain("img-src 'self' data: blob:"); // scale photo previews are blob: URLs
    const policy = prod['Permissions-Policy'] ?? '';
    expect(policy).toContain('camera=(self)');
    expect(policy).toContain('geolocation=(self)');
    expect(policy).toContain('microphone=()');
  });

  it('development adds unsafe-eval (React refresh) and omits upgrade-insecure-requests', () => {
    const csp = headers(true)['Content-Security-Policy'] ?? '';
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).not.toContain('upgrade-insecure-requests');
    expect(prod['Content-Security-Policy']).toContain('upgrade-insecure-requests');
  });
});
