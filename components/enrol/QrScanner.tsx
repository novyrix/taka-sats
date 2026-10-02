// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

/**
 * Full-bleed camera QR scan (DESIGN §11.2). Decodes with
 * `@zxing/browser`. `onResult` fires once with the raw decoded string; the
 * caller normalises/validates it server-side.
 *
 * TODO(perf): try the native `BarcodeDetector` first where available
 * (DESIGN §6.2), with zxing as the fallback.
 */
export function QrScanner({ onResult }: { readonly onResult: (raw: string) => void }) {
  const t = useTranslations('Enrol');
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let controls: IScannerControls | undefined;
    let cancelled = false;

    const reader = new BrowserQRCodeReader();
    reader
      .decodeFromVideoDevice(undefined, videoRef.current ?? undefined, (result) => {
        if (result && !cancelled) {
          onResult(result.getText());
        }
      })
      .then((c) => {
        if (cancelled) {
          c.stop();
        } else {
          controls = c;
        }
      })
      .catch(() => setError(t('cameraError')));

    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [onResult, t]);

  return (
    <div className="space-y-2">
      <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-foreground/90">
        <video ref={videoRef} className="size-full object-cover" muted playsInline />
        <div className="pointer-events-none absolute inset-8 rounded-lg border-2 border-primary-foreground/70" />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : (
        <p className="text-center text-sm text-muted-foreground">{t('scanHint')}</p>
      )}
    </div>
  );
}
