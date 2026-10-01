// SPDX-License-Identifier: AGPL-3.0-only

import { ArrowRight, ArrowUpRight, Check } from 'lucide-react';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { SOURCE_CODE_URL, VERIFICATION_PROTOCOL_URL } from '@/lib/site';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('About');
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    alternates: { canonical: '/about' },
  };
}

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

export default async function AboutPage() {
  const t = await getTranslations('About');

  const steps = [
    { title: t('step1Title'), body: t('step1Body') },
    { title: t('step2Title'), body: t('step2Body') },
    { title: t('step3Title'), body: t('step3Body') },
    { title: t('step4Title'), body: t('step4Body') },
  ];
  const honest = [
    t('honest1'),
    t('honest2'),
    t('honest3'),
    t('honest4'),
    t('honest5'),
    t('honest6'),
    t('honest7'),
  ];

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-5 sm:px-8">
        <Link href="/" aria-label={t('homeLabel')} className={focusRing}>
          <Image
            src="/taka-sats-logo.png"
            alt={t('brandAlt')}
            width={174}
            height={52}
            className="h-11 w-auto"
            priority
          />
        </Link>
        <nav className="flex items-center gap-3" aria-label={t('primaryNavigation')}>
          <a
            href={SOURCE_CODE_URL}
            className={`hidden font-display text-sm font-medium sm:inline-flex ${focusRing}`}
          >
            {t('navCode')}
          </a>
          <Link
            href="/login"
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 font-display text-sm font-bold text-primary-foreground transition-colors hover:bg-[var(--brand-green-deep)] ${focusRing}`}
          >
            {t('openApp')} <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </nav>
      </header>

      <article className="mx-auto w-full max-w-3xl px-5 pb-20 pt-10 sm:px-8 sm:pt-16">
        <p className="font-display text-sm font-bold uppercase tracking-[0.1em] text-primary">
          {t('eyebrow')}
        </p>
        <h1 className="mt-4 font-display text-4xl font-bold leading-[1.05] tracking-[-0.04em] sm:text-6xl">
          {t('title')}
        </h1>
        <p className="mt-7 text-lg leading-8 text-muted-foreground sm:text-xl sm:leading-9">
          {t('lead')}
        </p>

        <section className="mt-16" aria-labelledby="problem">
          <h2 id="problem" className="font-display text-2xl font-bold tracking-[-0.02em]">
            {t('problemTitle')}
          </h2>
          <p className="mt-4 text-lg leading-8 text-muted-foreground">{t('problemBody')}</p>
        </section>

        <section className="mt-16" aria-labelledby="how">
          <h2 id="how" className="font-display text-2xl font-bold tracking-[-0.02em]">
            {t('howTitle')}
          </h2>
          <ol className="mt-6 space-y-6">
            {steps.map((step, index) => (
              <li key={step.title} className="flex gap-4">
                <span
                  aria-hidden="true"
                  className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary font-display text-sm font-bold text-primary"
                >
                  {index + 1}
                </span>
                <div>
                  <h3 className="font-display text-lg font-bold">{step.title}</h3>
                  <p className="mt-1 leading-7 text-muted-foreground">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-16" aria-labelledby="bitcoin">
          <h2 id="bitcoin" className="font-display text-2xl font-bold tracking-[-0.02em]">
            {t('bitcoinTitle')}
          </h2>
          <p className="mt-4 text-lg leading-8 text-muted-foreground">{t('bitcoinBody')}</p>
        </section>

        <section className="mt-16" aria-labelledby="open">
          <h2 id="open" className="font-display text-2xl font-bold tracking-[-0.02em]">
            {t('openTitle')}
          </h2>
          <p className="mt-4 text-lg leading-8 text-muted-foreground">{t('openBody')}</p>
        </section>

        <section
          className="mt-16 rounded-2xl border border-border bg-card p-6 sm:p-8"
          aria-labelledby="honest"
        >
          <h2 id="honest" className="font-display text-2xl font-bold tracking-[-0.02em]">
            {t('honestTitle')}
          </h2>
          <ul className="mt-5 space-y-3">
            {honest.map((item) => (
              <li key={item} className="flex gap-3 leading-7">
                <Check aria-hidden="true" className="mt-1 size-5 shrink-0 text-primary" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <a
            href={VERIFICATION_PROTOCOL_URL}
            className={`mt-6 inline-flex items-center gap-1.5 font-display font-bold text-primary underline-offset-4 hover:underline ${focusRing}`}
          >
            {t('protocolLink')} <ArrowUpRight aria-hidden="true" className="size-4" />
          </a>
        </section>

        <section className="mt-16" aria-labelledby="status">
          <h2 id="status" className="font-display text-2xl font-bold tracking-[-0.02em]">
            {t('statusTitle')}
          </h2>
          <p className="mt-4 text-lg leading-8 text-muted-foreground">{t('statusBody')}</p>
        </section>

        <section className="mt-16" aria-labelledby="who">
          <h2 id="who" className="font-display text-2xl font-bold tracking-[-0.02em]">
            {t('whoTitle')}
          </h2>
          <p className="mt-4 text-lg leading-8 text-muted-foreground">{t('whoBody')}</p>
          <a
            href={SOURCE_CODE_URL}
            className={`mt-6 inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-border bg-card px-5 font-display font-bold transition-colors hover:bg-secondary ${focusRing}`}
          >
            {t('codeLink')} <ArrowUpRight aria-hidden="true" className="size-4 text-primary" />
          </a>
        </section>
      </article>

      <footer className="bg-[var(--brand-ink)] text-white">
        <div className="h-2 bg-fill-bitcoin" aria-hidden="true" />
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <Image
            src="/taka-sats-logo.png"
            alt={t('brandAlt')}
            width={150}
            height={46}
            className="h-10 w-auto rounded bg-white px-2 py-1"
          />
          <p className="text-sm text-white/60">{t('footer')}</p>
        </div>
      </footer>
    </main>
  );
}
