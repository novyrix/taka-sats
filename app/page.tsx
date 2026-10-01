// SPDX-License-Identifier: AGPL-3.0-only

import {
  ArrowRight,
  Camera,
  CheckCircle2,
  DatabaseZap,
  Leaf,
  Scale,
  ShieldCheck,
  Smartphone,
  WifiOff,
  Zap,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ImpactStats } from '@/components/public/ImpactStats';
import screenCollect from '@/docs/Screens/Screen5.png';
import screenFind from '@/docs/Screens/Screen4.png';
import screenMaterial from '@/docs/Screens/Screen3.png';
import screenProof from '@/docs/Screens/Screen2.png';

export default async function Home() {
  const t = await getTranslations('Home');
  const steps = [
    { number: '01', icon: Scale, title: t('collectTitle'), copy: t('collectDescription') },
    { number: '02', icon: Camera, title: t('verifyTitle'), copy: t('verifyDescription') },
    { number: '03', icon: Zap, title: t('payTitle'), copy: t('payDescription') },
  ] as const;
  const productScreens = [
    { src: screenFind, alt: t('identifyAlt'), label: t('identifyLabel') },
    { src: screenMaterial, alt: t('classifyAlt'), label: t('classifyLabel') },
    { src: screenProof, alt: t('proveAlt'), label: t('proveLabel') },
    { src: screenCollect, alt: t('operateAlt'), label: t('operateLabel') },
  ] as const;

  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <header className="relative z-20 mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-10">
        <Link href="/" aria-label={t('homeLabel')}>
          <Image
            src="/taka-sats-logo.png"
            alt={t('brandAlt')}
            width={174}
            height={52}
            className="h-11 w-auto sm:h-12"
            priority
          />
        </Link>
        <nav className="flex items-center gap-3" aria-label={t('primaryNavigation')}>
          <a
            href="#how-it-works"
            className="hidden font-display text-sm font-medium sm:inline-flex"
          >
            {t('howItWorks')}
          </a>
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 font-display text-sm font-bold text-primary-foreground transition-colors hover:bg-[var(--brand-green-deep)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {t('openApp')} <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </nav>
      </header>

      <section className="relative mx-auto grid w-full max-w-7xl items-center gap-10 px-5 pb-20 pt-10 sm:px-8 lg:grid-cols-[1.02fr_0.98fr] lg:px-10 lg:pb-28 lg:pt-16">
        <div className="relative z-10">
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 font-display text-xs font-bold uppercase tracking-[0.08em] shadow-[0_1px_2px_rgb(20_20_20/0.06)]">
            <span className="size-2 rounded-full bg-fill-bitcoin" aria-hidden="true" />{' '}
            {t('eyebrow')}
          </div>
          <h1 className="max-w-3xl font-display text-5xl font-bold leading-[0.98] tracking-[-0.055em] sm:text-7xl lg:text-[5.4rem]">
            {t('heroLine1')} <span className="block text-primary">{t('heroLine2')}</span>{' '}
            {t('heroLine3')}
          </h1>
          <p className="mt-7 max-w-xl text-lg leading-8 text-muted-foreground sm:text-xl">
            {t('description')}
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/login"
              className="inline-flex min-h-14 items-center justify-center gap-2 rounded-lg bg-primary px-6 font-display font-bold text-primary-foreground transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {t('launchApp')} <ArrowRight aria-hidden="true" className="size-5" />
            </Link>
            <a
              href="#product"
              className="inline-flex min-h-14 items-center justify-center gap-2 rounded-lg border border-border bg-card px-6 font-display font-bold transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {t('seeProduct')} <Smartphone aria-hidden="true" className="size-5 text-primary" />
            </a>
          </div>
          <div className="mt-9 flex flex-wrap gap-x-6 gap-y-3 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <WifiOff aria-hidden="true" className="size-4 text-primary" /> {t('offlineTitle')}
            </span>
            <span className="inline-flex items-center gap-2">
              <ShieldCheck aria-hidden="true" className="size-4 text-primary" />{' '}
              {t('evidenceLinked')}
            </span>
            <span className="inline-flex items-center gap-2">
              <DatabaseZap aria-hidden="true" className="size-4 text-primary" />{' '}
              {t('verifiableLedger')}
            </span>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-[560px] lg:mr-0">
          <div
            aria-hidden="true"
            className="absolute -left-8 top-20 h-64 w-36 rounded-3xl bg-secondary"
          />
          <div
            aria-hidden="true"
            className="absolute -right-7 bottom-24 h-44 w-44 rounded-full bg-fill-bitcoin"
          />
          <div className="relative ml-auto w-[75%] rotate-[2deg] overflow-hidden rounded-[2.8rem] border-[7px] border-foreground bg-card shadow-[0_24px_70px_rgb(20_20_20/0.18)] sm:w-[68%]">
            <Image
              src={screenCollect}
              alt={t('heroScreenAlt')}
              className="h-auto w-full"
              sizes="(max-width: 1024px) 70vw, 390px"
              priority
            />
          </div>
          <div className="absolute bottom-12 left-0 max-w-[230px] rounded-xl border border-border bg-card p-4 shadow-[0_6px_24px_rgb(20_20_20/0.10)] sm:left-4">
            <div className="flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary text-primary">
                <CheckCircle2 aria-hidden="true" className="size-5" />
              </span>
              <div>
                <p className="font-display text-sm font-bold">{t('fieldReadyTitle')}</p>
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  {t('fieldReadyDescription')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-card">
        <div className="mx-auto w-full max-w-7xl px-5 py-10 sm:px-8 lg:px-10">
          <div className="mb-6 flex items-center gap-3">
            <span className="font-display text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
              {t('livePilot')}
            </span>
            <span className="h-px flex-1 bg-border" aria-hidden="true" />
          </div>
          <ImpactStats />
        </div>
      </section>

      <section
        id="how-it-works"
        className="mx-auto w-full max-w-7xl scroll-mt-8 px-5 py-20 sm:px-8 lg:px-10 lg:py-28"
      >
        <div className="grid gap-8 lg:grid-cols-[0.75fr_1.25fr] lg:gap-16">
          <div>
            <p className="font-display text-sm font-bold uppercase tracking-[0.1em] text-primary">
              {t('flowEyebrow')}
            </p>
            <h2 className="mt-4 font-display text-4xl font-bold leading-tight tracking-[-0.04em] sm:text-5xl">
              {t('flowTitle')}
            </h2>
            <p className="mt-5 max-w-md text-lg leading-8 text-muted-foreground">
              {t('flowDescription')}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {steps.map(({ number, icon: Icon, title, copy }) => (
              <article
                key={number}
                className="rounded-xl border border-border bg-card p-6 shadow-[0_1px_2px_rgb(20_20_20/0.06)]"
              >
                <div className="flex items-center justify-between">
                  <span className="grid size-11 place-items-center rounded-lg bg-secondary text-primary">
                    <Icon aria-hidden="true" className="size-5" />
                  </span>
                  <span className="font-mono text-xs font-bold text-muted-foreground">
                    {number}
                  </span>
                </div>
                <h3 className="mt-7 font-display text-xl font-bold">{title}</h3>
                <p className="mt-3 leading-7 text-muted-foreground">{copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="product" className="scroll-mt-8 bg-[var(--brand-ink)] text-white">
        <div className="mx-auto w-full max-w-7xl px-5 py-20 sm:px-8 lg:px-10 lg:py-28">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div>
              <p className="font-display text-sm font-bold uppercase tracking-[0.1em] text-[var(--brand-green-tint)]">
                {t('productEyebrow')}
              </p>
              <h2 className="mt-4 max-w-2xl font-display text-4xl font-bold leading-tight tracking-[-0.04em] sm:text-5xl">
                {t('productTitle')}
              </h2>
            </div>
            <p className="max-w-sm text-base leading-7 text-white/65">{t('productDescription')}</p>
          </div>
          <div className="mt-14 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
            {productScreens.map((screen) => (
              <figure
                key={screen.label}
                className="overflow-hidden rounded-xl border border-white/15 bg-white/5 p-2 sm:p-3"
              >
                <div className="overflow-hidden rounded-lg bg-white">
                  <Image
                    src={screen.src}
                    alt={screen.alt}
                    className="h-auto w-full"
                    sizes="(max-width: 640px) 46vw, 280px"
                  />
                </div>
                <figcaption className="px-2 pb-1 pt-3 font-display text-sm font-bold text-white/80">
                  {screen.label}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-8 px-5 py-20 sm:px-8 lg:grid-cols-2 lg:px-10 lg:py-28">
        <div className="rounded-xl bg-primary p-8 text-primary-foreground sm:p-10">
          <Leaf aria-hidden="true" className="size-9" />
          <h2 className="mt-10 font-display text-3xl font-bold tracking-[-0.035em] sm:text-4xl">
            {t('trustTitle')}
          </h2>
          <p className="mt-5 max-w-lg text-lg leading-8 text-white/75">{t('trustDescription')}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-8 sm:p-10">
          <DatabaseZap aria-hidden="true" className="size-9 text-primary" />
          <h2 className="mt-10 font-display text-3xl font-bold tracking-[-0.035em] sm:text-4xl">
            {t('ledgerTitle')}
          </h2>
          <p className="mt-5 max-w-lg text-lg leading-8 text-muted-foreground">
            {t('ledgerDescription')}
          </p>
        </div>
      </section>

      <section className="border-t border-border bg-card">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-start justify-between gap-8 px-5 py-14 sm:flex-row sm:items-center sm:px-8 lg:px-10">
          <div>
            <p className="font-display text-3xl font-bold tracking-[-0.035em]">{t('ctaTitle')}</p>
            <p className="mt-2 text-muted-foreground">{t('ctaDescription')}</p>
          </div>
          <Link
            href="/login"
            className="inline-flex min-h-14 items-center justify-center gap-2 rounded-lg bg-primary px-6 font-display font-bold text-primary-foreground"
          >
            {t('signIn')} <ArrowRight aria-hidden="true" className="size-5" />
          </Link>
        </div>
      </section>

      <footer className="bg-[var(--brand-ink)] text-white">
        <div className="h-2 bg-fill-bitcoin" aria-hidden="true" />
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-10">
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
