// SPDX-License-Identifier: AGPL-3.0-only

import { CircleCheck, FileCheck2, ShieldCheck, WifiOff } from 'lucide-react';
import Image from 'next/image';
import { getTranslations } from 'next-intl/server';

export default async function Home() {
  const t = await getTranslations('Home');

  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-12">
        <header className="flex items-center justify-between border-b border-border pb-5">
          <Image
            src="/taka-sats-logo.png"
            alt={t('brandAlt')}
            width={160}
            height={48}
            className="h-12 w-auto"
            priority
          />
          <div className="flex items-center gap-2 rounded-full bg-secondary px-3 py-2 font-display text-sm font-medium text-secondary-foreground">
            <CircleCheck aria-hidden="true" className="size-4" />
            <span>{t('status')}</span>
          </div>
        </header>

        <section className="grid items-end gap-10 py-8 lg:grid-cols-[1.35fr_0.65fr] lg:py-16">
          <div className="space-y-6">
            <div className="flex items-center gap-3 font-display text-sm font-medium uppercase tracking-[0.08em]">
              <span aria-hidden="true" className="h-1.5 w-8 rounded-full bg-fill-bitcoin" />
              <span>{t('eyebrow')}</span>
            </div>
            <h1 className="max-w-3xl font-display text-4xl font-bold leading-[1.08] tracking-[-0.03em] sm:text-6xl">
              {t('title')}
            </h1>
            <p className="max-w-2xl text-lg leading-8 text-muted-foreground sm:text-xl">
              {t('description')}
            </p>
          </div>

          <div className="rounded-xl border border-border bg-card p-6 text-card-foreground">
            <p className="font-display text-sm font-medium uppercase tracking-[0.08em] text-primary">
              {t('baselineTitle')}
            </p>
            <p className="mt-3 text-base leading-7 text-muted-foreground">
              {t('baselineDescription')}
            </p>
            <div className="mt-6 border-t border-border pt-5">
              <p className="font-display text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                {t('nextLabel')}
              </p>
              <p className="mt-2 font-display text-base font-medium">{t('nextValue')}</p>
            </div>
          </div>
        </section>

        <section className="grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-3">
          <article className="bg-card p-6">
            <WifiOff aria-hidden="true" className="size-6 text-primary" />
            <h2 className="mt-5 font-display text-lg font-medium">{t('offlineTitle')}</h2>
            <p className="mt-2 leading-7 text-muted-foreground">{t('offlineDescription')}</p>
          </article>
          <article className="bg-card p-6">
            <FileCheck2 aria-hidden="true" className="size-6 text-primary" />
            <h2 className="mt-5 font-display text-lg font-medium">{t('verificationTitle')}</h2>
            <p className="mt-2 leading-7 text-muted-foreground">{t('verificationDescription')}</p>
          </article>
          <article className="bg-card p-6">
            <ShieldCheck aria-hidden="true" className="size-6 text-primary" />
            <h2 className="mt-5 font-display text-lg font-medium">{t('custodyTitle')}</h2>
            <p className="mt-2 leading-7 text-muted-foreground">{t('custodyDescription')}</p>
          </article>
        </section>
      </div>
    </main>
  );
}
