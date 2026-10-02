// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import QRCode from 'qrcode';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * The collector's credential as a QR code: it carries `takasats:<publicCode>` (identity only,
 * never a payment target), which the supervisor's scan-to-find screen reads. Printable.
 */
export function CredentialQr({
  payload,
  publicCode,
  alias,
}: {
  readonly payload: string;
  readonly publicCode: string;
  readonly alias: string;
}) {
  const t = useTranslations('Console.collectors');
  const [svg, setSvg] = useState<{ payload: string; markup: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void QRCode.toString(payload, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' }).then(
      (markup) => {
        if (!cancelled) {
          setSvg({ payload, markup });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [payload]);

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div
        role="img"
        aria-label={t('qrAlt', { code: publicCode })}
        className="size-40 rounded-lg border border-border bg-white p-1 [&_svg]:size-full"
        data-testid="credential-qr"
        // The markup is generated locally from our own payload by the qrcode library.
        dangerouslySetInnerHTML={{ __html: svg?.payload === payload ? svg.markup : '' }}
      />
      <div className="space-y-2">
        <p className="font-mono text-xl font-bold">{publicCode}</p>
        <p className="text-sm">{alias}</p>
        <p className="max-w-xs text-xs text-muted-foreground">{t('qrHint')}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
          {t('print')}
        </Button>
      </div>
    </div>
  );
}
