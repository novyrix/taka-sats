// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import { CircleCheck, CircleHelp, OctagonX, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useConsoleUser } from '@/components/console/context';
import { useApi } from '@/components/console/hooks';
import { DataState, DomainPill, KeyValue, Mono, PageHeader, Panel } from '@/components/console/kit';
import { formatDateTime, formatKg, formatSats } from '@/lib/console/format';
import { sha256HexBytes } from '@/lib/sync/contentHash';

type Check = {
  key: string;
  status: 'pass' | 'fail' | 'warn' | 'unknown';
  detail: Record<string, string | number | boolean | null>;
};
type Detail = {
  id: string;
  seq: number;
  collector: { id: string; alias: string; publicCode: string };
  supervisor: { id: string; name: string } | null;
  session: { id: string; location: string; scheduledStart: string; scheduledEnd: string } | null;
  material: string;
  weightKg: number;
  weightSource: string;
  indicativeSats: number;
  recordedAt: string;
  syncedAt: string;
  registrationType: string;
  verificationLevel: string;
  geo:
    | { kind: 'fix'; lat?: number; lng?: number; accuracyM?: number }
    | { kind: 'unavailable'; reason?: string };
  photoSha256: string;
  photoPath: string;
  photoStored: boolean;
  rate: { id: string; fiatMinorPerKg: number };
  payout: { id: string; status: string; amountSats: number | null } | null;
  ledger: { seq: number; entryHash: string; payloadHash: string };
  flags: { id: string; type: string; status: string }[];
  checks: Check[];
};

const ICONS = {
  pass: CircleCheck,
  fail: OctagonX,
  warn: TriangleAlert,
  unknown: CircleHelp,
} as const;
const TONE = {
  pass: 'text-primary',
  fail: 'text-destructive',
  warn: 'text-foreground',
  unknown: 'text-muted-foreground',
} as const;

type Fingerprint = 'checking' | 'match' | 'mismatch' | 'missing' | 'error';

/** Re-hash the stored photo in the browser and compare it with the fingerprint that was signed. */
function usePhotoFingerprint(path: string | null, expected: string | null): Fingerprint {
  const [state, setState] = useState<{ key: string; result: Fingerprint } | null>(null);
  const key = `${path}|${expected}`;
  useEffect(() => {
    if (!path || !expected) {
      return;
    }
    let cancelled = false;
    void (async () => {
      let result: Fingerprint;
      try {
        const res = await fetch(path, {
          credentials: 'same-origin',
          signal: AbortSignal.timeout(20_000),
        });
        if (res.status === 404) {
          result = 'missing';
        } else if (!res.ok) {
          result = 'error';
        } else {
          const hash = await sha256HexBytes(await res.arrayBuffer());
          result = hash === expected ? 'match' : 'mismatch';
        }
      } catch {
        result = 'error';
      }
      if (!cancelled) {
        setState({ key, result });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, expected, key]);
  return state?.key === key ? state.result : 'checking';
}

/** The "how do we know" view of one collection event. */
export function EventDetail({ id }: { readonly id: string }) {
  const t = useTranslations('Console.events');
  const user = useConsoleUser();
  const { data, error, loading, reload } = useApi<{ event: Detail }>(`/events/${id}`);
  const event = data?.event ?? null;
  const fingerprint = usePhotoFingerprint(
    event?.photoStored ? event.photoPath : null,
    event?.photoSha256 ?? null,
  );
  const tz = user.timeZone;

  function message(check: Check): string {
    const d = check.detail;
    const params: Record<string, string | number> = {
      status: String(d.collectorStatus ?? d.status ?? ''),
      start: typeof d.start === 'string' ? formatDateTime(d.start, tz) : '',
      end: typeof d.end === 'string' ? formatDateTime(d.end, tz) : '',
      grace: Number(d.graceMinutes ?? 0),
      reason: String(d.reason ?? ''),
      count: Number(d.flagged ?? 0),
      open: Number(d.open ?? 0),
      seq: Number(d.seq ?? 0),
      rate: Number(d.rateFiatMinor ?? 0) / 100,
    };
    return t(`checks.${check.key}.${check.status}`, params);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('detailTitle')}
        description={t('detailIntro')}
        actions={
          <Link href="/events" className="text-sm underline">
            {t('backToList')}
          </Link>
        }
      />
      <DataState loading={loading} error={error} onRetry={reload}>
        {event ? (
          <>
            <Panel title={t('verification')}>
              <ul className="space-y-3" data-testid="checks">
                {event.checks.map((check) => {
                  const Icon = ICONS[check.status];
                  return (
                    <li
                      key={check.key}
                      className="flex gap-3"
                      data-testid={`check-${check.key}`}
                      data-status={check.status}
                    >
                      <Icon
                        role="img"
                        aria-label={t(`statusLabel.${check.status}`)}
                        className={`mt-0.5 size-5 shrink-0 ${TONE[check.status]}`}
                      />
                      <div className="min-w-0">
                        <p className="font-medium">{t(`checks.${check.key}.label`)}</p>
                        <p className="text-sm text-muted-foreground">{message(check)}</p>
                      </div>
                    </li>
                  );
                })}
                <li
                  className="flex gap-3"
                  data-testid="check-photo_fingerprint"
                  data-status={fingerprint}
                >
                  {fingerprint === 'match' ? (
                    <CircleCheck
                      role="img"
                      aria-label={t('statusLabel.pass')}
                      className="mt-0.5 size-5 shrink-0 text-primary"
                    />
                  ) : fingerprint === 'mismatch' ? (
                    <OctagonX
                      role="img"
                      aria-label={t('statusLabel.fail')}
                      className="mt-0.5 size-5 shrink-0 text-destructive"
                    />
                  ) : (
                    <CircleHelp
                      role="img"
                      aria-label={t('statusLabel.unknown')}
                      className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                    />
                  )}
                  <div>
                    <p className="font-medium">{t('fingerprint.label')}</p>
                    <p className="text-sm text-muted-foreground">
                      {t(`fingerprint.${event.photoStored ? fingerprint : 'missing'}`)}
                    </p>
                  </div>
                </li>
              </ul>
            </Panel>

            <Panel title={t('photo')}>
              {event.photoStored ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={event.photoPath}
                  alt={t('photoAlt', { material: event.material })}
                  className="max-h-96 rounded-lg border border-border"
                />
              ) : (
                <p className="text-sm text-muted-foreground">{t('photoMissing')}</p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">{t('photoGuide')}</p>
              <p className="mt-1">
                <Mono>{event.photoSha256}</Mono>
              </p>
            </Panel>

            <Panel title={t('record')}>
              <KeyValue
                items={[
                  {
                    k: t('col.collector'),
                    v: (
                      <Link href={`/collectors/${event.collector.id}`} className="underline">
                        {event.collector.alias} ({event.collector.publicCode})
                      </Link>
                    ),
                  },
                  { k: t('supervisor'), v: event.supervisor?.name ?? t('none') },
                  {
                    k: t('session'),
                    v: event.session
                      ? `${event.session.location}, ${formatDateTime(event.session.scheduledStart, tz)} to ${formatDateTime(event.session.scheduledEnd, tz)}`
                      : t('none'),
                  },
                  {
                    k: t('col.weight'),
                    v: `${event.material} ${formatKg(event.weightKg)} (${event.weightSource})`,
                  },
                  { k: t('rateUsed'), v: `${(event.rate.fiatMinorPerKg / 100).toFixed(2)} / kg` },
                  { k: t('indicative'), v: formatSats(event.indicativeSats) },
                  { k: t('recordedAt'), v: formatDateTime(event.recordedAt, tz) },
                  { k: t('syncedAt'), v: formatDateTime(event.syncedAt, tz) },
                  { k: t('registrationType'), v: event.registrationType },
                  { k: t('verificationLevel'), v: event.verificationLevel },
                  {
                    k: t('gps'),
                    v:
                      event.geo.kind === 'fix'
                        ? event.geo.lat !== undefined
                          ? `${event.geo.lat}, ${event.geo.lng} (${event.geo.accuracyM ?? '?'} m)`
                          : t('gpsFix')
                        : (event.geo.reason ?? t('gpsNone')),
                  },
                  {
                    k: t('col.payout'),
                    v: event.payout ? (
                      <span className="inline-flex flex-wrap items-center gap-2">
                        <DomainPill domain="payout" value={event.payout.status} />
                        <Link href={`/payouts/${event.payout.id}`} className="underline">
                          {t('openPayout')}
                        </Link>
                      </span>
                    ) : (
                      t('noPayout')
                    ),
                  },
                  {
                    k: t('ledgerEntry'),
                    v: (
                      <>
                        <span>#{event.ledger.seq} </span>
                        <Mono>{event.ledger.entryHash}</Mono>
                        <div className="mt-1 text-xs text-muted-foreground">{t('ledgerHint')}</div>
                      </>
                    ),
                  },
                ]}
              />
            </Panel>

            {event.flags.length > 0 ? (
              <Panel title={t('flagsTitle')}>
                <ul className="space-y-2 text-sm">
                  {event.flags.map((f) => (
                    <li key={f.id} className="flex flex-wrap items-center gap-2">
                      <DomainPill domain="anomaly" value={f.status} />
                      <span>{t(`flagTypes.${f.type}`)}</span>
                    </li>
                  ))}
                </ul>
                {user.can('anomaly:review') ? (
                  <p className="mt-3 text-sm">
                    <Link href="/anomalies" className="underline">
                      {t('reviewFlags')}
                    </Link>
                  </p>
                ) : null}
              </Panel>
            ) : null}
          </>
        ) : null}
      </DataState>
    </div>
  );
}
