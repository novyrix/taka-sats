// SPDX-License-Identifier: AGPL-3.0-only

import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { auth } from '@/auth';
import { ModeBanner } from '@/components/console/ModeBanner';
import { BottomNav } from '@/components/supervisor/BottomNav';
import { SyncManager } from '@/components/supervisor/SyncManager';

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
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-background shadow-[0_0_50px_rgb(20_20_20/0.08)]">
      <ModeBanner />
      <SyncManager />
      <main className="flex-1">{children}</main>
      <BottomNav />
    </div>
  );
}
