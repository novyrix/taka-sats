// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import { CircleCheck, OctagonX, ScanLine } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useCallback, useState } from 'react';
import { Drawer } from 'vaul';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { isWebNfcAvailable, writeTagAndReadSerial } from '@/lib/nfc';
import { QrScanner } from './QrScanner';

type Step = 'alias' | 'scanning' | 'validated' | 'rejected' | 'done';

type CollectorResponse = {
  collector: { id: string; lightningAddress: string | null; lnurlPayRaw: string | null };
};

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function EnrolFlow({ provisioningEnabled }: { readonly provisioningEnabled: boolean }) {
  const t = useTranslations('Enrol');
  const [step, setStep] = useState<Step>('alias');
  const [alias, setAlias] = useState('');
  const [collectorId, setCollectorId] = useState<string | null>(null);
  const [payTarget, setPayTarget] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [manualTagId, setManualTagId] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startScan = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    const res = await postJson('/api/v1/collectors', { alias: alias.trim() });
    setBusy(false);
    if (!res.ok) {
      setMessage(t('enrolFailed'));
      return;
    }
    const { collector } = (await res.json()) as CollectorResponse;
    setCollectorId(collector.id);
    setStep('scanning');
  }, [alias, t]);

  const submitCode = useCallback(
    async (raw: string) => {
      if (!collectorId || !raw.trim()) {
        return;
      }
      setBusy(true);
      setMessage(null);
      const res = await postJson(`/api/v1/collectors/${collectorId}/address`, {
        rawCode: raw.trim(),
      });
      setBusy(false);

      if (res.ok) {
        const { collector } = (await res.json()) as CollectorResponse;
        setPayTarget(collector.lnurlPayRaw ?? collector.lightningAddress);
        setStep('validated');
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
      setMessage(
        body?.error?.code === 'not_receive_capable' ? t('withdrawRejected') : t('addressInvalid'),
      );
      setStep('rejected');
    },
    [collectorId, t],
  );

  const registerTag = useCallback(
    async (tagId: string) => {
      if (!collectorId || !tagId.trim()) {
        return;
      }
      setBusy(true);
      setMessage(null);
      const res = await postJson(`/api/v1/collectors/${collectorId}/tags`, {
        newTagId: tagId.trim(),
      });
      setBusy(false);
      if (!res.ok) {
        setMessage(t('tagFailed'));
        return;
      }
      setStep('done');
    },
    [collectorId, t],
  );

  const writeViaNfc = useCallback(async () => {
    if (!payTarget) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const serial = await writeTagAndReadSerial(payTarget);
      await registerTag(serial);
    } catch {
      setBusy(false);
      setMessage(t('nfcFailed'));
    }
  }, [payTarget, registerTag, t]);

  const reset = useCallback(() => {
    setStep('alias');
    setAlias('');
    setCollectorId(null);
    setPayTarget(null);
    setManualCode('');
    setManualTagId('');
    setMessage(null);
  }, []);

  if (step === 'done') {
    return (
      <div className="space-y-6 text-center">
        <CircleCheck aria-hidden="true" className="mx-auto size-12 text-primary" />
        <p className="font-display text-lg font-medium">{t('doneTitle', { alias })}</p>
        <Button size="pwa" onClick={reset}>
          {t('enrolAnother')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <Label htmlFor="alias">{t('aliasLabel')}</Label>
        <Input
          id="alias"
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
          placeholder={t('aliasPlaceholder')}
          className="h-14 text-lg"
          autoComplete="off"
          disabled={step !== 'alias'}
        />
      </div>

      {(step === 'alias' || step === 'rejected') && (
        <div className="space-y-3">
          <Button
            size="pwa"
            onClick={step === 'alias' ? startScan : () => setStep('scanning')}
            disabled={busy || alias.trim().length === 0}
          >
            <ScanLine aria-hidden="true" />
            {t('scanButton')}
          </Button>
          {provisioningEnabled ? (
            <Button size="pwa" variant="outline" onClick={() => setMessage(t('provisioningTodo'))}>
              {t('issueWalletButton')}
            </Button>
          ) : null}
        </div>
      )}

      {step === 'rejected' ? (
        <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
          <OctagonX aria-hidden="true" className="size-4 shrink-0" />
          {message}
        </p>
      ) : null}

      {step === 'validated' && payTarget ? (
        <div className="space-y-4">
          <p className="flex items-center gap-2 font-display text-sm font-medium text-primary">
            <CircleCheck aria-hidden="true" className="size-5 shrink-0" />
            {t('receiveOnlyOk')}
          </p>
          <p className="break-all font-mono text-xs text-muted-foreground">{payTarget}</p>

          {isWebNfcAvailable() ? (
            <Button size="pwa" onClick={writeViaNfc} disabled={busy}>
              {t('writeTagButton')}
            </Button>
          ) : (
            <form
              className="space-y-2"
              onSubmit={(e: FormEvent<HTMLFormElement>) => {
                e.preventDefault();
                void registerTag(manualTagId);
              }}
            >
              <Label htmlFor="tagId">{t('manualTagLabel')}</Label>
              <Input
                id="tagId"
                value={manualTagId}
                onChange={(e) => setManualTagId(e.target.value)}
                placeholder={t('manualTagPlaceholder')}
              />
              <Button type="submit" size="pwa" disabled={busy || manualTagId.trim().length === 0}>
                {t('registerTagButton')}
              </Button>
            </form>
          )}
          <Button variant="ghost" onClick={() => setStep('done')}>
            {t('skipTag')}
          </Button>
        </div>
      ) : null}

      {message && step !== 'rejected' ? (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      ) : null}

      <Drawer.Root open={step === 'scanning'} onOpenChange={(open) => !open && setStep('alias')}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-40 bg-foreground/40" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 mt-24 flex max-h-[92vh] flex-col rounded-t-2xl bg-background p-4">
            <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-border" />
            <Drawer.Title className="mb-3 font-display text-base font-medium">
              {t('scanTitle')}
            </Drawer.Title>
            <div className="space-y-4 overflow-y-auto">
              <QrScanner onResult={(raw) => void submitCode(raw)} />
              <form
                className="space-y-2"
                onSubmit={(e: FormEvent<HTMLFormElement>) => {
                  e.preventDefault();
                  void submitCode(manualCode);
                }}
              >
                <Label htmlFor="manualCode">{t('manualCodeLabel')}</Label>
                <Input
                  id="manualCode"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  placeholder="lnurl1… / name@domain"
                />
                <Button
                  type="submit"
                  variant="outline"
                  size="pwa"
                  disabled={busy || manualCode.trim().length === 0}
                >
                  {t('useCodeButton')}
                </Button>
              </form>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </div>
  );
}
