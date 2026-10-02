// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useConsoleUser } from '@/components/console/context';
import { useApi, usePaged } from '@/components/console/hooks';
import {
  DataState,
  ErrorNotice,
  KeyValue,
  LoadMore,
  Mono,
  PageHeader,
  Panel,
  Select,
  TableWrap,
  Td,
  Th,
} from '@/components/console/kit';
import { Button } from '@/components/ui/button';
import { type ApiFail, api } from '@/lib/console/api';
import { formatDateTime } from '@/lib/console/format';

type Entry = {
  id: string;
  seq: number;
  entryType: string;
  payloadHash: string;
  entryHash: string;
  createdAt: string;
};
type Checkpoint = {
  id: string;
  throughSeq: number;
  entryHash: string;
  signature: string;
  createdAt: string;
};
type Verify =
  | {
      ok: true;
      mode: string;
      count: number;
      throughSeq: number | null;
      headHash: string | null;
      checkpoints: { verified: number; signaturesChecked: boolean };
    }
  | { ok: false; mode: string; brokenAt: number; reason: string };

const TYPES = [
  'collection_event',
  'payout',
  'correction',
  'treasury_topup',
  'rate_change',
  'tag_revocation',
  'collector_authorization',
  'recycler_sale',
] as const;

/** The ledger: verify the chain, see the signed checkpoints and the public key, browse entries. */
export function Ledger() {
  const t = useTranslations('Console.ledger');
  const user = useConsoleUser();
  const params = useSearchParams();
  const initialType = params.get('type') ?? '';
  const [type, setType] = useState(TYPES.some((x) => x === initialType) ? initialType : '');
  const [mode, setMode] = useState<'full' | 'windowed'>('full');
  const [result, setResult] = useState<Verify | null>(null);
  const [verifyError, setVerifyError] = useState<ApiFail | null>(null);
  const [verifying, setVerifying] = useState(false);

  const checkpoints = useApi<{ checkpoints: Checkpoint[]; publicKey: string | null }>(
    '/ledger/checkpoints?limit=5',
  );
  const entries = usePaged<Entry>('/ledger?order=desc&limit=100', 'entries');
  const shown = type ? entries.items.filter((e) => e.entryType === type) : entries.items;

  async function verify(): Promise<void> {
    setVerifying(true);
    setVerifyError(null);
    const res = await api<Verify>(`/ledger/verify?mode=${mode}`);
    setVerifying(false);
    if (res.ok) {
      setResult(res.data);
    } else {
      setVerifyError(res);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('intro')} />

      <Panel title={t('verifyTitle')}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1.5">
            <span className="block font-display text-xs font-medium uppercase tracking-[0.02em] text-muted-foreground">
              {t('mode')}
            </span>
            <Select value={mode} onChange={(e) => setMode(e.target.value as 'full' | 'windowed')}>
              <option value="full">{t('modeFull')}</option>
              <option value="windowed">{t('modeWindowed')}</option>
            </Select>
          </label>
          <Button
            type="button"
            size="sm"
            disabled={verifying}
            onClick={() => void verify()}
            data-testid="verify-ledger"
          >
            {verifying ? t('verifying') : t('verify')}
          </Button>
        </div>
        {verifyError ? (
          <div className="mt-3">
            <ErrorNotice error={verifyError} />
          </div>
        ) : null}
        {result ? (
          <div className="mt-4" data-testid="verify-result" data-ok={result.ok}>
            {result.ok ? (
              <>
                <p className="font-medium">{t('verifyOk', { count: result.count })}</p>
                <KeyValue
                  items={[
                    { k: t('throughSeq'), v: result.throughSeq ?? t('none') },
                    { k: t('headHash'), v: <Mono>{result.headHash ?? t('none')}</Mono> },
                    {
                      k: t('signedCheckpoints'),
                      v: t('checkpointsVerified', { count: result.checkpoints.verified }),
                    },
                    {
                      k: t('signatures'),
                      v: result.checkpoints.signaturesChecked
                        ? t('signaturesChecked')
                        : t('signaturesNotChecked'),
                    },
                  ]}
                />
              </>
            ) : (
              <p role="alert" className="font-medium text-destructive">
                {t('verifyFail', { seq: result.brokenAt })}{' '}
                <span className="font-mono text-xs">{result.reason}</span>
              </p>
            )}
          </div>
        ) : null}
      </Panel>

      <Panel title={t('checkpoints')}>
        <DataState
          loading={checkpoints.loading}
          error={checkpoints.error}
          empty={(checkpoints.data?.checkpoints.length ?? 0) === 0}
          emptyText={t('noCheckpoints')}
          onRetry={checkpoints.reload}
        >
          <TableWrap minWidth="36rem">
            <thead>
              <tr>
                <Th>{t('throughSeq')}</Th>
                <Th>{t('entryHash')}</Th>
                <Th>{t('signedAt')}</Th>
              </tr>
            </thead>
            <tbody>
              {checkpoints.data?.checkpoints.map((c) => (
                <tr key={c.id}>
                  <Td>{c.throughSeq}</Td>
                  <Td>
                    <Mono>{c.entryHash}</Mono>
                  </Td>
                  <Td>{formatDateTime(c.createdAt, user.timeZone)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </DataState>
        <div className="mt-4">
          <p className="font-display text-xs font-medium uppercase tracking-[0.02em] text-muted-foreground">
            {t('publicKey')}
          </p>
          <p className="mt-1">
            {checkpoints.data?.publicKey ? <Mono>{checkpoints.data.publicKey}</Mono> : t('noKey')}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{t('publicKeyHint')}</p>
        </div>
      </Panel>

      <Panel title={t('outsiderTitle')}>
        <p className="text-sm">{t('outsiderIntro')}</p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs">
          {
            'pnpm exec tsx scripts/verify-ledger.ts --export ledger.json\npnpm exec tsx scripts/verify-ledger.ts ledger.json --public-key <base64 key above>'
          }
        </pre>
        <p className="mt-2 text-xs text-muted-foreground">{t('outsiderHint')}</p>
      </Panel>

      <section aria-labelledby="entries-h">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 id="entries-h" className="font-display text-base font-bold">
            {t('entries')}
          </h2>
          <label className="space-y-1.5">
            <span className="block font-display text-xs font-medium uppercase tracking-[0.02em] text-muted-foreground">
              {t('type')}
            </span>
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">{t('allTypes')}</option>
              {TYPES.map((x) => (
                <option key={x} value={x}>
                  {t(`types.${x}`)}
                </option>
              ))}
            </Select>
          </label>
        </div>
        <DataState
          loading={entries.loading}
          error={entries.error}
          empty={shown.length === 0 && !entries.hasMore}
          emptyText={t('noEntries')}
          onRetry={entries.reload}
        >
          <TableWrap minWidth="44rem">
            <thead>
              <tr>
                <Th>#</Th>
                <Th>{t('type')}</Th>
                <Th>{t('entryHash')}</Th>
                <Th>{t('when')}</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id}>
                  <Td>{e.seq}</Td>
                  <Td>{t.has(`types.${e.entryType}`) ? t(`types.${e.entryType}`) : e.entryType}</Td>
                  <Td>
                    <Mono>{e.entryHash}</Mono>
                  </Td>
                  <Td>{formatDateTime(e.createdAt, user.timeZone)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <LoadMore
            hasMore={entries.hasMore}
            busy={entries.loadingMore}
            error={entries.moreError}
            onMore={() => void entries.loadMore()}
          />
        </DataState>
      </section>
    </div>
  );
}
