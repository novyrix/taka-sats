// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import { ClipboardList, ListChecks, Scale, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ComponentType, SVGProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * The supervisor PWA bottom tab bar (DESIGN §5.1 — "at most a 3–4 item bottom
 * tab bar": Weigh · Enrol · Lookup · Session).
 */
const TABS: { href: string; key: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }[] = [
  { href: '/weigh', key: 'weigh', Icon: Scale },
  { href: '/enrol', key: 'enrol', Icon: ClipboardList },
  { href: '/lookup', key: 'lookup', Icon: Search },
  { href: '/session', key: 'session', Icon: ListChecks },
];

export function BottomNav() {
  const t = useTranslations('SupervisorNav');
  const pathname = usePathname();

  return (
    <nav className="sticky bottom-0 z-10 grid grid-cols-4 border-t border-border bg-background">
      {TABS.map(({ href, key, Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={key}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              // ≥56px tall (M3-12 one-handed pass — comfortably in the thumb zone).
              'flex min-h-[56px] flex-col items-center justify-center gap-1 py-2 font-display text-[11px] font-medium uppercase tracking-[0.02em] active:bg-accent/40',
              active ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            <Icon aria-hidden="true" className="size-6" />
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}
