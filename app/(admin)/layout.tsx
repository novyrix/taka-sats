// SPDX-License-Identifier: AGPL-3.0-only

import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { auth } from '@/auth';
import { AdminNav } from '@/components/admin/AdminNav';
import { SignOutButton } from '@/components/auth/SignOutButton';
import { ModeBanner } from '@/components/console/ModeBanner';
import { ConsoleProvider } from '@/components/console/context';
import { isRole } from '@/lib/auth/permissions';
import { getSettings } from '@/lib/config';

/**
 * Operator console shell. Every route under this group requires a signed-in `admin` or
 * `hub_lead` session; anyone else (no session, a `supervisor`, a `partner`) is bounced to
 * /login. The nav shows only what the signed-in role may use, and every page still reads its
 * data through `/api/v1`, so the API's scope checks are the real gate.
 */
export default async function AdminLayout({ children }: { readonly children: ReactNode }) {
  const session = await auth();
  const role = session?.user?.role;
  if (!role || !isRole(role) || (role !== 'admin' && role !== 'hub_lead')) {
    redirect('/login');
  }

  return (
    <ConsoleProvider
      user={{
        id: session?.user?.id ?? '',
        name: session?.user?.name ?? '',
        role,
        timeZone: getSettings().programme.timezone,
      }}
    >
      <div className="flex min-h-screen flex-col bg-background text-foreground md:flex-row">
        <AdminNav role={role} />
        <div className="flex min-w-0 flex-1 flex-col">
          <ModeBanner />
          <header className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2 md:px-6">
            <span className="font-display text-sm font-bold tracking-[-0.02em]">
              Taka Sats <span className="text-muted-foreground">Admin</span>
            </span>
            <span className="flex items-center gap-3">
              <span className="font-mono text-xs text-muted-foreground">
                {session?.user?.name} · {role}
              </span>
              <SignOutButton />
            </span>
          </header>
          <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-6 md:py-8">
            {children}
          </main>
        </div>
      </div>
    </ConsoleProvider>
  );
}
