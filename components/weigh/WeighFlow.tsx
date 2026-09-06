// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import { Camera, CircleCheck, MapPinOff, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { captureCollectionEvent, primeWeighCache, sha256HexBytes } from '@/lib/sync';
import type { CachedCollector, CachedSessionConfig, GeoFix } from '@/types/domain';
import { QUEUE_CHANGED_EVENT } from './SyncStatusIndicator';
import { WeighCollectorStep } from './WeighCollectorStep';
import { WeightPad } from './WeightPad';

type Step = 'loading' | 'blocked' | 'collector' | 'material' | 'weight' | 'review' | 'done';
type Rate = CachedSessionConfig['rates'][number];

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

export function WeighFlow({ supervisorId }: { readonly supervisorId: string }) {
  const t = useTranslations('Weigh');

  const [step, setStep] = useState<Step>('loading');
  const [config, setConfig] = useState<CachedSessionConfig | null>(null);
  const [blockedReason, setBlockedReason] = useState('');
  const [cacheSource, setCacheSource] = useState<'network' | 'cache' | null>(null);

  const [collector, setCollector] = useState<CachedCollector | null>(null);
  const [rate, setRate] = useState<Rate | null>(null);
  const [weightKg, setWeightKg] = useState(0);
  const [photoSha256, setPhotoSha256] = useState<string | null>(null);
  const [geo, setGeo] = useState<GeoFix | null>(null);
  const [geoReason, setGeoReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    void primeWeighCache().then((result) => {
      if (!live) {
        return;
      }
      if (result.config) {
        setConfig(result.config);
        setCacheSource(result.source);
        setStep('collector');
      } else {
        setBlockedReason(result.reason);
        setStep('blocked');
      }
    });
    return () => {
      live = false;
    };
  }, []);

  const resetForNext = useCallback(() => {
    setCollector(null);
    setRate(null);
    setWeightKg(0);
    setPhotoSha256(null);
    setGeo(null);
    setGeoReason('');
    setError(null);
    setStep('collector');
  }, []);

  async function onPhoto(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setError(null);
    // On-device hash of the exact bytes (D-12). Downscale/compress is M3-5.
    setPhotoSha256(await sha256HexBytes(await file.arrayBuffer()));
    if (!geo) {
      setGeo(await requestGeo());
    }
  }

  const indicative =
    rate && config
      ? Math.floor((rate.rateFiatMinor * weightKg * 1_000_000) / config.exchangeRate)
      : 0;

  async function confirm(): Promise<void> {
    if (!collector || !rate || !config || !photoSha256) {
      return;
    }
    const resolvedGeo: GeoFix =
      geo && geo.kind === 'fix'
        ? geo
        : { kind: 'unavailable', reason: geoReason.trim() || 'not-provided' };
    if (resolvedGeo.kind === 'unavailable' && !geoReason.trim()) {
      setError(t('geoReasonRequired'));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await captureCollectionEvent({
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
      });
      window.dispatchEvent(new Event(QUEUE_CHANGED_EVENT));
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (step === 'loading') {
    return <p className="text-sm text-muted-foreground">{t('loading')}</p>;
  }

  if (step === 'blocked') {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
        <p className="font-display text-sm font-bold tracking-[-0.02em]">{t('blockedTitle')}</p>
        <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">{blockedReason}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {cacheSource === 'cache' ? (
        <p className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
          {t('offlineCache')}
        </p>
      ) : null}

      {step === 'collector' && (
        <WeighCollectorStep
          onResolved={(c) => {
            setCollector(c);
            setStep('material');
          }}
        />
      )}

      {step === 'material' && config && (
        <div className="space-y-3">
          <p className="font-medium">{collector?.alias}</p>
          {config.rates.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noRates')}</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {config.rates.map((r) => (
                <Button
                  key={r.rateId}
                  type="button"
                  variant="outline"
                  className="h-16 flex-col gap-0.5"
                  onClick={() => {
                    setRate(r);
                    setStep('weight');
                  }}
                >
                  <span className="font-medium">{r.material}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {r.rateFiatMinor} {r.fiatCurrency}/kg
                  </span>
                </Button>
              ))}
            </div>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-[44px]"
            onClick={resetForNext}
          >
            {t('changeCollector')}
          </Button>
        </div>
      )}

      {step === 'weight' && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {collector?.alias} · {rate?.material}
          </p>
          <WeightPad
            onSubmit={(kg) => {
              setWeightKg(kg);
              setStep('review');
            }}
          />
        </div>
      )}

      {step === 'review' && collector && rate && (
        <div className="space-y-5">
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => void onPhoto(e)}
          />
          <Button
            type="button"
            size="pwa"
            variant={photoSha256 ? 'outline' : 'default'}
            onClick={() => fileInput.current?.click()}
          >
            <Camera className="size-5" aria-hidden="true" />
            {photoSha256 ? t('photoRetake') : t('photoTake')}
          </Button>
          {photoSha256 ? (
            <p className="font-mono text-xs text-muted-foreground break-all">
              sha256:{photoSha256.slice(0, 16)}…
            </p>
          ) : null}

          {geo && geo.kind === 'unavailable' ? (
            <div className="space-y-2 rounded-lg border border-border bg-card p-3">
              <p className="flex items-center gap-2 text-sm text-foreground">
                <MapPinOff aria-hidden="true" className="size-4 shrink-0" />
                {t('geoUnavailable')}
              </p>
              <Label htmlFor="geo-reason">{t('geoReasonLabel')}</Label>
              <Input
                id="geo-reason"
                value={geoReason}
                onChange={(e) => setGeoReason(e.target.value)}
                placeholder={t('geoReasonPlaceholder')}
              />
            </div>
          ) : null}

          <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
            <span className="font-medium">{collector.alias}</span> · {rate.material} ·{' '}
            <span className="font-mono">{weightKg.toFixed(3)} kg</span> ·{' '}
            <span className="font-mono text-muted-foreground">
              ≈ {indicative.toLocaleString()} sats
            </span>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <Button
            type="button"
            size="pwa"
            className="h-16"
            disabled={busy || !photoSha256}
            onClick={() => void confirm()}
          >
            {busy ? t('saving') : t('confirm')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-[44px]"
            onClick={() => setStep('weight')}
          >
            {t('back')}
          </Button>
        </div>
      )}

      {step === 'done' && (
        <div className="space-y-5 text-center">
          <CircleCheck aria-hidden="true" className="mx-auto size-14 text-primary" />
          <p className="font-display text-lg font-bold tracking-[-0.02em]">{t('savedQueued')}</p>
          <Button type="button" size="pwa" onClick={resetForNext}>
            {t('weighAnother')}
          </Button>
        </div>
      )}
    </div>
  );
}
