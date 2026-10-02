// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { type Role, type Scope, roleHasScope } from '@/lib/auth/permissions';
import { cn } from '@/lib/utils';

/**
 * The operator console nav. Each entry names the scope it needs, so a hub lead only sees what
 * the API would let them use. Below the `md` breakpoint it collapses behind a Menu button
 * (a disclosure: aria-expanded + aria-controls), above it is a fixed left column.
 */
const ITEMS: readonly { key: string; href: string; scope: Scope | null }[] = [
  { key: 'overview', href: '/admin', scope: null },
  { key: 'collectors', href: '/collectors', scope: 'collector:authorize' },
  { key: 'payouts', href: '/payouts', scope: 'payout:read' },
  { key: 'events', href: '/events', scope: 'collector:read' },
  { key: 'treasury', href: '/treasury', scope: 'treasury:read' },
  { key: 'anomalies', href: '/anomalies', scope: 'anomaly:review' },
  { key: 'reconciliation', href: '/reconciliation', scope: 'report:generate:all' },
  { key: 'ledger', href: '/ledger', scope: 'ledger:read' },
  { key: 'sessions', href: '/sessions', scope: 'session:configure' },
  { key: 'rotations', href: '/rotations', scope: 'session:configure' },
  { key: 'staff', href: '/staff', scope: 'session:configure' },
];

export function AdminNav({ role }: { readonly role: Role }) {
  const t = useTranslations('Admin.nav');
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const items = ITEMS.filter((item) => item.scope === null || roleHasScope(role, item.scope));

  return (
    <div className="shrink-0 border-b border-border md:w-52 md:border-b-0 md:border-r">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="admin-nav-list"
        onClick={() => setOpen((v) => !v)}
        className="flex h-11 w-full items-center gap-2 px-4 font-display text-sm font-medium md:hidden"
      >
        {open ? (
          <X aria-hidden="true" className="size-4" />
        ) : (
          <Menu aria-hidden="true" className="size-4" />
        )}
        {t('menu')}
      </button>
      <nav
        aria-label={t('label')}
        className={cn('px-3 pb-4 md:block md:py-6', open ? 'block' : 'hidden')}
      >
        <ul id="admin-nav-list" className="space-y-1">
          {items.map((item) => {
            const active =
              item.href === '/admin'
                ? pathname === '/admin'
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setOpen(false)}
                  className={cn(
                    'block min-h-11 rounded-md px-3 py-2.5 font-display text-sm transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active
                      ? 'bg-accent font-bold text-accent-foreground'
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
    </div>
  );
}
