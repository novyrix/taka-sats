import withSerwistInit from '@serwist/next';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const apiOrigin = process.env.TAKASATS_API_ORIGIN?.replace(/\/$/, '');
if (apiOrigin && !URL.canParse(apiOrigin)) {
  throw new Error('TAKASATS_API_ORIGIN must be an absolute URL');
}

// Serwist offline layer (DESIGN §6.4, ROADMAP M3-1). `app/sw.ts` precaches the
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

const nextConfig: NextConfig = {
  // Standalone for the self-hosted image; not on Vercel, and not for the e2e
  // run (which uses `next start`, incompatible with a standalone build).
  ...(process.env.VERCEL || process.env.E2E ? {} : { output: 'standalone' as const }),
  // `lib/config` reads `config/*.toml` at runtime (D-21). Make sure the file
  // ships with every server bundle on both deploy paths.
  outputFileTracingIncludes: {
    '/**/*': ['./config/**/*'],
  },
  // Keep the canonical browser origin on Vercel while the stateful API, Auth.js,
  // Postgres, worker and object store run together on the VM. `beforeFiles` is
  // deliberate: it forwards even though equivalent route handlers exist in the
  // Vercel bundle. The VM leaves this unset, so it serves those handlers locally
  // and cannot proxy-loop back to itself.
  ...(apiOrigin
    ? {
        async rewrites() {
          return {
            beforeFiles: [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }],
            afterFiles: [],
            fallback: [],
          };
        },
      }
    : {}),
};

export default withSerwist(withNextIntl(nextConfig));
