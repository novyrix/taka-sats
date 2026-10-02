// SPDX-License-Identifier: AGPL-3.0-only

import { getTranslations } from 'next-intl/server';
import { getSettings } from '@/lib/config';

/**
 * Always says which payment rail this deployment runs on, so nobody mistakes a rehearsal for real
 * money or the other way round. Demo rail (`fake`): nothing is sent. Anything else: real sats.
 */
export async function ModeBanner() {
  const t = await getTranslations('Console.mode');
  const demo = getSettings().lightning.float_provider === 'fake';
  return (
    <p
      role="note"
      data-testid="mode-banner"
      data-demo={demo}
      className="border-b border-border bg-secondary px-4 py-1.5 text-center font-display text-xs font-medium uppercase tracking-[0.02em] text-secondary-foreground"
    >
      {demo ? t('demo') : t('live')}
    </p>
  );
}
