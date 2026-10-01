// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';

type Summary = {
  readonly events: number;
  readonly collectors: number;
  readonly kgByMaterial: readonly { readonly material: string; readonly kg: number }[];
  readonly satsPaid:
    number | { readonly bucket: { readonly min: number; readonly max: number } } | null;
  readonly ledger: { readonly entries: number };
};

function formatNumber(value: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat('en-KE', { maximumFractionDigits }).format(value);
}

export function ImpactStats() {
  const t = useTranslations('Home');
  const [summary, setSummary] = useState<Summary | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/v1/stats/summary', { signal: controller.signal })
      .then(async (response) => (response.ok ? ((await response.json()) as Summary) : null))
      .then(setSummary)
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const kilograms = useMemo(
    () => summary?.kgByMaterial.reduce((total, row) => total + row.kg, 0) ?? 0,
    [summary],
  );
  const sats = summary?.satsPaid;
  const satsLabel =
    typeof sats === 'number'
      ? formatNumber(sats)
      : sats && 'bucket' in sats
        ? `${formatNumber(sats.bucket.min)}+`
        : t('privateValue');
  const stats = [
    {
      value: summary ? formatNumber(kilograms, 1) : '—',
      unit: t('kgUnit'),
      label: t('statMaterial'),
    },
    {
      value: summary ? formatNumber(summary.collectors) : '—',
      unit: '',
      label: t('statCollectors'),
    },
    {
      value: summary ? satsLabel : '—',
      unit: typeof sats === 'number' || sats ? t('satsUnit') : '',
      label: t('statPayouts'),
    },
    {
      value: summary ? formatNumber(summary.ledger.entries) : '—',
      unit: '',
      label: t('statLedger'),
    },
  ] as const;

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-4">
      {stats.map((stat) => (
        <div key={stat.label} className="bg-card px-5 py-6 sm:px-7">
          <p className="font-mono text-2xl font-bold tabular-nums sm:text-3xl">
            {stat.value}
            {stat.unit ? <span className="ml-1 text-base text-primary">{stat.unit}</span> : null}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{stat.label}</p>
        </div>
      ))}
    </div>
  );
}
