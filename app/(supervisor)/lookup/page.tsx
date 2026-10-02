// SPDX-License-Identifier: AGPL-3.0-only

import { getTranslations } from 'next-intl/server';
import { CollectorLookupScreen } from '@/components/collectors/CollectorLookupScreen';

/** Find a collector by NFC tap or alias search. */
export default async function LookupPage() {
  const t = await getTranslations('Lookup');

  return (
    <div className="space-y-6">
      <h1 className="font-display text-xl font-bold tracking-[-0.02em]">{t('title')}</h1>
      <CollectorLookupScreen />
    </div>
  );
}
