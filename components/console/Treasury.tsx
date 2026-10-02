// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { useConsoleUser } from '@/components/console/context';
import { useApi, useAutoRefresh, usePaged } from '@/components/console/hooks';
import {
  ActionButton,
  DataState,
  DomainPill,
  ErrorNotice,
  KeyValue,
  LoadMore,
  Mono,
  PageHeader,
  Panel,
  TextField,
} from '@/components/console/kit';
import { Button } from '@/components/ui/button';
import { type ApiFail, api } from '@/lib/console/api';
import { formatDateTime, formatSats } from '@/lib/console/format';

type Person = { id: string; name: string };
export type Topup = {
  id: string;
  status: string;
  amountSats: number;
  note: string | null;
  createdAt: string;
  approvalsRequired: number;
  proposedBy: Person;
  approvals: { by: Person; at: string }[];
  floatBaselineSats: number | null;
  transfer: { reference: string; by: Person; at: string } | null;
  outcome: { at: string; by: Person | null; reason: string | null } | null;
};
type TreasuryOverview = {
  hotWallet: {
    available: number | null;
    asOf: string | null;
    lowBalance: boolean | null;
    error: string | null;
  };
  cap: { sats: number | null; headroomSats: number | null };
  approvalsRequired: number;
  inFlightSats: number;
  pendingTopups: Topup[];
  pendingPayouts: { count: number; totalSats: number };
  pool: { configured: boolean; balanceSats: number | null };
};

/**
 * The treasury steward panel (admin only): hot wallet float and cap, the funding vote with its
 * separation of duties made visible (who proposed, who approved, how many are still needed),
 * and every step of a refill. Taka Sats only records the vote; the transfer itself is signed in
 * the pool's own wallet.
 */
export function Treasury() {
  const t = useTranslations('Console.treasury');
  const overview = useApi<TreasuryOverview>('/treasury');
  const list = usePaged<Topup>('/treasury/topups?limit=50', 'topups');
  const o = overview.data;

  function changed(): void {
    overview.reload();
    list.reload();
  }
  useAutoRefresh(changed);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('intro')}
        actions={
          <Link href="/ledger?type=treasury_topup" className="text-sm underline">
            {t('ledgerLink')}
          </Link>
        }
      />

      <DataState loading={overview.loading} error={overview.error} onRetry={overview.reload}>
        {o ? (
          <Panel title={t('state')}>
            <KeyValue
              items={[
                {
                  k: t('hotWallet'),
                  v: o.hotWallet.error ? (
                    <span className="text-destructive">{t('hotWalletUnreadable')}</span>
                  ) : (
                    <>
                      <span className="font-display text-lg font-bold" data-testid="hot-wallet">
                        {formatSats(o.hotWallet.available)}
                      </span>
                      {o.hotWallet.lowBalance ? (
                        <span className="ml-3 font-medium">{t('lowBalance')}</span>
                      ) : null}
                    </>
                  ),
                },
                {
                  k: t('cap'),
                  v:
                    o.cap.sats === null
                      ? t('noCap')
                      : t('capValue', {
                          cap: formatSats(o.cap.sats),
                          room: formatSats(o.cap.headroomSats),
                        }),
                },
                { k: t('inFlight'), v: formatSats(o.inFlightSats) },
                {
                  k: t('waiting'),
                  v: t('waitingValue', {
                    count: o.pendingPayouts.count,
                    sats: formatSats(o.pendingPayouts.totalSats),
                  }),
                },
                { k: t('quorum'), v: t('quorumValue', { n: o.approvalsRequired }) },
                {
                  k: t('pool'),
                  v: o.pool.configured ? formatSats(o.pool.balanceSats) : t('poolNotConfigured'),
                },
              ]}
            />
          </Panel>
        ) : null}
      </DataState>

      <ProposeForm onDone={changed} />

      <section aria-labelledby="proposals-h">
        <h2 id="proposals-h" className="mb-3 font-display text-base font-bold">
          {t('proposals')}
        </h2>
        <DataState
          loading={list.loading}
          error={list.error}
          empty={list.items.length === 0}
          emptyText={t('noProposals')}
          onRetry={list.reload}
        >
          <ul className="space-y-3">
            {list.items.map((topup) => (
              <li key={topup.id}>
                <TopupCard topup={topup} onChanged={changed} />
              </li>
            ))}
          </ul>
          <LoadMore
            hasMore={list.hasMore}
            busy={list.loadingMore}
            error={list.moreError}
            onMore={() => void list.loadMore()}
          />
        </DataState>
      </section>
    </div>
  );
}

function ProposeForm({ onDone }: { readonly onDone: () => void }) {
  const t = useTranslations('Console.treasury');
  const user = useConsoleUser();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiFail | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  if (!user.can('treasury:propose')) {
    return null;
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setLocalError(null);
    setError(null);
    const sats = Number(amount);
    if (!Number.isSafeInteger(sats) || sats <= 0) {
      setLocalError(t('amountInvalid'));
      return;
    }
    setBusy(true);
    const res = await api('/treasury/topups', {
      method: 'POST',
      body: { amountSats: sats, ...(note.trim() && { note: note.trim() }) },
    });
    setBusy(false);
    if (res.ok) {
      setAmount('');
      setNote('');
      onDone();
    } else {
      setError(res);
    }
  }

  return (
    <Panel title={t('proposeTitle')}>
      <p className="mb-3 text-sm text-muted-foreground">{t('proposeIntro')}</p>
      <form onSubmit={(e) => void submit(e)} className="max-w-lg space-y-3">
        <TextField
          label={t('amount')}
          hint={t('amountHint')}
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          autoComplete="off"
          data-testid="propose-amount"
        />
        <TextField
          label={t('noteLabel')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
        />
        {localError ? (
          <p role="alert" className="text-sm text-destructive">
            {localError}
          </p>
        ) : null}
        {error ? <ErrorNotice error={error} /> : null}
        <Button type="submit" size="sm" disabled={busy} data-testid="propose-submit">
          {busy ? t('working') : t('propose')}
        </Button>
      </form>
    </Panel>
  );
}

function TopupCard({
  topup,
  onChanged,
}: {
  readonly topup: Topup;
  readonly onChanged: () => void;
}) {
  const t = useTranslations('Console.treasury');
  const user = useConsoleUser();
  const tz = user.timeZone;
  const mine = topup.proposedBy.id === user.id;
  const iApproved = topup.approvals.some((a) => a.by.id === user.id);
  const open = topup.status === 'proposed' || topup.status === 'approved';
  const needed = Math.max(topup.approvalsRequired - topup.approvals.length, 0);

  return (
    <Panel className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-display text-lg font-bold" data-testid="topup-amount">
            {formatSats(topup.amountSats)}
          </span>
          <span className="ml-3 text-xs text-muted-foreground">
            {formatDateTime(topup.createdAt, tz)}
          </span>
        </div>
        <DomainPill domain="topup" value={topup.status} />
      </div>
      {topup.note ? <p className="text-sm">{topup.note}</p> : null}

      <KeyValue
        items={[
          {
            k: t('proposedBy'),
            v: (
              <>
                {topup.proposedBy.name}
                {mine ? <span className="ml-2 text-muted-foreground">{t('you')}</span> : null}
              </>
            ),
          },
          {
            k: t('approvals'),
            v:
              topup.approvals.length === 0
                ? t('approvalsNone', { n: topup.approvalsRequired })
                : t('approvalsSome', {
                    have: topup.approvals.length,
                    n: topup.approvalsRequired,
                    names: topup.approvals.map((a) => a.by.name).join(', '),
                  }),
          },
          ...(topup.transfer
            ? [
                {
                  k: t('transfer'),
                  v: (
                    <>
                      <Mono>{topup.transfer.reference}</Mono>
                      <span className="ml-2 text-muted-foreground">
                        {t('recordedBy', { name: topup.transfer.by.name })}
                      </span>
                    </>
                  ),
                },
              ]
            : []),
          ...(topup.outcome
            ? [
                {
                  k: t('outcome'),
                  v: (
                    <>
                      {formatDateTime(topup.outcome.at, tz)}
                      {topup.outcome.by ? ` (${topup.outcome.by.name})` : ` (${t('byWorker')})`}
                      {topup.outcome.reason ? ` - ${topup.outcome.reason}` : ''}
                    </>
                  ),
                },
              ]
            : []),
        ]}
      />

      {topup.status === 'proposed' ? (
        <p className="text-sm text-muted-foreground" data-testid="duty-note">
          {mine ? t('dutyProposer', { count: needed }) : t('dutyOther', { count: needed })}
        </p>
      ) : null}

      <div className="flex flex-wrap items-start gap-2">
        {topup.status === 'proposed' && !mine && user.can('treasury:approve') ? (
          <>
            <ActionButton
              label={iApproved ? t('approvedAlready') : t('approve')}
              testId="signoff"
              disabled={iApproved}
              run={() => api(`/treasury/topups/${topup.id}/signoff`, { method: 'POST' })}
              onDone={onChanged}
            />
          </>
        ) : null}
        {open && !mine && user.can('treasury:approve') ? (
          <ActionButton
            label={t('reject')}
            variant="outline"
            confirm={t('rejectConfirm')}
            run={() => api(`/treasury/topups/${topup.id}/reject`, { method: 'POST', body: {} })}
            onDone={onChanged}
          />
        ) : null}
        {open && mine ? (
          <ActionButton
            label={t('cancel')}
            variant="outline"
            confirm={t('cancelConfirm')}
            run={() => api(`/treasury/topups/${topup.id}/cancel`, { method: 'POST', body: {} })}
            onDone={onChanged}
          />
        ) : null}
        {topup.status === 'transferred' && user.can('treasury:approve') ? (
          <CheckArrival id={topup.id} onChanged={onChanged} />
        ) : null}
      </div>

      {topup.status === 'approved' && user.can('treasury:propose') ? (
        <RecordTransfer id={topup.id} onChanged={onChanged} />
      ) : null}
    </Panel>
  );
}

function RecordTransfer({
  id,
  onChanged,
}: {
  readonly id: string;
  readonly onChanged: () => void;
}) {
  const t = useTranslations('Console.treasury');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiFail | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await api(`/treasury/topups/${id}/transfer`, {
      method: 'POST',
      body: { reference: reference.trim() },
    });
    setBusy(false);
    if (res.ok) {
      onChanged();
    } else {
      setError(res);
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="max-w-lg space-y-3 border-t border-border pt-3"
    >
      <p className="text-sm">{t('signTransfer')}</p>
      <TextField
        label={t('reference')}
        hint={t('referenceHint')}
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        data-testid="transfer-reference"
      />
      {error ? <ErrorNotice error={error} /> : null}
      <Button
        type="submit"
        size="sm"
        disabled={busy || reference.trim().length === 0}
        data-testid="record-transfer"
      >
        {busy ? t('working') : t('recordTransfer')}
      </Button>
    </form>
  );
}

function CheckArrival({ id, onChanged }: { readonly id: string; readonly onChanged: () => void }) {
  const t = useTranslations('Console.treasury');
  const [note, setNote] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <ActionButton<{ arrived: boolean }>
        label={t('checkArrival')}
        testId="check-arrival"
        run={() => api(`/treasury/topups/${id}/confirm`, { method: 'POST' })}
        onDone={(data) => {
          setNote(data.arrived ? t('arrived') : t('notArrived'));
          onChanged();
        }}
      />
      {note ? (
        <span role="status" className="text-xs">
          {note}
        </span>
      ) : null}
    </span>
  );
}
