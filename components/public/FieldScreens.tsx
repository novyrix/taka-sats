// SPDX-License-Identifier: AGPL-3.0-only

import { Check, ChevronRight, LoaderCircle, MapPin, Search, WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

/**
 * Illustrative product screens for the public site, drawn with the real design tokens so they
 * stay crisp, translatable and honest. They are decorative and always show sample data. The one
 * device frame lives in `PhoneFrame`; nothing here draws a second bezel.
 */

const SAMPLE_CODE = 'TS-KBR-0042';
const SAMPLE_FINGERPRINT = '9f3a 7c21 … c41e';

export function PhoneFrame({ children }: { readonly children: ReactNode }) {
  return (
    <div
      aria-hidden="true"
      className="relative mx-auto w-full max-w-[290px] rounded-[2.5rem] bg-foreground p-[9px] shadow-[0_30px_70px_rgb(20_20_20/0.22)]"
    >
      <div className="relative aspect-[9/18.2] overflow-hidden rounded-[2rem] bg-background">
        <div className="absolute left-1/2 top-2.5 z-10 h-[14px] w-[14px] -translate-x-1/2 rounded-full bg-foreground" />
        {children}
      </div>
    </div>
  );
}

export function ConsoleFrame({ children }: { readonly children: ReactNode }) {
  return (
    <div
      aria-hidden="true"
      className="mx-auto w-full max-w-[420px] overflow-hidden rounded-xl border border-border bg-card shadow-[0_30px_70px_rgb(20_20_20/0.14)]"
    >
      <div className="flex items-center gap-1.5 border-b border-border bg-muted px-4 py-3">
        <span className="size-2.5 rounded-full bg-border" />
        <span className="size-2.5 rounded-full bg-border" />
        <span className="size-2.5 rounded-full bg-border" />
      </div>
      {children}
    </div>
  );
}

function StatusBar() {
  const t = useTranslations('Home');
  return (
    <div className="flex items-center justify-between px-5 pb-1 pt-3 font-mono text-[10px] font-bold">
      <span>{t('screenStatus')}</span>
      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 font-display text-[10px]">
        <WifiOff className="size-3" /> {t('screenOffline')}
      </span>
    </div>
  );
}

function ScreenShell({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <StatusBar />
      <h4 className="px-5 pb-3 pt-4 font-display text-xl font-bold tracking-[-0.03em]">{title}</h4>
      <div className="flex flex-1 flex-col gap-3 px-4 pb-4">{children}</div>
    </div>
  );
}

function PrimaryButton({ children }: { readonly children: ReactNode }) {
  return (
    <div className="mt-auto grid h-11 place-items-center rounded-lg bg-primary font-display text-sm font-bold text-primary-foreground">
      {children}
    </div>
  );
}

function Badge({ tone, children }: { readonly tone: 'ok' | 'wait'; readonly children: ReactNode }) {
  return (
    <span
      className={
        tone === 'ok'
          ? 'rounded-full bg-secondary px-2 py-0.5 font-display text-[10px] font-bold text-secondary-foreground'
          : 'rounded-full bg-muted px-2 py-0.5 font-display text-[10px] font-bold text-muted-foreground'
      }
    >
      {children}
    </span>
  );
}

export function ScreenFind() {
  const t = useTranslations('Home');
  const people = [
    { name: 'Akinyi', code: SAMPLE_CODE, ok: true },
    { name: 'Baraka', code: 'TS-KBR-0017', ok: true },
    { name: 'Wanjiru', code: 'TS-KBR-0051', ok: false },
  ];
  return (
    <ScreenShell title={t('screenFindTitle')}>
      <div className="flex h-11 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs text-muted-foreground">
        <Search className="size-4" /> {t('screenFindSearch')}
      </div>
      {people.map((person) => (
        <div
          key={person.code}
          className="flex items-center gap-3 rounded-lg border border-border bg-card p-3"
        >
          <span className="grid size-9 place-items-center rounded-full bg-secondary font-display text-sm font-bold text-secondary-foreground">
            {person.name.slice(0, 1)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-sm font-bold">{person.name}</span>
            <span className="block font-mono text-[10px] text-muted-foreground">{person.code}</span>
          </span>
          <Badge tone={person.ok ? 'ok' : 'wait'}>
            {person.ok ? t('screenApproved') : t('screenPending')}
          </Badge>
        </div>
      ))}
    </ScreenShell>
  );
}

export function ScreenWeigh() {
  const t = useTranslations('Home');
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];
  return (
    <ScreenShell title={t('screenWeighTitle')}>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs">
        <span className="grid size-6 place-items-center rounded-full bg-secondary font-display text-[10px] font-bold text-secondary-foreground">
          A
        </span>
        <span className="font-display font-bold">Akinyi</span>
        <span className="font-mono text-[10px] text-muted-foreground">{SAMPLE_CODE}</span>
      </div>
      <div className="flex gap-2">
        {['PET', 'HDPE', 'Aluminium'].map((material, index) => (
          <span
            key={material}
            className={
              index === 0
                ? 'rounded-lg bg-primary px-3 py-2 font-display text-xs font-bold text-primary-foreground'
                : 'rounded-lg border border-border bg-card px-3 py-2 font-display text-xs font-bold'
            }
          >
            {material}
          </span>
        ))}
      </div>
      <div className="rounded-lg border border-border bg-card px-4 py-3">
        <p className="text-[10px] text-muted-foreground">{t('screenWeight')}</p>
        <p className="font-mono text-3xl font-bold tabular-nums">
          8.40 <span className="text-base text-primary">{t('screenKg')}</span>
        </p>
        <p className="mt-1 text-[10px] text-muted-foreground">{t('screenValue')}</p>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {keys.map((key) => (
          <span
            key={key}
            className="grid h-8 place-items-center rounded-md border border-border bg-card font-mono text-sm font-bold"
          >
            {key}
          </span>
        ))}
      </div>
    </ScreenShell>
  );
}

export function ScreenProof() {
  const t = useTranslations('Home');
  return (
    <ScreenShell title={t('screenProofTitle')}>
      <p className="-mt-1 text-xs text-muted-foreground">{t('screenProofHint')}</p>
      <div className="rounded-xl bg-foreground p-4">
        <div className="rounded-lg bg-[var(--brand-green-tint)] px-4 py-5 text-right">
          <span className="font-mono text-4xl font-bold tabular-nums text-foreground">8.40</span>
        </div>
        <div className="mt-3 flex gap-2">
          <span className="h-9 flex-1 rounded-md bg-white/15" />
          <span className="h-9 w-16 rounded-md bg-white/15" />
        </div>
      </div>
      <div className="rounded-lg border border-border bg-card p-3">
        <p className="text-[10px] text-muted-foreground">{t('screenProofFingerprint')}</p>
        <p className="mt-0.5 font-mono text-xs font-bold">{SAMPLE_FINGERPRINT}</p>
      </div>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-3 text-xs">
        <MapPin className="size-4 text-primary" /> {t('screenProofLocation')}
      </div>
      <PrimaryButton>{t('screenNext')}</PrimaryButton>
    </ScreenShell>
  );
}

export function ScreenReview() {
  const t = useTranslations('Home');
  const rows = [
    { label: t('screenCollector'), value: `Akinyi · ${SAMPLE_CODE}` },
    { label: t('screenMaterial'), value: 'PET' },
    { label: t('screenWeightRow'), value: `8.40 ${t('screenKg')}` },
    { label: t('screenValueRow'), value: t('screenValue') },
    { label: t('screenProofFingerprint'), value: SAMPLE_FINGERPRINT },
    { label: t('screenProofLocation'), value: 'Kibera Hub' },
  ];
  return (
    <ScreenShell title={t('screenReviewTitle')}>
      <div className="divide-y divide-border rounded-lg border border-border bg-card">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <span className="text-[10px] text-muted-foreground">{row.label}</span>
            <span className="text-right font-display text-xs font-bold">{row.value}</span>
          </div>
        ))}
      </div>
      <PrimaryButton>{t('screenSave')}</PrimaryButton>
    </ScreenShell>
  );
}

export function ScreenQueue() {
  const t = useTranslations('Home');
  const rows = [
    { material: 'PET', kg: '8.40', state: 'confirmed' },
    { material: 'HDPE', kg: '3.10', state: 'confirmed' },
    { material: 'Aluminium', kg: '1.25', state: 'syncing' },
    { material: 'PET', kg: '5.00', state: 'queued' },
  ] as const;
  return (
    <ScreenShell title={t('screenQueueTitle')}>
      {rows.map((row, index) => (
        <div
          key={`${row.material}-${index}`}
          className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-3"
        >
          <span>
            <span className="block font-display text-sm font-bold">{row.material}</span>
            <span className="block font-mono text-[10px] text-muted-foreground">
              {row.kg} {t('screenKg')}
            </span>
          </span>
          {row.state === 'confirmed' ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 font-display text-[10px] font-bold text-secondary-foreground">
              <Check className="size-3" /> {t('screenConfirmed')}
            </span>
          ) : row.state === 'syncing' ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-display text-[10px] font-bold">
              <LoaderCircle className="size-3" /> {t('screenSyncing')}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-display text-[10px] font-bold text-muted-foreground">
              {t('screenQueued')} <ChevronRight className="size-3" />
            </span>
          )}
        </div>
      ))}
    </ScreenShell>
  );
}

export function ScreenPay() {
  const t = useTranslations('Home');
  return (
    <div className="space-y-4 p-6">
      <h4 className="font-display text-xl font-bold tracking-[-0.03em]">{t('screenPayTitle')}</h4>
      <div className="rounded-lg border border-border bg-background p-4">
        <p className="font-mono text-3xl font-bold tabular-nums">
          1,530 <span className="text-base text-primary">{t('satsUnit')}</span>
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{t('screenPayTo')}</p>
        <p className="mt-3 font-mono text-xs text-muted-foreground">
          PET 8.40 {t('screenKg')} · {SAMPLE_CODE}
        </p>
      </div>
      <p className="text-sm text-muted-foreground">{t('screenPayRecordedBy')}</p>
      <p className="flex items-center gap-2 text-sm font-medium text-secondary-foreground">
        <Check className="size-4 text-primary" /> {t('screenPayRule')}
      </p>
      <div className="grid h-11 place-items-center rounded-lg bg-primary font-display text-sm font-bold text-primary-foreground">
        {t('screenApprove')}
      </div>
      <p className="flex items-center gap-2 rounded-lg bg-secondary px-3 py-2.5 text-xs font-medium text-secondary-foreground">
        <Check className="size-4" /> {t('screenPaid')}
      </p>
    </div>
  );
}
