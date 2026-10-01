// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import { Cloud, WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export function OfflineBadge({ className }: { readonly className?: string }) {
  const t = useTranslations('Connectivity');
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const refresh = () => setOnline(navigator.onLine);
    refresh();
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    return () => {
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', refresh);
    };
  }, []);

  const Icon = online ? Cloud : WifiOff;
  return (
    <span
      className={cn(
        'inline-flex min-h-10 items-center gap-2 rounded-full px-3 py-2 font-display text-sm font-medium',
        online ? 'bg-secondary text-secondary-foreground' : 'bg-muted text-foreground',
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-4" />
      {online ? t('online') : t('offlineReady')}
    </span>
  );
}
