import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const nextConfig: NextConfig = {
  ...(process.env.VERCEL ? {} : { output: 'standalone' as const }),
  // `lib/config` reads `config/*.toml` at runtime (D-21). Make sure the file
  // ships with every server bundle on both deploy paths.
  outputFileTracingIncludes: {
    '/**/*': ['./config/**/*'],
  },
};

export default withNextIntl(nextConfig);
