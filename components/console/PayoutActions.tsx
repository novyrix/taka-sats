// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { useConsoleUser } from '@/components/console/context';
import { ActionButton, ErrorNotice, KeyValue, Panel, TextField } from '@/components/console/kit';
import { Button } from '@/components/ui/button';
import { type ApiFail, api } from '@/lib/console/api';
import { formatSats } from '@/lib/console/format';

export type PayoutRow = {
  id: string;
  status: string;
  amountSats: number | null;
  amountFiatMinor: number | null;
  fiatCurrency: string;
  collectionEventId: string;
  collectorId: string;
  collectorAlias: string;
  collectorPublicCode: string;
  provider: string | null;
  providerPaymentRef: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  lastError: string | null;
  attempts: number;
  createdAt: string;
  settledAt: string | null;
  openFlags: number;
};

/** Approve and retry: the two one-click payout actions (the API enforces the second person). */
export function PayoutActions({
  payout,
  onChanged,
}: {
  readonly payout: Pick<PayoutRow, 'id' | 'status'> &
    Partial<Pick<PayoutRow, 'amountSats' | 'collectorAlias'>>;
  readonly onChanged: () => void;
}) {
  const t = useTranslations('Console.payouts');
  const user = useConsoleUser();
  if (!user.can('payout:approve')) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {payout.status === 'pending_approval' ? (
        <ActionButton
          label={t('approve')}
          testId="approve-payout"
          confirm={t('approveConfirm', {
            name: payout.collectorAlias ?? '',
            sats:
              payout.amountSats === null || payout.amountSats === undefined
                ? ''
                : formatSats(payout.amountSats),
          })}
          run={() => api(`/payouts/${payout.id}/approve`, { method: 'POST' })}
          onDone={onChanged}
        />
      ) : null}
      {payout.status === 'failed' ? (
        <ActionButton
          label={t('retry')}
          variant="outline"
          confirm={t('retryConfirm')}
          run={() => api(`/payouts/${payout.id}/retry`, { method: 'POST' })}
          onDone={onChanged}
        />
      ) : null}
    </div>
  );
}

type Check = {
  supported: boolean;
  reason?: string;
  state?: string;
  paymentRef?: string | null;
  proofVerified?: boolean | null;
  feeSats?: number | null;
  matches?: number | null;
};

/**
 * The stuck-payout tools (admin): ask the provider what it recorded, then mark paid (with the
 * provider's payment reference) or failed (nothing was sent). Resolving is a person's decision,
 * from the provider's own records; the server refuses the recorder and the approver.
 */
export function StuckPayoutTools({
  payout,
  onChanged,
}: {
  readonly payout: Pick<PayoutRow, 'id' | 'status' | 'lastError' | 'providerPaymentRef'>;
  readonly onChanged: () => void;
}) {
  const t = useTranslations('Console.payouts');
  const user = useConsoleUser();
  const [check, setCheck] = useState<Check | null>(null);
  const [checkError, setCheckError] = useState<ApiFail | null>(null);
  const [checking, setChecking] = useState(false);
  const [reference, setReference] = useState(payout.providerPaymentRef ?? '');
  const [note, setNote] = useState('');
  const [resolveError, setResolveError] = useState<ApiFail | null>(null);
  const [busy, setBusy] = useState<'paid' | 'failed' | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!user.can('payout:resolve') || payout.status !== 'sending') {
    return null;
  }

  async function runCheck(): Promise<void> {
    setChecking(true);
    setCheckError(null);
    const res = await api<{ check: Check }>(`/payouts/${payout.id}/check`);
    setChecking(false);
    if (res.ok) {
      setCheck(res.data.check);
      if (res.data.check.paymentRef && !reference) {
        setReference(res.data.check.paymentRef);
      }
    } else {
      setCheckError(res);
    }
  }

  async function resolve(outcome: 'paid' | 'failed', event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(outcome);
    setResolveError(null);
    const res = await api<{ providerState: string }>(`/payouts/${payout.id}/resolve`, {
      method: 'POST',
      body: {
        outcome,
        ...(outcome === 'paid' && reference.trim() && { reference: reference.trim() }),
        ...(note.trim() && { note: note.trim() }),
      },
    });
    setBusy(null);
    if (res.ok) {
      setDone(outcome);
      onChanged();
    } else {
      setResolveError(res);
    }
  }

  return (
    <Panel title={t('stuckTitle')}>
      <p className="mb-3 text-sm text-muted-foreground">{t('stuckIntro')}</p>
      <div className="mb-4">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={checking}
          onClick={() => void runCheck()}
        >
          {checking ? t('checking') : t('checkProvider')}
        </Button>
      </div>
      {checkError ? <ErrorNotice error={checkError} /> : null}
      {check ? (
        <div className="mb-4" data-testid="check-result">
          {check.supported ? (
            <KeyValue
              items={[
                { k: t('providerState'), v: t(`checkState.${check.state ?? 'not_found'}`) },
                {
                  k: t('paymentRef'),
                  v: (
                    <span className="font-mono text-xs break-all">
                      {check.paymentRef ?? t('none')}
                    </span>
                  ),
                },
                {
                  k: t('proof'),
                  v:
                    check.proofVerified === null || check.proofVerified === undefined
                      ? t('none')
                      : check.proofVerified
                        ? t('proofYes')
                        : t('proofNo'),
                },
                {
                  k: t('fee'),
                  v:
                    check.feeSats === null || check.feeSats === undefined
                      ? t('none')
                      : `${check.feeSats} sats`,
                },
                { k: t('matches'), v: check.matches ?? t('none') },
              ]}
            />
          ) : (
            <p className="text-sm">{t('checkUnsupported')}</p>
          )}
          {check.state === 'not_found' ? (
            <p className="mt-2 text-sm font-medium">{t('notFoundWarning')}</p>
          ) : null}
        </div>
      ) : null}

      {done ? (
        <p role="status" className="text-sm font-medium">
          {done === 'paid' ? t('resolvedPaid') : t('resolvedFailed')}
        </p>
      ) : (
        <form className="max-w-lg space-y-3">
          <TextField
            label={t('reference')}
            hint={t('referenceHint')}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <TextField
            label={t('note')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy !== null || reference.trim().length === 0}
              onClick={(e) => void resolve('paid', e)}
              data-testid="mark-paid"
            >
              {busy === 'paid' ? t('working') : t('markPaid')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={(e) => void resolve('failed', e)}
              data-testid="mark-failed"
            >
              {busy === 'failed' ? t('working') : t('markFailed')}
            </Button>
          </div>
          {resolveError ? <ErrorNotice error={resolveError} /> : null}
        </form>
      )}
    </Panel>
  );
}
