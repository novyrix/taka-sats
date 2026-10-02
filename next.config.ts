// SPDX-License-Identifier: AGPL-3.0-only

import withSerwistInit from '@serwist/next';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

/**
 * Paths the Vercel frontend serves itself. Anything else is forwarded to the stateful origin. Keep
 * this list to public, database-free files; a new signed-in route needs no change here.
 */
const PUBLIC_PATHS = [
  'about(?:/|$)',
  '_next/',
  String.raw`robots\.txt$`,
  String.raw`sitemap\.xml$`,
  'opengraph-image',
  String.raw`favicon\.ico$`,
  String.raw`icon(?:-\d+)?\.png$`,
  String.raw`apple-touch-icon\.png$`,
  String.raw`taka-sats-logo\.png$`,
  String.raw`manifest\.webmanifest$`,
].join('|');
const PROXIED_SOURCE = `/:path((?!${PUBLIC_PATHS}).+)`;

const apiOrigin = process.env.TAKASATS_API_ORIGIN?.replace(/\/$/, '');
if (apiOrigin && !URL.canParse(apiOrigin)) {
  throw new Error('TAKASATS_API_ORIGIN must be an absolute URL');
}

// Serwist offline layer (DESIGN §6.4). `app/sw.ts` precaches the
// built shell + runs Serwist's `defaultCache` runtime strategies. Disabled for
// `next dev`. NB: `@serwist/next@9` injects the precache manifest with a
// **webpack** plugin, so `pnpm build` runs `next build --webpack` (not
// Turbopack) — under Turbopack `public/sw.js` is not emitted.
const withSerwist = withSerwistInit({
  swSrc: 'app/sw.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV !== 'production',
  reloadOnOnline: true,
});

/**
 * Browser security headers for every response. The CSP keeps `'unsafe-inline'` for scripts and
 * styles because Next injects inline bootstrap scripts and the PWA has no nonce middleware yet;
 * everything else is closed down: no remote script, frame, form target or plugin, and the camera,
 * location and Bluetooth (scales) are allowed for this origin only.
 */
export function buildSecurityHeaders(dev = process.env.NODE_ENV !== 'production') {
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
  return [
    { key: 'Content-Security-Policy', value: csp },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    {
      key: 'Permissions-Policy',
      value:
        'camera=(self), geolocation=(self), bluetooth=(self), microphone=(), payment=(), usb=(), serial=(), display-capture=(), interest-cohort=()',
    },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
    // Browsers ignore HSTS over plain http, so this only bites on the https deployments.
    { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
  ];
}

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: buildSecurityHeaders() }];
  },
  // Standalone for the self-hosted image; not on Vercel, and not for the e2e
  // run (which uses `next start`, incompatible with a standalone build).
  ...(process.env.VERCEL || process.env.E2E ? {} : { output: 'standalone' as const }),
  // `lib/config` reads `config/*.toml` at runtime (D-21). Make sure the file
  // ships with every server bundle on both deploy paths.
  outputFileTracingIncludes: {
    '/**/*': ['./config/**/*'],
  },
  // Keep the canonical browser origin on Vercel while the stateful parts run on the VM. Vercel
  // serves only the public pages (home, about, crawler and icon files) and its own static assets.
  // Everything else is forwarded to the VM: the API and Auth.js, and also every signed-in page,
  // because those pages read the database and verify the session on the server. `beforeFiles` is
  // deliberate: it forwards even though equivalent routes exist in the Vercel bundle. A browser
  // asset the Vercel build does not have (a chunk of a VM-rendered page) falls through to the VM.
  // The VM leaves TAKASATS_API_ORIGIN unset, so it serves everything itself and cannot proxy-loop.
  ...(apiOrigin
    ? {
        async rewrites() {
          return {
            beforeFiles: [
              { source: PROXIED_SOURCE, destination: `${apiOrigin}/:path` },
              { source: '/api/:path*', destination: `${apiOrigin}/api/:path*` },
            ],
            afterFiles: [],
            fallback: [{ source: '/_next/:path*', destination: `${apiOrigin}/_next/:path*` }],
          };
        },
      }
    : {}),
};

export default withSerwist(withNextIntl(nextConfig));
