// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import { Delete } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * The weight keypad (DESIGN §11.1 step 3). Builds a
 * `NUMERIC(6,3)` string — up to 3 digits before the point, up to 3 after,
 * one point. BLE auto-fill lands later; manual entry is always available.
 */
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'] as const;

function apply(current: string, key: string): string {
  if (key === 'del') {
    return current.slice(0, -1);
  }
  if (key === '.') {
    return current.includes('.') ? current : current === '' ? '0.' : `${current}.`;
  }
  const [whole = '', frac] = current.split('.');
  if (frac === undefined) {
    if (whole.length >= 3) {
      return current;
    }
    // no leading zeros like "05"
    return whole === '0' ? key : `${whole}${key}`;
  }
  if (frac.length >= 3) {
    return current;
  }
  return `${whole}.${frac}${key}`;
}

export function WeightPad({ onSubmit }: { readonly onSubmit: (weightKg: number) => void }) {
  const t = useTranslations('Weigh');
  const [value, setValue] = useState('');

  const kg = Number.parseFloat(value || '0');
  const valid = Number.isFinite(kg) && kg > 0;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card px-4 py-6 text-center">
        <span className="font-mono text-4xl tabular-nums text-foreground">{value || '0'}</span>
        <span className="ml-2 font-mono text-lg text-muted-foreground">kg</span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((key) => (
          <Button
            key={key}
            type="button"
            variant="outline"
            className="h-14 text-lg"
            aria-label={key === 'del' ? t('deleteDigit') : key}
            onClick={() => setValue((v) => apply(v, key))}
          >
            {key === 'del' ? <Delete className="size-5" aria-hidden="true" /> : key}
          </Button>
        ))}
      </div>

      <Button
        type="button"
        size="pwa"
        disabled={!valid}
        onClick={() => onSubmit(Math.round(kg * 1000) / 1000)}
      >
        {t('weightNext')}
      </Button>
    </div>
  );
}
