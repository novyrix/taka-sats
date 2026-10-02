// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { useConsoleUser } from '@/components/console/context';
import { useApi, usePaged } from '@/components/console/hooks';
import {
  ActionButton,
  DataState,
  ErrorNotice,
  LoadMore,
  PageHeader,
  Panel,
  TableWrap,
  Td,
  TextField,
  Th,
} from '@/components/console/kit';
import { Button } from '@/components/ui/button';
import { type ApiFail, api, query } from '@/lib/console/api';
import { formatDateTime, formatKg } from '@/lib/console/format';
import { sha256HexBytes } from '@/lib/sync/contentHash';

type Row = {
  material: string;
  collectedKg: number;
  paidKg: number;
  recyclerKg: number;
  varianceKg: number;
  variancePct: number | null;
  tolerancePct: number;
  status: 'within_tolerance' | 'flagged' | 'no_recycler_data';
};
type Report = Row & { id: string; periodStart: string; periodEnd: string; createdAt: string };
type Sale = {
  id: string;
  material: string;
  grossKg: number;
  tareKg: number;
  weightKg: number;
  buyer: string;
  soldAt: string;
  totalFiatMinor: number | null;
  receiptPath: string | null;
  ledgerSeq: number;
};

const toIso = (local: string): string => {
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
};
const localInput = (d: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * Reconciliation: kilograms collected against what the recycler accepted. Record each recycler
 * sale (with its receipt photo), run the mass balance for a period and keep the saved reports.
 */
export function Reconciliation() {
  const t = useTranslations('Console.reconciliation');
  const user = useConsoleUser();
  const [from, setFrom] = useState(() => localInput(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(() => localInput(new Date(Date.now() + 86_400_000)));
  const fromIso = toIso(from);
  const toIsoValue = toIso(to);
  const live = useApi<{ rows: Row[] }>(
    fromIso && toIsoValue ? `/reconciliation${query({ from: fromIso, to: toIsoValue })}` : null,
  );
  const reports = usePaged<Report>('/reconciliation/reports?limit=20', 'reports');
  const sales = usePaged<Sale>('/recycler-sales?limit=20', 'sales');

  function changed(): void {
    live.reload();
    reports.reload();
    sales.reload();
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('intro')} />

      <Panel title={t('massBalance')}>
        <div className="mb-4 grid max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField
            label={t('from')}
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <TextField
            label={t('to')}
            type="datetime-local"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <DataState
          loading={live.loading}
          error={live.error}
          empty={(live.data?.rows.length ?? 0) === 0}
          emptyText={t('noRows')}
          onRetry={live.reload}
        >
          <BalanceTable rows={live.data?.rows ?? []} />
          {user.can('reconciliation:write') ? (
            <div className="mt-4">
              <ActionButton
                label={t('saveReport')}
                testId="save-report"
                run={() =>
                  api('/reconciliation/runs', {
                    method: 'POST',
                    body: { from: fromIso, to: toIsoValue },
                  })
                }
                onDone={changed}
              />
              <p className="mt-1 text-xs text-muted-foreground">{t('saveHint')}</p>
            </div>
          ) : null}
        </DataState>
      </Panel>

      {user.can('reconciliation:write') ? <SaleForm onDone={changed} /> : null}

      <Panel title={t('sales')}>
        <DataState
          loading={sales.loading}
          error={sales.error}
          empty={sales.items.length === 0}
          emptyText={t('noSales')}
          onRetry={sales.reload}
        >
          <TableWrap minWidth="40rem">
            <thead>
              <tr>
                <Th>{t('soldAt')}</Th>
                <Th>{t('buyer')}</Th>
                <Th>{t('material')}</Th>
                <Th>{t('net')}</Th>
                <Th>{t('receipt')}</Th>
              </tr>
            </thead>
            <tbody>
              {sales.items.map((s) => (
                <tr key={s.id}>
                  <Td>{formatDateTime(s.soldAt, user.timeZone)}</Td>
                  <Td>{s.buyer}</Td>
                  <Td>{s.material}</Td>
                  <Td>{formatKg(s.weightKg)}</Td>
                  <Td>
                    {s.receiptPath ? (
                      <a
                        href={s.receiptPath}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        {t('viewReceipt')}
                      </a>
                    ) : (
                      t('noReceipt')
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <LoadMore
            hasMore={sales.hasMore}
            busy={sales.loadingMore}
            error={sales.moreError}
            onMore={() => void sales.loadMore()}
          />
        </DataState>
      </Panel>

      <Panel title={t('reports')}>
        <DataState
          loading={reports.loading}
          error={reports.error}
          empty={reports.items.length === 0}
          emptyText={t('noReports')}
          onRetry={reports.reload}
        >
          <TableWrap minWidth="48rem">
            <thead>
              <tr>
                <Th>{t('period')}</Th>
                <Th>{t('material')}</Th>
                <Th>{t('collected')}</Th>
                <Th>{t('recycler')}</Th>
                <Th>{t('variance')}</Th>
                <Th>{t('status')}</Th>
              </tr>
            </thead>
            <tbody>
              {reports.items.map((r) => (
                <tr key={r.id}>
                  <Td>
                    {formatDateTime(r.periodStart, user.timeZone)} /{' '}
                    {formatDateTime(r.periodEnd, user.timeZone)}
                  </Td>
                  <Td>{r.material}</Td>
                  <Td>{formatKg(r.collectedKg)}</Td>
                  <Td>{formatKg(r.recyclerKg)}</Td>
                  <Td>
                    {formatKg(r.varianceKg)}
                    {r.variancePct !== null ? ` (${r.variancePct}%)` : ''}
                  </Td>
                  <Td>{t(`rowStatus.${r.status}`)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <LoadMore
            hasMore={reports.hasMore}
            busy={reports.loadingMore}
            error={reports.moreError}
            onMore={() => void reports.loadMore()}
          />
        </DataState>
      </Panel>
    </div>
  );
}

function BalanceTable({ rows }: { readonly rows: readonly Row[] }) {
  const t = useTranslations('Console.reconciliation');
  return (
    <TableWrap minWidth="44rem">
      <thead>
        <tr>
          <Th>{t('material')}</Th>
          <Th>{t('collected')}</Th>
          <Th>{t('paid')}</Th>
          <Th>{t('recycler')}</Th>
          <Th>{t('variance')}</Th>
          <Th>{t('status')}</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.material} data-testid="balance-row">
            <Td>{r.material}</Td>
            <Td>{formatKg(r.collectedKg)}</Td>
            <Td>{formatKg(r.paidKg)}</Td>
            <Td>{formatKg(r.recyclerKg)}</Td>
            <Td>
              {formatKg(r.varianceKg)}
              {r.variancePct !== null
                ? ` (${r.variancePct}%, ${t('tolerance', { pct: r.tolerancePct })})`
                : ''}
            </Td>
            <Td className="font-medium">{t(`rowStatus.${r.status}`)}</Td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}

function SaleForm({ onDone }: { readonly onDone: () => void }) {
  const t = useTranslations('Console.reconciliation');
  const [material, setMaterial] = useState('');
  const [gross, setGross] = useState('');
  const [tare, setTare] = useState('');
  const [buyer, setBuyer] = useState('');
  const [soldAt, setSoldAt] = useState(() => localInput(new Date()));
  const [price, setPrice] = useState('');
  const [total, setTotal] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiFail | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setLocalError(null);
    setSaved(false);
    const grossKg = Number(gross);
    const tareKg = tare ? Number(tare) : 0;
    if (
      !material.trim() ||
      !buyer.trim() ||
      !(grossKg > 0) ||
      tareKg < 0 ||
      tareKg > grossKg ||
      !toIso(soldAt)
    ) {
      setLocalError(t('saleInvalid'));
      return;
    }
    setBusy(true);
    let receiptSha256: string | undefined;
    if (file) {
      const bytes = await file.arrayBuffer();
      receiptSha256 = await sha256HexBytes(bytes);
      let upload: Response;
      try {
        upload = await fetch('/api/v1/photos', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': file.type || 'image/jpeg', 'x-photo-sha256': receiptSha256 },
          body: bytes,
        });
      } catch {
        setBusy(false);
        setError({ ok: false, status: 0, code: 'network', message: 'Network error' });
        return;
      }
      if (!upload.ok) {
        setBusy(false);
        const body = (await upload.json().catch(() => ({}))) as { error?: { code?: string } };
        setError({
          ok: false,
          status: upload.status,
          code: body.error?.code ?? `http_${upload.status}`,
          message: '',
        });
        return;
      }
    }
    const res = await api('/recycler-sales', {
      method: 'POST',
      body: {
        material: material.trim().toUpperCase(),
        grossKg,
        ...(tareKg > 0 && { tareKg }),
        buyer: buyer.trim(),
        soldAt: toIso(soldAt),
        ...(price && { pricePerKgFiatMinor: Math.round(Number(price) * 100) }),
        ...(total && { totalFiatMinor: Math.round(Number(total) * 100) }),
        ...(receiptSha256 && { receiptSha256 }),
      },
    });
    setBusy(false);
    if (res.ok) {
      setSaved(true);
      setMaterial('');
      setGross('');
      setTare('');
      setBuyer('');
      setPrice('');
      setTotal('');
      setFile(null);
      onDone();
    } else {
      setError(res);
    }
  }

  return (
    <Panel title={t('recordSale')}>
      <p className="mb-3 text-sm text-muted-foreground">{t('recordSaleIntro')}</p>
      <form
        onSubmit={(e) => void submit(e)}
        className="grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2"
      >
        <TextField
          label={t('material')}
          value={material}
          onChange={(e) => setMaterial(e.target.value)}
          placeholder="PET"
        />
        <TextField label={t('buyer')} value={buyer} onChange={(e) => setBuyer(e.target.value)} />
        <TextField
          label={t('gross')}
          inputMode="decimal"
          value={gross}
          onChange={(e) => setGross(e.target.value)}
        />
        <TextField
          label={t('tare')}
          inputMode="decimal"
          value={tare}
          onChange={(e) => setTare(e.target.value)}
        />
        <TextField
          label={t('soldAt')}
          type="datetime-local"
          value={soldAt}
          onChange={(e) => setSoldAt(e.target.value)}
        />
        <TextField
          label={t('pricePerKg')}
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <TextField
          label={t('total')}
          hint={t('totalHint')}
          inputMode="decimal"
          value={total}
          onChange={(e) => setTotal(e.target.value)}
        />
        <div className="space-y-1.5">
          <label
            htmlFor="receipt-file"
            className="block font-display text-xs font-medium uppercase tracking-[0.02em] text-muted-foreground"
          >
            {t('receiptPhoto')}
          </label>
          <input
            id="receipt-file"
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm"
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          {localError ? (
            <p role="alert" className="text-sm text-destructive">
              {localError}
            </p>
          ) : null}
          {error ? <ErrorNotice error={error} /> : null}
          {saved ? (
            <p role="status" className="text-sm font-medium">
              {t('saleSaved')}
            </p>
          ) : null}
          <Button type="submit" size="sm" disabled={busy} data-testid="save-sale">
            {busy ? t('saving') : t('saveSale')}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
