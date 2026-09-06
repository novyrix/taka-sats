// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import { CircleUserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CollectorLookup, type ResolvedCollector } from './CollectorLookup';

/** Standalone "find a collector" screen (M1-8). The weigh flow reuses `<CollectorLookup>` at M3-3. */
export function CollectorLookupScreen() {
  const t = useTranslations('Lookup');
  const [collector, setCollector] = useState<ResolvedCollector | null>(null);

  if (collector) {
    return (
      <div className="space-y-6 text-center">
        <CircleUserRound aria-hidden="true" className="mx-auto size-12 text-primary" />
        <p className="font-display text-lg font-medium">{collector.alias}</p>
        <p className="font-mono text-xs text-muted-foreground">{collector.id}</p>
        <Button size="pwa" variant="outline" onClick={() => setCollector(null)}>
          {t('lookUpAnother')}
        </Button>
      </div>
    );
  }

  return <CollectorLookup onResolved={setCollector} />;
}
