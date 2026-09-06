// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

/**
 * The admin left nav (DESIGN §5.2). Only the surfaces that exist are live;
 * the rest are listed (so the shape is visible) but disabled until their
 * milestone. Collapsible-to-icons and ⌘K are M6.
 */
const ITEMS = [
  { key: 'sessions', href: '/sessions', enabled: true },
  { key: 'collectors', href: '/collectors', enabled: false },
  { key: 'payouts', href: '/payouts', enabled: false },
  { key: 'treasury', href: '/treasury', enabled: false },
  { key: 'reconciliation', href: '/reconciliation', enabled: false },
  { key: 'anomalies', href: '/anomalies', enabled: false },
  { key: 'reports', href: '/reports', enabled: false },
  { key: 'apiKeys', href: '/api-keys', enabled: false },
  { key: 'settings', href: '/settings', enabled: false },
] as const;

export function AdminNav() {
  const t = useTranslations('Admin.nav');
  const pathname = usePathname();

  return (
    <nav className="w-52 shrink-0 border-r border-border px-3 py-6">
      <ul className="space-y-1">
        {ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          if (!item.enabled) {
            return (
              <li key={item.key}>
                <span className="block cursor-not-allowed rounded-md px-3 py-2 font-display text-sm text-muted-foreground/50">
                  {t(item.key)}
                </span>
              </li>
            );
          }
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'block rounded-md px-3 py-2 font-display text-sm transition-colors',
                  active
                    ? 'bg-accent text-accent-foreground'
                    : 'text-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                {t(item.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
