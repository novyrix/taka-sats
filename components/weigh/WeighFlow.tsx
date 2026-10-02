// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  ChevronRight,
  CircleCheck,
  Clock3,
  CloudUpload,
  MapPin,
  MapPinOff,
  Package,
  Pencil,
  Recycle,
  Search,
  TriangleAlert,
  UserPlus,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OfflineBadge } from '@/components/supervisor/OfflineBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  captureCollectionEvent,
  drainEventQueue,
  drainPhotoQueue,
  primeWeighCache,
  sessionSummary,
  sha256HexBytes,
  type SessionSummary as LocalSummary,
} from '@/lib/sync';
import type { CachedCollector, CachedSessionConfig, GeoFix } from '@/types/domain';
import { QUEUE_CHANGED_EVENT } from './SyncStatusIndicator';
import { WeighCollectorStep } from './WeighCollectorStep';
import { WeightPad } from './WeightPad';

type Step =
  | 'loading'
  | 'blocked'
  | 'home'
  | 'collector'
  | 'material'
  | 'weight'
  | 'photo'
  | 'review'
  | 'done';
type Rate = CachedSessionConfig['rates'][number];

const number = new Intl.NumberFormat('en-KE', { maximumFractionDigits: 3 });
const money = new Intl.NumberFormat('en-KE', { maximumFractionDigits: 2 });

function requestGeo(): Promise<GeoFix> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve({ kind: 'unavailable', reason: 'geolocation-unsupported' });
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          kind: 'fix',
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
        }),
      (err) => resolve({ kind: 'unavailable', reason: `geolocation-error-${err.code}` }),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 15_000 },
    );
  });
}

function ScreenHeader({ title, onBack }: { readonly title: string; readonly onBack?: () => void }) {
  return (
    <header className="flex items-center justify-between gap-3 pb-5">
      <div className="flex min-w-0 items-center gap-2">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="flex size-11 shrink-0 items-center justify-center rounded-full active:bg-accent"
            aria-label="Back"
          >
            <ArrowLeft aria-hidden="true" className="size-7" />
          </button>
        ) : null}
        <h1 className="truncate font-display text-2xl font-bold tracking-[-0.035em]">{title}</h1>
      </div>
      <OfflineBadge className="shrink-0" />
    </header>
  );
}

function CollectorChip({ collector }: { readonly collector: CachedCollector }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-secondary px-4 py-3">
      <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-card text-primary">
        <span className="font-display text-xl font-bold">
          {collector.alias.slice(0, 1).toUpperCase()}
        </span>
      </div>
      <span className="min-w-0">
        <strong className="block truncate font-display text-lg">{collector.alias}</strong>
        <span className="block truncate font-mono text-sm text-muted-foreground">
          {collector.publicCode ?? collector.id}
        </span>
      </span>
    </div>
  );
}

function MaterialTile({
  rate,
  selected,
  onSelect,
}: {
  readonly rate: Rate;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`relative flex min-h-40 flex-col justify-between rounded-2xl bg-card p-4 text-left transition active:scale-[0.98] ${
        selected ? 'ring-2 ring-primary' : 'border border-border'
      }`}
      aria-pressed={selected}
    >
      <div className="flex h-20 w-full items-center justify-center rounded-xl bg-secondary text-primary">
        <Recycle aria-hidden="true" className="size-12" />
      </div>
      <span className="mt-3">
        <strong className="block font-display text-lg">{rate.material}</strong>
        <span className="text-sm text-muted-foreground">
          {money.format(rate.rateFiatMinor / 100)} {rate.fiatCurrency}/kg
        </span>
      </span>
      {selected ? (
        <span className="absolute right-3 top-3 flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check aria-hidden="true" className="size-5" />
        </span>
      ) : null}
    </button>
  );
}

export function WeighFlow({
  supervisorId,
  supervisorName,
}: {
  readonly supervisorId: string;
  readonly supervisorName?: string | undefined;
}) {
  const t = useTranslations('Weigh');
  const home = useTranslations('SupervisorHome');
  const [step, setStep] = useState<Step>('loading');
  const [config, setConfig] = useState<CachedSessionConfig | null>(null);
  const [summary, setSummary] = useState<LocalSummary | null>(null);
  const [blockedReason, setBlockedReason] = useState('');
  const [cacheSource, setCacheSource] = useState<'network' | 'cache' | null>(null);
  const [collector, setCollector] = useState<CachedCollector | null>(null);
  const [rate, setRate] = useState<Rate | null>(null);
  const [weightKg, setWeightKg] = useState(0);
  const [photoSha256, setPhotoSha256] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [geo, setGeo] = useState<GeoFix | null>(null);
  const [geoReason, setGeoReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const confirming = useRef(false);

  const refreshSummary = useCallback((sessionId?: string) => {
    void sessionSummary(sessionId).then(setSummary);
  }, []);

  useEffect(() => {
    let live = true;
    void primeWeighCache().then((result) => {
      if (!live) return;
      if (result.config) {
        setConfig(result.config);
        setCacheSource(result.source);
        refreshSummary(result.config.sessionId);
        setStep('home');
      } else {
        setBlockedReason(result.reason);
        setStep('blocked');
      }
    });
    return () => {
      live = false;
    };
  }, [refreshSummary]);

  useEffect(() => {
    const refresh = () => refreshSummary(config?.sessionId);
    window.addEventListener(QUEUE_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(QUEUE_CHANGED_EVENT, refresh);
  }, [config?.sessionId, refreshSummary]);

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  const resetForNext = useCallback(() => {
    setCollector(null);
    setRate(null);
    setWeightKg(0);
    setPhotoSha256(null);
    setPhotoFile(null);
    setPhotoPreview(null);
    setGeo(null);
    setGeoReason('');
    setError(null);
    setStep('collector');
  }, []);

  async function onPhoto(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setPhotoSha256(await sha256HexBytes(await file.arrayBuffer()));
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
    if (!geo) setGeo(await requestGeo());
  }

  const indicative = useMemo(
    () =>
      rate && config
        ? Math.floor((rate.rateFiatMinor * weightKg * 1_000_000) / config.exchangeRate)
        : 0,
    [config, rate, weightKg],
  );
  const fiatValue = rate ? (rate.rateFiatMinor * weightKg) / 100 : 0;
  const pending = summary
    ? summary.byState.queued + summary.byState.syncing + summary.byState.failed
    : 0;

  async function syncNow(): Promise<void> {
    if (!navigator.onLine) return;
    window.dispatchEvent(new Event(QUEUE_CHANGED_EVENT));
    await Promise.allSettled([drainPhotoQueue(), drainEventQueue()]);
    window.dispatchEvent(new Event(QUEUE_CHANGED_EVENT));
  }

  async function confirm(): Promise<void> {
    if (!collector || !rate || !config || !photoSha256 || !photoFile) return;
    // A double tap must never record two collections: the first call owns the save.
    if (confirming.current) return;
    const resolvedGeo: GeoFix =
      geo && geo.kind === 'fix'
        ? geo
        : { kind: 'unavailable', reason: geoReason.trim() || 'not-provided' };
    if (resolvedGeo.kind === 'unavailable' && !geoReason.trim()) {
      setError(t('geoReasonRequired'));
      setStep('photo');
      return;
    }

    confirming.current = true;
    setBusy(true);
    setError(null);
    try {
      await captureCollectionEvent(
        {
          collectorId: collector.id,
          supervisorId,
          sessionId: config.sessionId,
          material: rate.material,
          weightKg,
          rateId: rate.rateId,
          rateFiatMinor: rate.rateFiatMinor,
          exchangeRate: config.exchangeRate,
          photoSha256,
          geo: resolvedGeo,
          registrationType: collector.nfcTagId ? 'tap' : 'walk_in',
        },
        { blob: photoFile, sha256: photoSha256, contentType: photoFile.type || 'image/jpeg' },
      );
      window.dispatchEvent(new Event(QUEUE_CHANGED_EVENT));
      setStep('done');
      if (navigator.onLine) void syncNow();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('saveFailed'));
    } finally {
      confirming.current = false;
      setBusy(false);
    }
  }

  if (step === 'loading') {
    return <p className="px-5 py-12 text-sm text-muted-foreground">{t('loading')}</p>;
  }

  if (step === 'blocked') {
    return (
      <div className="px-5 py-10">
        <div className="rounded-2xl border border-dashed border-border px-4 py-10 text-center">
          <p className="font-display text-lg font-bold">{t('blockedTitle')}</p>
          <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">{blockedReason}</p>
        </div>
      </div>
    );
  }

  if (!config) return null;

  if (step === 'home') {
    return (
      <div className="space-y-5 px-5 pb-8 pt-6">
        <header className="flex items-center justify-between gap-4">
          <Image src="/taka-sats-logo.png" alt="Taka Sats" width={176} height={54} priority />
          <OfflineBadge />
        </header>

        <section className="pt-2">
          <h1 className="font-display text-4xl font-bold leading-[1.02] tracking-[-0.045em]">
            {home('greeting', { name: supervisorName?.split(' ')[0] ?? home('fallbackName') })}
          </h1>
          <p className="mt-2 text-lg text-muted-foreground">{home('subtitle')}</p>
        </section>

        {cacheSource === 'cache' ? (
          <p className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-sm text-foreground">
            <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
            {t('offlineCache')}
          </p>
        ) : null}

        <button
          type="button"
          onClick={resetForNext}
          className="flex min-h-40 w-full items-center gap-5 rounded-3xl bg-fill-bitcoin p-6 text-left text-foreground shadow-[0_8px_24px_rgb(247_147_26/0.18)] active:bg-fill-bitcoin-pressed"
        >
          <Recycle aria-hidden="true" className="size-16 shrink-0" />
          <span className="min-w-0 flex-1">
            <strong className="block font-display text-3xl font-bold leading-none">
              {home('recordTitle')}
            </strong>
            <span className="mt-3 block text-base">{home('recordDescription')}</span>
          </span>
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-card">
            <ArrowRight aria-hidden="true" className="size-6" />
          </span>
        </button>

        <div className="grid grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => setStep('collector')}
            className="flex min-h-36 flex-col rounded-2xl border border-border bg-card p-4 text-left active:bg-accent"
          >
            <Search aria-hidden="true" className="size-8 text-primary" />
            <strong className="mt-auto font-display text-base">{home('findCollector')}</strong>
          </button>
          <Link
            href="/enrol"
            className="flex min-h-36 flex-col rounded-2xl border border-border bg-card p-4 text-left active:bg-accent"
          >
            <UserPlus aria-hidden="true" className="size-8 text-primary" />
            <strong className="mt-auto font-display text-base">{home('newCollector')}</strong>
          </Link>
          <button
            type="button"
            onClick={() => void syncNow()}
            className="flex min-h-36 flex-col rounded-2xl border border-border bg-card p-4 text-left active:bg-accent"
          >
            <CloudUpload aria-hidden="true" className="size-8 text-primary" />
            <strong className="mt-auto font-display text-base">{home('syncData')}</strong>
          </button>
        </div>

        <Link
          href="/session"
          className="flex min-h-20 items-center gap-4 rounded-2xl bg-secondary px-4 py-3 text-foreground"
        >
          <Clock3 aria-hidden="true" className="size-9 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            <strong className="block font-display text-lg">
              {home('waitingToSync', { count: pending })}
            </strong>
            <span className="text-sm text-muted-foreground">{home('savedOffline')}</span>
          </span>
          <ChevronRight aria-hidden="true" className="size-6" />
        </Link>

        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-3">
            <span className="flex items-start gap-3">
              <MapPin aria-hidden="true" className="mt-0.5 size-7 text-primary" />
              <span>
                <strong className="block font-display text-xl">{config.location}</strong>
                <span className="font-mono text-xs text-muted-foreground">{config.sessionId}</span>
              </span>
            </span>
            <span className="rounded-full bg-secondary px-3 py-1.5 font-display text-xs font-medium text-secondary-foreground">
              {home('sessionActive')}
            </span>
          </div>
          <div className="mt-5 border-t border-border pt-4">
            <p className="font-display text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              {home('today')}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <div>
                <span className="text-sm text-muted-foreground">{home('collected')}</span>
                <strong className="block font-mono text-3xl text-primary">
                  {number.format(summary?.totalKg ?? 0)} kg
                </strong>
              </div>
              <div className="border-l border-border pl-4">
                <span className="text-sm text-muted-foreground">{home('items')}</span>
                <strong className="block font-mono text-3xl">{summary?.count ?? 0}</strong>
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (step === 'collector') {
    return (
      <div className="px-5 py-5">
        <ScreenHeader title={t('findCollectorTitle')} onBack={() => setStep('home')} />
        <WeighCollectorStep
          onResolved={(resolved) => {
            setCollector(resolved);
            setStep('material');
          }}
        />
      </div>
    );
  }

  if (step === 'material') {
    return (
      <div className="flex min-h-dvh flex-col px-5 py-5">
        <ScreenHeader title={t('materialTitle')} onBack={() => setStep('collector')} />
        {collector ? <CollectorChip collector={collector} /> : null}
        <div className="mt-6">
          <h2 className="font-display text-3xl font-bold tracking-[-0.035em]">
            {t('materialTitle')}
          </h2>
          <p className="mt-1 text-lg text-muted-foreground">{t('materialSubtitle')}</p>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          {config.rates.map((item) => (
            <MaterialTile
              key={item.rateId}
              rate={item}
              selected={rate?.rateId === item.rateId}
              onSelect={() => setRate(item)}
            />
          ))}
        </div>
        {config.rates.length === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground">{t('noRates')}</p>
        ) : null}
        <Button
          type="button"
          size="pwa"
          className="mt-6 h-16 text-lg"
          disabled={!rate}
          onClick={() => setStep('weight')}
        >
          {t('continue')} <ArrowRight aria-hidden="true" />
        </Button>
      </div>
    );
  }

  if (step === 'weight') {
    return (
      <div className="px-5 py-5">
        <ScreenHeader title={t('weightTitle')} onBack={() => setStep('material')} />
        <div className="mb-5 grid grid-cols-2 gap-3">
          {collector ? <CollectorChip collector={collector} /> : null}
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-3 py-3">
            <Recycle aria-hidden="true" className="size-9 shrink-0 text-primary" />
            <span>
              <strong className="block font-display">{rate?.material}</strong>
              <span className="text-xs text-muted-foreground">{t('material')}</span>
            </span>
          </div>
        </div>
        <WeightPad
          onSubmit={(kg) => {
            setWeightKg(kg);
            setStep('photo');
          }}
        />
      </div>
    );
  }

  if (step === 'photo') {
    return (
      <div className="flex min-h-dvh flex-col px-5 py-5">
        <ScreenHeader title={t('weightPhotoTitle')} onBack={() => setStep('weight')} />
        <div className="rounded-2xl border border-border bg-card p-5 text-center">
          <p className="text-left font-display text-sm font-medium text-muted-foreground">
            {t('weightLabel')}
          </p>
          <p className="mt-1 font-mono text-6xl font-bold text-primary">
            {number.format(weightKg)} <span className="text-3xl text-foreground">kg</span>
          </p>
          <p className="mt-3 text-sm text-muted-foreground">{t('manualSource')}</p>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(event) => void onPhoto(event)}
        />
        <div className="mt-4 rounded-2xl border border-border bg-card p-3">
          <div className="flex items-center justify-between px-1 pb-3">
            <strong className="font-display text-lg">{t('scalePhoto')}</strong>
            <span className="text-xs text-muted-foreground">{t('photoGuidance')}</span>
          </div>
          {photoPreview ? (
            <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-muted">
              <Image
                src={photoPreview}
                alt={t('photoAlt')}
                fill
                unoptimized
                className="object-cover"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="flex aspect-[4/3] w-full flex-col items-center justify-center rounded-xl bg-muted text-muted-foreground"
            >
              <Camera aria-hidden="true" className="size-12" />
              <span className="mt-3 font-display text-sm">{t('photoEmpty')}</span>
            </button>
          )}
          <Button
            type="button"
            size="pwa"
            className="mt-3 bg-fill-bitcoin text-foreground hover:bg-fill-bitcoin-pressed"
            onClick={() => fileInput.current?.click()}
          >
            <Camera aria-hidden="true" />
            {photoPreview ? t('photoRetake') : t('photoTakeScale')}
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          {[t('guideWaste'), t('guideScale')].map((label) => (
            <div key={label} className="flex items-center gap-2 rounded-2xl bg-secondary p-3">
              <CircleCheck aria-hidden="true" className="size-7 shrink-0 text-primary" />
              <span className="font-display text-sm font-medium">{label}</span>
            </div>
          ))}
        </div>

        {geo && geo.kind === 'unavailable' ? (
          <div className="mt-4 space-y-2 rounded-2xl border border-border bg-card p-3">
            <p className="flex items-center gap-2 text-sm">
              <MapPinOff aria-hidden="true" className="size-4" /> {t('geoUnavailable')}
            </p>
            <Label htmlFor="geo-reason">{t('geoReasonLabel')}</Label>
            <Input
              id="geo-reason"
              value={geoReason}
              onChange={(event) => setGeoReason(event.target.value)}
              placeholder={t('geoReasonPlaceholder')}
            />
          </div>
        ) : null}

        {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
        <Button
          type="button"
          size="pwa"
          className="mt-5 h-16 text-lg"
          disabled={!photoSha256}
          onClick={() => setStep('review')}
        >
          {t('continue')} <ArrowRight aria-hidden="true" />
        </Button>
      </div>
    );
  }

  if (step === 'review' && collector && rate) {
    const rows = [
      [t('collector'), collector.alias, collector.publicCode ?? collector.id],
      [t('material'), rate.material, t('materialDescription')],
      [t('weightLabel'), `${number.format(weightKg)} kg`, t('manualSource')],
      [t('value'), `${rate.fiatCurrency} ${money.format(fiatValue)}`, t('equivalent')],
      [t('indicativePayout'), `≈ ${number.format(indicative)} sats`, t('estimated')],
      [t('location'), config.location, config.sessionId],
    ] as const;
    return (
      <div className="px-5 py-5">
        <header className="flex items-center justify-between gap-4">
          <Image src="/taka-sats-logo.png" alt="Taka Sats" width={166} height={50} priority />
          <OfflineBadge />
        </header>
        <h1 className="mt-5 font-display text-4xl font-bold tracking-[-0.045em]">
          {t('reviewTitle')}
        </h1>
        <p className="mt-1 text-lg text-muted-foreground">{t('reviewSubtitle')}</p>

        <dl className="mt-5 space-y-2">
          {rows.map(([label, value, detail]) => (
            <div
              key={label}
              className="flex items-center gap-4 rounded-2xl border border-border bg-card px-4 py-3"
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
                <Package aria-hidden="true" className="size-5" />
              </div>
              <div className="min-w-0">
                <dt className="text-sm text-muted-foreground">{label}</dt>
                <dd className="truncate font-display text-lg font-bold">{value}</dd>
                <span className="block truncate text-sm text-muted-foreground">{detail}</span>
              </div>
            </div>
          ))}
        </dl>

        {photoPreview ? (
          <div className="mt-2 rounded-2xl border border-border bg-card p-3">
            <p className="mb-2 text-sm text-muted-foreground">{t('photoEvidence')}</p>
            <div className="relative aspect-[16/6] overflow-hidden rounded-xl bg-muted">
              <Image
                src={photoPreview}
                alt={t('photoAlt')}
                fill
                unoptimized
                className="object-cover"
              />
            </div>
          </div>
        ) : null}

        <div className="mt-3 flex items-center gap-3 rounded-2xl bg-secondary px-4 py-3">
          <Clock3 aria-hidden="true" className="size-7 shrink-0 text-primary" />
          <span>
            <strong className="block font-display text-sm">{t('readyOffline')}</strong>
            <span className="text-sm text-muted-foreground">{t('uploadsAutomatically')}</span>
          </span>
        </div>

        {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
        <Button
          type="button"
          size="pwa"
          className="mt-4 h-16 text-lg"
          disabled={busy}
          onClick={() => void confirm()}
        >
          <Check aria-hidden="true" /> {busy ? t('saving') : t('confirmCollection')}
        </Button>
        <Button
          type="button"
          size="pwa"
          variant="outline"
          className="mt-2"
          onClick={() => setStep('photo')}
        >
          <Pencil aria-hidden="true" /> {t('editDetails')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <CircleCheck aria-hidden="true" className="size-20 text-primary" />
      <h1 className="mt-5 font-display text-3xl font-bold">{t('savedQueued')}</h1>
      <p className="mt-2 text-muted-foreground">{t('savedDescription')}</p>
      <Button type="button" size="pwa" className="mt-8" onClick={resetForNext}>
        {t('weighAnother')}
      </Button>
      <Button type="button" variant="ghost" className="mt-2" onClick={() => setStep('home')}>
        {t('backHome')}
      </Button>
    </div>
  );
}
