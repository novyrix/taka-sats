// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { isWebNfcAvailable, startTagScan } from '@/lib/nfc';
import { TapGlyph } from './TapGlyph';

export type ResolvedCollector = { id: string; alias: string };
type Summary = { id: string; alias: string; nfcTagId: string | null; status: string };

/**
 * Resolve a collector by NFC tap or by alias search (§7.1).
 * NFC is Chrome-Android only; the alias search is a first-class path, not a
 * degraded fallback (gate G2). Offline search against the cached list is
 * M3-2/M3-3 — this hits the API directly for now.
 */
export function CollectorLookup({
  onResolved,
}: {
  readonly onResolved: (collector: ResolvedCollector) => void;
}) {
  const t = useTranslations('Lookup');
  const [scanning, setScanning] = useState(false);
  const [tagMessage, setTagMessage] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Summary[]>([]);
  const [searching, setSearching] = useState(false);

  const resolveTag = useCallback(
    async (serial: string) => {
      setTagMessage(null);
      const res = await fetch(`/api/v1/tags/${encodeURIComponent(serial)}`);
      if (res.ok) {
        const { collector } = (await res.json()) as { collector: ResolvedCollector };
        onResolved(collector);
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
      setTagMessage(body?.error?.code === 'tag_revoked' ? t('tagRevoked') : t('tagUnknown'));
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
    const timer = setTimeout(async () => {
      setSearching(true);
      const res = await fetch(`/api/v1/collectors?q=${encodeURIComponent(q)}`);
      setSearching(false);
      if (res.ok) {
        const body = (await res.json()) as { collectors: Summary[] };
        setResults(body.collectors);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  // Derived, so stale matches never show while the box is cleared/too short.
  const visibleResults = query.trim().length >= 2 ? results : [];

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
        <Label htmlFor="collector-search">{t('searchLabel')}</Label>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id="collector-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="pl-9"
            autoComplete="off"
          />
        </div>
        {searching ? <p className="text-sm text-muted-foreground">{t('searching')}</p> : null}
        <ul className="divide-y divide-border">
          {visibleResults.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onResolved({ id: c.id, alias: c.alias })}
                className="flex w-full items-center justify-between py-3 text-left hover:bg-accent/40"
              >
                <span className="font-medium">{c.alias}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {c.nfcTagId ?? t('noTag')}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {query.trim().length >= 2 && !searching && visibleResults.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noMatches')}</p>
        ) : null}
      </div>
    </div>
  );
}
