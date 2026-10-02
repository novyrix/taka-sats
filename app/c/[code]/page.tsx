// SPDX-License-Identifier: AGPL-3.0-only

import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

/**
 * What a phone shows when it opens a collector credential link (`/c/<publicCode>`). It reveals
 * NOTHING: it does not look the code up, so it cannot confirm that a collector exists, and it
 * never shows a name, wallet or amount. Staff identify collectors inside the signed-in app.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function CollectorLandingPage() {
  const t = await getTranslations('CollectorLanding');
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 py-12">
      <h1 className="font-display text-2xl font-bold tracking-[-0.02em]">{t('title')}</h1>
      <p className="text-base">{t('body')}</p>
      <p className="text-sm text-muted-foreground">{t('privacy')}</p>
      <Link href="/" className="text-sm underline">
        {t('home')}
      </Link>
    </main>
  );
}
