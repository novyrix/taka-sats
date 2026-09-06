// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { TapGlyph } from '@/components/collectors/TapGlyph';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { isWebNfcAvailable, startTagScan } from '@/lib/nfc';
import { getCachedCollectorByTag, searchCachedCollectors } from '@/lib/sync';
import type { CachedCollector } from '@/types/domain';

/**
 * Resolve a collector for the weigh flow **fully offline** (ROADMAP M3-3):
 * NFC tap and alias search both hit the IndexedDB cache, never the network.
 * Prime the cache with `primeWeighCache` before this mounts.
 */
export function WeighCollectorStep({
  onResolved,
}: {
  readonly onResolved: (collector: CachedCollector) => void;
}) {
  const t = useTranslations('Weigh');
  const [scanning, setScanning] = useState(false);
  const [tagMessage, setTagMessage] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CachedCollector[]>([]);

  const resolveTag = useCallback(
    async (serial: string) => {
      setTagMessage(null);
      const hit = await getCachedCollectorByTag(serial);
      if (hit) {
        onResolved(hit);
      } else {
        setTagMessage(t('tagUnknownOffline'));
      }
    },
    [onResolved, t],
  );

  const startScan = useCallback(() => {
    if (!isWebNfcAvailable()) {
      return;
    }
    const controller = new AbortController();
    setScanning(true);
    setTagMessage(t('holdTag'));
    startTagScan((serial) => void resolveTag(serial), controller.signal).catch(() => {
      setTagMessage(t('scanError'));
      setScanning(false);
    });
    return () => controller.abort();
  }, [resolveTag, t]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      return;
    }
    let live = true;
    void searchCachedCollectors(q).then((rows) => {
      if (live) {
        setResults(rows);
      }
    });
    return () => {
      live = false;
    };
  }, [query]);

  // Derived, so stale matches never show while the box is cleared/too short.
  const visible = query.trim().length >= 2 ? results : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-6 text-center">
        <TapGlyph className="size-16 text-primary" />
        {isWebNfcAvailable() ? (
          <Button size="pwa" variant="outline" onClick={startScan} disabled={scanning}>
            {scanning ? t('scanning') : t('tapButton')}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">{t('nfcUnavailable')}</p>
        )}
        {tagMessage ? (
          <p role="status" className="text-sm text-muted-foreground">
            {tagMessage}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="weigh-collector-search">{t('searchLabel')}</Label>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id="weigh-collector-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="pl-9"
            autoComplete="off"
          />
        </div>
        <ul className="divide-y divide-border">
          {visible.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onResolved(c)}
                className="flex min-h-[52px] w-full items-center justify-between px-1 py-3 text-left hover:bg-accent/40 active:bg-accent/60"
              >
                <span className="font-medium">{c.alias}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {c.nfcTagId ?? t('noTag')}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {query.trim().length >= 2 && visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noMatches')}</p>
        ) : null}
      </div>
    </div>
  );
}
