// SPDX-License-Identifier: AGPL-3.0-only

import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { auth } from '@/auth';
import { CurrentSessionBadge } from '@/components/supervisor/session-context';

/**
 * Supervisor PWA shell (DESIGN §5.1 — thumb-first single column). Every route
 * under this group requires a signed-in staff session; no session → /login.
 */
export default async function SupervisorLayout({ children }: { readonly children: ReactNode }) {
  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="font-display text-sm font-bold tracking-[-0.02em]">Taka Sats</span>
        <span className="flex flex-col items-end gap-0.5">
          <span className="font-mono text-xs text-muted-foreground">{session.user.name}</span>
          <CurrentSessionBadge />
        </span>
      </header>
      <main className="flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
