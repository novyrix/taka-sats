// SPDX-License-Identifier: AGPL-3.0-only

import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { auth } from '@/auth';
import { AdminNav } from '@/components/admin/AdminNav';
import { isRole } from '@/lib/auth/permissions';

/**
 * Admin console shell (DESIGN §5.2 — "console app shell"). Every route under
 * this group requires a signed-in `admin` (or `hub_lead`) session; anyone
 * else — no session, a `supervisor`, or a `partner` — is bounced to /login.
 * The full sidebar/⌘K/12-col dashboard is M6; this is the frame + the
 * first surface (Sessions).
 */
export default async function AdminLayout({ children }: { readonly children: ReactNode }) {
  const session = await auth();
  const role = session?.user?.role;
  if (!role || !isRole(role) || (role !== 'admin' && role !== 'hub_lead')) {
    redirect('/login');
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <AdminNav />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-border px-6">
          <span className="font-display text-sm font-bold tracking-[-0.02em]">
            Taka Sats <span className="text-muted-foreground">Admin</span>
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            {session?.user?.name} · {role}
          </span>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
