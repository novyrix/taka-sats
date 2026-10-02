// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { useConsoleUser } from '@/components/console/context';
import { useApi } from '@/components/console/hooks';
import {
  DataState,
  ErrorNotice,
  PageHeader,
  Panel,
  TableWrap,
  Td,
  TextField,
  Th,
} from '@/components/console/kit';
import { Button } from '@/components/ui/button';
import { type ApiFail, api } from '@/lib/console/api';
import { formatDateTime, formatFiat } from '@/lib/console/format';

type Rate = {
  id: string;
  material: string;
  rateFiatMinor: number;
  fiatCurrency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
};

/**
 * Material rates (fiat per kg). A rate is never edited: setting a new one closes the old version,
 * and every collection is paid at the rate that was in force when it was recorded.
 */
export function Rates() {
  const t = useTranslations('Console.rates');
  const user = useConsoleUser();
  const current = useApi<{ rates: Rate[] }>('/rates');
  const history = useApi<{ rates: Rate[] }>('/rates/history');
  const [material, setMaterial] = useState('');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiFail | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setLocalError(null);
    setSaved(false);
    const major = Number(price);
    if (!material.trim() || !(major > 0)) {
      setLocalError(t('invalid'));
      return;
    }
    setBusy(true);
    const res = await api('/rates', {
      method: 'POST',
      body: { material: material.trim().toUpperCase(), rateFiatMinor: Math.round(major * 100) },
    });
    setBusy(false);
    if (res.ok) {
      setSaved(true);
      setMaterial('');
      setPrice('');
      current.reload();
      history.reload();
    } else {
      setError(res);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('intro')} />
      <Panel title={t('current')}>
        <DataState
          loading={current.loading}
          error={current.error}
          empty={(current.data?.rates.length ?? 0) === 0}
          emptyText={t('none')}
          onRetry={current.reload}
        >
          <TableWrap minWidth="32rem">
            <thead>
              <tr>
                <Th>{t('material')}</Th>
                <Th>{t('perKg')}</Th>
                <Th>{t('since')}</Th>
              </tr>
            </thead>
            <tbody>
              {current.data?.rates.map((r) => (
                <tr key={r.id} data-testid="rate-row">
                  <Td className="font-medium">{r.material}</Td>
                  <Td>{formatFiat(r.rateFiatMinor, r.fiatCurrency)}</Td>
                  <Td>{formatDateTime(r.effectiveFrom, user.timeZone)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </DataState>
      </Panel>

      <Panel title={t('setTitle')}>
        <p className="mb-3 text-sm text-muted-foreground">{t('setIntro')}</p>
        <form
          onSubmit={(e) => void submit(e)}
          className="grid max-w-xl grid-cols-1 gap-3 sm:grid-cols-2"
        >
          <TextField
            label={t('material')}
            value={material}
            onChange={(e) => setMaterial(e.target.value)}
            placeholder="PET"
          />
          <TextField
            label={t('priceLabel')}
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
          <div className="space-y-2 sm:col-span-2">
            {localError ? (
              <p role="alert" className="text-sm text-destructive">
                {localError}
              </p>
            ) : null}
            {error ? <ErrorNotice error={error} /> : null}
            {saved ? (
              <p role="status" className="text-sm font-medium">
                {t('saved')}
              </p>
            ) : null}
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? t('saving') : t('set')}
            </Button>
          </div>
        </form>
      </Panel>

      <Panel title={t('history')}>
        <DataState
          loading={history.loading}
          error={history.error}
          empty={(history.data?.rates.length ?? 0) === 0}
          emptyText={t('none')}
          onRetry={history.reload}
        >
          <TableWrap minWidth="40rem">
            <thead>
              <tr>
                <Th>{t('material')}</Th>
                <Th>{t('perKg')}</Th>
                <Th>{t('from')}</Th>
                <Th>{t('until')}</Th>
              </tr>
            </thead>
            <tbody>
              {history.data?.rates.map((r) => (
                <tr key={r.id}>
                  <Td>{r.material}</Td>
                  <Td>{formatFiat(r.rateFiatMinor, r.fiatCurrency)}</Td>
                  <Td>{formatDateTime(r.effectiveFrom, user.timeZone)}</Td>
                  <Td>
                    {r.effectiveTo ? formatDateTime(r.effectiveTo, user.timeZone) : t('open')}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </DataState>
      </Panel>
    </div>
  );
}
