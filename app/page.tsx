// SPDX-License-Identifier: AGPL-3.0-only

import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  Camera,
  CheckCircle2,
  DatabaseZap,
  Landmark,
  Link2,
  Recycle,
  Scale,
  ShieldCheck,
  Users,
  WifiOff,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { PhoneFrame, ScreenReview } from '@/components/public/FieldScreens';
import { ImpactStats } from '@/components/public/ImpactStats';
import { StepShowcase } from '@/components/public/StepShowcase';
import { SOURCE_CODE_URL, VERIFICATION_PROTOCOL_URL } from '@/lib/site';

const SETUP_GUIDE_URL = `${SOURCE_CODE_URL}/blob/main/docs/GETTING_STARTED.md`;

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

const primaryButton = `inline-flex min-h-14 items-center justify-center gap-2 rounded-lg bg-primary px-6 font-display font-bold text-primary-foreground transition-transform hover:-translate-y-0.5 ${focusRing}`;
const secondaryButton = `inline-flex min-h-14 items-center justify-center gap-2 rounded-lg border border-border bg-card px-6 font-display font-bold transition-colors hover:bg-secondary ${focusRing}`;

export default async function Home() {
  const t = await getTranslations('Home');

  const steps = [
    {
      actor: t('flowIdentifyActor'),
      title: t('flowIdentifyTitle'),
      copy: t('flowIdentifyDescription'),
    },
    { actor: t('flowWeighActor'), title: t('flowWeighTitle'), copy: t('flowWeighDescription') },
    {
      actor: t('flowEvidenceActor'),
      title: t('flowEvidenceTitle'),
      copy: t('flowEvidenceDescription'),
    },
    { actor: t('flowSyncActor'), title: t('flowSyncTitle'), copy: t('flowSyncDescription') },
    { actor: t('flowPayoutActor'), title: t('flowPayoutTitle'), copy: t('flowPayoutDescription') },
  ] as const;

  const audiences = [
    { icon: Recycle, title: t('audienceCollectorTitle'), body: t('audienceCollectorBody') },
    { icon: Building2, title: t('audienceStaffTitle'), body: t('audienceStaffBody') },
    { icon: Landmark, title: t('audienceFunderTitle'), body: t('audienceFunderBody') },
  ] as const;

  const checks = [
    { icon: Users, title: t('trust1Title'), body: t('trust1Body') },
    { icon: Camera, title: t('trust2Title'), body: t('trust2Body') },
    { icon: ShieldCheck, title: t('trust3Title'), body: t('trust3Body') },
    { icon: Scale, title: t('trust4Title'), body: t('trust4Body') },
  ] as const;

  const ledger = [
    {
      seq: '1041',
      kind: t('ledgerCollection'),
      hash: '4be1 09a7 … a90c',
      prev: '77d2 e1f3 … 0e13',
    },
    { seq: '1042', kind: t('ledgerApproval'), hash: 'c0de 3b58 … 7f21', prev: '4be1 09a7 … a90c' },
    { seq: '1043', kind: t('ledgerPayout'), hash: '12ab f6d4 … 88e0', prev: 'c0de 3b58 … 7f21' },
  ] as const;

  const runPoints = [
    { title: t('runPoint1Title'), body: t('runPoint1Body') },
    { title: t('runPoint2Title'), body: t('runPoint2Body') },
    { title: t('runPoint3Title'), body: t('runPoint3Body') },
  ] as const;

  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <header className="relative z-20 mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-10">
        <Link href="/" aria-label={t('homeLabel')} className={focusRing}>
          <Image
            src="/taka-sats-logo.png"
            alt={t('brandAlt')}
            width={174}
            height={52}
            className="h-11 w-auto sm:h-12"
            priority
          />
        </Link>
        <nav className="flex items-center gap-5" aria-label={t('primaryNavigation')}>
          <a
            href="#how-it-works"
            className={`hidden font-display text-sm font-medium md:inline-flex ${focusRing}`}
          >
            {t('howItWorks')}
          </a>
          <a
            href="#trust"
            className={`hidden font-display text-sm font-medium md:inline-flex ${focusRing}`}
          >
            {t('trustNav')}
          </a>
          <a
            href="#run"
            className={`hidden font-display text-sm font-medium md:inline-flex ${focusRing}`}
          >
            {t('runNav')}
          </a>
          <Link
            href="/about"
            className={`hidden font-display text-sm font-medium sm:inline-flex ${focusRing}`}
          >
            {t('about')}
          </Link>
          <Link
            href="/login"
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 font-display text-sm font-bold text-primary-foreground transition-colors hover:bg-[var(--brand-green-deep)] ${focusRing}`}
          >
            {t('openApp')} <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </nav>
      </header>

      <section className="relative mx-auto grid w-full max-w-7xl items-center gap-14 px-5 pb-20 pt-8 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:px-10 lg:pb-28 lg:pt-14">
        <div className="relative z-10">
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 font-display text-xs font-bold uppercase tracking-[0.08em] shadow-[0_1px_2px_rgb(20_20_20/0.06)]">
            <span className="size-2 rounded-full bg-fill-bitcoin" aria-hidden="true" />{' '}
            {t('eyebrow')}
          </div>
          <h1 className="max-w-3xl font-display text-5xl font-bold leading-[0.98] tracking-[-0.055em] sm:text-7xl lg:text-[5.2rem]">
            {t('heroLine1')} <span className="block text-primary">{t('heroLine2')}</span>{' '}
            {t('heroLine3')}
          </h1>
          <p className="mt-7 max-w-xl text-lg leading-8 text-muted-foreground sm:text-xl">
            {t('description')}
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link href="/login" className={primaryButton}>
              {t('launchApp')} <ArrowRight aria-hidden="true" className="size-5" />
            </Link>
            <a href="#how-it-works" className={secondaryButton}>
              {t('seeHow')}
            </a>
          </div>
          <ul className="mt-9 flex flex-wrap gap-x-6 gap-y-3 text-sm text-muted-foreground">
            <li className="inline-flex items-center gap-2">
              <WifiOff aria-hidden="true" className="size-4 text-primary" /> {t('pointOffline')}
            </li>
            <li className="inline-flex items-center gap-2">
              <Camera aria-hidden="true" className="size-4 text-primary" /> {t('pointEvidence')}
            </li>
            <li className="inline-flex items-center gap-2">
              <DatabaseZap aria-hidden="true" className="size-4 text-primary" /> {t('pointLedger')}
            </li>
          </ul>
        </div>

        <div className="relative mx-auto w-full max-w-[470px] lg:mr-0">
          <div
            aria-hidden="true"
            className="absolute -left-6 top-24 h-72 w-40 rounded-3xl bg-secondary"
          />
          <div
            aria-hidden="true"
            className="absolute -right-5 bottom-28 size-40 rounded-full bg-fill-bitcoin"
          />
          <div className="relative px-6 sm:px-10">
            <PhoneFrame>
              <ScreenReview />
            </PhoneFrame>
          </div>
          <div className="absolute -left-1 bottom-24 max-w-[220px] rounded-xl border border-border bg-card p-4 shadow-[0_6px_24px_rgb(20_20_20/0.10)] sm:left-0">
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-primary">
                <CheckCircle2 aria-hidden="true" className="size-5" />
              </span>
              <div>
                <p className="font-display text-sm font-bold">{t('chipSavedTitle')}</p>
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  {t('chipSavedBody')}
                </p>
              </div>
            </div>
          </div>
          <div className="absolute -right-1 top-[64%] max-w-[200px] rounded-xl border border-border bg-card p-4 shadow-[0_6px_24px_rgb(20_20_20/0.10)] sm:right-0">
            <p className="flex items-center gap-2 font-display text-sm font-bold">
              <Link2 aria-hidden="true" className="size-4 text-primary" /> {t('chipLedgerTitle')}
            </p>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">4be1 09a7 … a90c</p>
          </div>
          <p className="relative mt-6 text-center text-xs text-muted-foreground">
            {t('sampleNote')}
          </p>
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

      <section className="mx-auto w-full max-w-7xl px-5 py-20 sm:px-8 lg:px-10 lg:py-28">
        <p className="font-display text-sm font-bold uppercase tracking-[0.1em] text-primary">
          {t('audienceEyebrow')}
        </p>
        <h2 className="mt-4 max-w-3xl font-display text-4xl font-bold leading-tight tracking-[-0.04em] sm:text-5xl">
          {t('audienceTitle')}
        </h2>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {audiences.map(({ icon: Icon, title, body }) => (
            <article
              key={title}
              className="rounded-xl border border-border bg-card p-7 shadow-[0_1px_2px_rgb(20_20_20/0.06)]"
            >
              <span className="grid size-12 place-items-center rounded-full bg-secondary text-primary">
                <Icon aria-hidden="true" className="size-6" />
              </span>
              <h3 className="mt-6 font-display text-2xl font-bold tracking-[-0.02em]">{title}</h3>
              <p className="mt-3 leading-7 text-muted-foreground">{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="how-it-works" className="scroll-mt-8 border-y border-border bg-secondary/60">
        <div className="mx-auto w-full max-w-7xl px-5 py-20 sm:px-8 lg:px-10 lg:py-28">
          <p className="font-display text-sm font-bold uppercase tracking-[0.1em] text-primary">
            {t('flowEyebrow')}
          </p>
          <h2 className="mt-4 max-w-3xl font-display text-4xl font-bold leading-tight tracking-[-0.04em] sm:text-5xl">
            {t('flowTitle')}
          </h2>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
            {t('flowDescription')}
          </p>
          <div className="mt-14">
            <StepShowcase steps={steps} label={t('tabsLabel')} sampleNote={t('sampleNote')} />
          </div>
        </div>
      </section>

      <section
        id="trust"
        className="mx-auto w-full max-w-7xl scroll-mt-8 px-5 py-20 sm:px-8 lg:px-10 lg:py-28"
      >
        <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
          <div>
            <p className="font-display text-sm font-bold uppercase tracking-[0.1em] text-primary">
              {t('trustEyebrow')}
            </p>
            <h2 className="mt-4 font-display text-4xl font-bold leading-tight tracking-[-0.04em] sm:text-5xl">
              {t('trustTitle')}
            </h2>
            <p className="mt-5 max-w-xl text-lg leading-8 text-muted-foreground">
              {t('trustIntro')}
            </p>
            <ul className="mt-10 grid gap-6 sm:grid-cols-2">
              {checks.map(({ icon: Icon, title, body }) => (
                <li key={title} className="flex gap-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary text-primary">
                    <Icon aria-hidden="true" className="size-5" />
                  </span>
                  <div>
                    <h3 className="font-display text-lg font-bold">{title}</h3>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
            <a
              href={VERIFICATION_PROTOCOL_URL}
              className={`mt-10 inline-flex items-center gap-2 font-display font-bold text-primary underline underline-offset-4 ${focusRing}`}
            >
              {t('trustLink')} <ArrowUpRight aria-hidden="true" className="size-4" />
            </a>
          </div>

          <div className="self-start rounded-xl border border-border bg-card p-6 shadow-[0_24px_60px_rgb(20_20_20/0.08)] sm:p-8">
            <div className="flex items-center justify-between">
              <p className="font-display text-lg font-bold">{t('ledgerCardTitle')}</p>
              <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                {t('ledgerCardSample')}
              </p>
            </div>
            <ol className="mt-6 space-y-3" aria-hidden="true">
              {ledger.map((entry) => (
                <li key={entry.seq} className="rounded-lg border border-border bg-background p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-display text-sm font-bold">{entry.kind}</span>
                    <span className="font-mono text-xs font-bold text-muted-foreground">
                      #{entry.seq}
                    </span>
                  </div>
                  <p className="mt-2 font-mono text-xs font-bold">{entry.hash}</p>
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                    {t('ledgerPrev')}: {entry.prev}
                  </p>
                </li>
              ))}
            </ol>
            <p className="mt-6 text-sm leading-6 text-muted-foreground">{t('ledgerCaption')}</p>
          </div>
        </div>
      </section>

      <section id="run" className="scroll-mt-8 bg-[var(--brand-ink)] text-white">
        <div className="mx-auto grid w-full max-w-7xl gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[1fr_0.9fr] lg:px-10 lg:py-28">
          <div>
            <p className="font-display text-sm font-bold uppercase tracking-[0.1em] text-[var(--brand-green-tint)]">
              {t('runEyebrow')}
            </p>
            <h2 className="mt-4 font-display text-4xl font-bold leading-tight tracking-[-0.04em] sm:text-5xl">
              {t('runTitle')}
            </h2>
            <p className="mt-5 max-w-xl text-lg leading-8 text-white/70">{t('runBody')}</p>
            <dl className="mt-10 grid gap-6 sm:grid-cols-3">
              {runPoints.map((point) => (
                <div key={point.title}>
                  <dt className="font-display font-bold">{point.title}</dt>
                  <dd className="mt-1 text-sm leading-6 text-white/65">{point.body}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <a
                href={SETUP_GUIDE_URL}
                className={`inline-flex min-h-14 items-center justify-center gap-2 rounded-lg bg-white px-6 font-display font-bold text-[var(--brand-ink)] transition-transform hover:-translate-y-0.5 ${focusRing}`}
              >
                {t('runGuide')} <ArrowUpRight aria-hidden="true" className="size-5" />
              </a>
              <a
                href={SOURCE_CODE_URL}
                className={`inline-flex min-h-14 items-center justify-center gap-2 rounded-lg border border-white/25 px-6 font-display font-bold transition-colors hover:bg-white/10 ${focusRing}`}
              >
                {t('runSource')} <ArrowUpRight aria-hidden="true" className="size-5" />
              </a>
            </div>
          </div>
          <pre
            tabIndex={0}
            className="self-center overflow-x-auto rounded-xl border border-white/15 bg-black/40 p-6 font-mono text-sm leading-7 text-white/85"
          >
            <code>
              {`git clone ${SOURCE_CODE_URL}.git
cd taka-sats
cp .env.example .env
docker compose \\
  -f docker/docker-compose.yml \\
  -f docker/docker-compose.https.yml \\
  --env-file .env up -d --build`}
            </code>
          </pre>
        </div>
      </section>

      <section className="border-b border-border bg-card">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-start justify-between gap-8 px-5 py-14 sm:flex-row sm:items-center sm:px-8 lg:px-10">
          <div>
            <p className="font-display text-3xl font-bold tracking-[-0.035em]">{t('ctaTitle')}</p>
            <p className="mt-2 text-muted-foreground">{t('ctaDescription')}</p>
          </div>
          <Link href="/login" className={primaryButton}>
            {t('signIn')} <ArrowRight aria-hidden="true" className="size-5" />
          </Link>
        </div>
      </section>

      <footer className="bg-[var(--brand-ink)] text-white">
        <div className="h-2 bg-fill-bitcoin" aria-hidden="true" />
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 py-10 sm:px-8 lg:px-10">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <Image
              src="/taka-sats-logo.png"
              alt={t('brandAlt')}
              width={150}
              height={46}
              className="h-10 w-auto rounded bg-white px-2 py-1"
            />
            <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm" aria-label={t('footer')}>
              <Link href="/about" className={`text-white/80 hover:text-white ${focusRing}`}>
                {t('footerAbout')}
              </Link>
              <a
                href={VERIFICATION_PROTOCOL_URL}
                className={`text-white/80 hover:text-white ${focusRing}`}
              >
                {t('footerVerification')}
              </a>
              <a href={SOURCE_CODE_URL} className={`text-white/80 hover:text-white ${focusRing}`}>
                {t('footerSource')}
              </a>
            </nav>
          </div>
          <p className="text-sm text-white/60">{t('footer')}</p>
        </div>
      </footer>
    </main>
  );
}
