// SPDX-License-Identifier: AGPL-3.0-only

import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/login',
        '/enrol',
        '/lookup',
        '/rotations',
        '/session',
        '/sessions',
        '/weigh',
      ],
    },
    sitemap: 'https://taka.afribit.africa/sitemap.xml',
    host: 'https://taka.afribit.africa',
  };
}
