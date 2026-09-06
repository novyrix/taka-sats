// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import { ClipboardList, Scale, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ComponentType, SVGProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * The supervisor PWA bottom tab bar (DESIGN §5.1 — "at most a 3–4 item bottom
 * tab bar"). Queue and Session tabs arrive with M3-9 / the sync UI.
 */
const TABS: { href: string; key: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }[] = [
  { href: '/weigh', key: 'weigh', Icon: Scale },
  { href: '/enrol', key: 'enrol', Icon: ClipboardList },
  { href: '/lookup', key: 'lookup', Icon: Search },
];

export function BottomNav() {
  const t = useTranslations('SupervisorNav');
  const pathname = usePathname();

  return (
    <nav className="sticky bottom-0 z-10 grid grid-cols-3 border-t border-border bg-background">
      {TABS.map(({ href, key, Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={key}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex flex-col items-center gap-1 py-2.5 font-display text-[11px] font-medium uppercase tracking-[0.02em]',
              active ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            <Icon aria-hidden="true" className="size-5" />
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}
