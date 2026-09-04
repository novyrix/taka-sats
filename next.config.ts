import withSerwistInit from '@serwist/next';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

// Serwist scaffold (DESIGN §6.4). Disabled outside production builds; M3-1
// turns `app/sw.ts` into the real offline shell + Background Sync outbox.
const withSerwist = withSerwistInit({
  swSrc: 'app/sw.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV !== 'production',
  reloadOnOnline: true,
});

const nextConfig: NextConfig = {
  ...(process.env.VERCEL ? {} : { output: 'standalone' as const }),
  // `lib/config` reads `config/*.toml` at runtime (D-21). Make sure the file
  // ships with every server bundle on both deploy paths.
  outputFileTracingIncludes: {
    '/**/*': ['./config/**/*'],
  },
};

export default withSerwist(withNextIntl(nextConfig));
