// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import { Check, ChevronRight, QrCode, ScanLine, Search, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { Drawer } from 'vaul';
import { QrScanner } from '@/components/enrol/QrScanner';
import { Input } from '@/components/ui/input';
import { parseCollectorRef } from '@/lib/collectors/reference';
import { isWebNfcAvailable, startTagScan } from '@/lib/nfc';
import { getCachedCollectorByTag, listCachedCollectors, searchCachedCollectors } from '@/lib/sync';
import type { CachedCollector } from '@/types/domain';

export function WeighCollectorStep({
  onResolved,
}: {
  readonly onResolved: (collector: CachedCollector) => void;
}) {
  const t = useTranslations('Weigh');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CachedCollector[]>([]);
  const [selected, setSelected] = useState<CachedCollector | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const lookup = query.trim() ? searchCachedCollectors(query, 12) : listCachedCollectors(8);
    void lookup.then((rows) => {
      if (live) setResults(rows);
    });
    return () => {
      live = false;
    };
  }, [query]);

  const resolveReference = useCallback(
    async (raw: string) => {
      const code = parseCollectorRef(raw) ?? raw.trim();
      const rows = await searchCachedCollectors(code, 2);
      const exact = rows.find((row) => row.publicCode?.toLowerCase() === code.toLowerCase());
      const hit = exact ?? rows[0];
      if (hit) {
        setQrOpen(false);
        onResolved(hit);
      } else {
        setMessage(t('codeUnknownOffline'));
      }
    },
    [onResolved, t],
  );

  const scanNfc = useCallback(() => {
    const controller = new AbortController();
    setMessage(t('holdTag'));
    void startTagScan(async (serial) => {
      const hit = await getCachedCollectorByTag(serial);
      if (hit) onResolved(hit);
      else setMessage(t('tagUnknownOffline'));
      controller.abort();
    }, controller.signal).catch(() => setMessage(t('scanError')));
  }, [onResolved, t]);

  return (
    <div className="space-y-5">
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-4 top-1/2 size-6 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('searchNameCode')}
          className="h-16 rounded-2xl bg-card pl-14 text-lg"
          autoFocus
          autoComplete="off"
        />
      </div>

      <ul className="space-y-3">
        {results.map((collector) => {
          const active = selected?.id === collector.id;
          return (
            <li key={collector.id}>
              <button
                type="button"
                onClick={() => setSelected(collector)}
                className={`flex min-h-24 w-full items-center gap-4 rounded-2xl px-4 py-3 text-left ${
                  active ? 'bg-secondary' : 'border border-border bg-card'
                }`}
              >
                <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-background font-display text-xl font-bold text-primary">
                  {collector.alias.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate font-display text-xl">{collector.alias}</strong>
                  <span className="block truncate font-mono text-sm text-muted-foreground">
                    {collector.publicCode ?? collector.id}
                  </span>
                </span>
                {active ? (
                  <span className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check aria-hidden="true" className="size-5" />
                  </span>
                ) : (
                  <ChevronRight aria-hidden="true" className="size-6" />
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {query.trim() && results.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noMatches')}</p>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setQrOpen(true)}
          className="flex min-h-36 flex-col rounded-2xl border border-border bg-card p-4 text-left active:bg-accent"
        >
          <QrCode aria-hidden="true" className="size-9 text-primary" />
          <strong className="mt-auto font-display text-lg">{t('scanQr')}</strong>
          <span className="mt-1 text-sm text-muted-foreground">{t('scanQrHint')}</span>
        </button>
        <Link
          href="/enrol"
          className="flex min-h-36 flex-col rounded-2xl border border-border bg-card p-4 text-left active:bg-accent"
        >
          <UserPlus aria-hidden="true" className="size-9 text-primary" />
          <strong className="mt-auto font-display text-lg">{t('addCollector')}</strong>
          <span className="mt-1 text-sm text-muted-foreground">{t('addCollectorHint')}</span>
        </Link>
      </div>

      {isWebNfcAvailable() ? (
        <button
          type="button"
          onClick={scanNfc}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-sm text-muted-foreground active:bg-accent"
        >
          <ScanLine aria-hidden="true" className="size-5" /> {t('tapOptional')}
        </button>
      ) : null}

      {message ? <p className="text-center text-sm text-muted-foreground">{message}</p> : null}

      <button
        type="button"
        disabled={!selected}
        onClick={() => selected && onResolved(selected)}
        className="flex h-16 w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 font-display text-lg font-medium text-primary-foreground disabled:opacity-40"
      >
        {t('useSelected')} <ArrowRightIcon />
      </button>

      <Drawer.Root open={qrOpen} onOpenChange={setQrOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-40 bg-foreground/45" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-md rounded-t-3xl bg-background p-5">
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-border" />
            <Drawer.Title className="mb-4 font-display text-xl font-bold">
              {t('scanQr')}
            </Drawer.Title>
            <QrScanner onResult={(raw) => void resolveReference(raw)} />
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </div>
  );
}

function ArrowRightIcon() {
  return <ChevronRight aria-hidden="true" className="size-5" />;
}
