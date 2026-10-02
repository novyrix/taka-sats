// SPDX-License-Identifier: AGPL-3.0-only

import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { isRole, roleHasScope, type Scope } from '@/lib/auth/permissions';

/**
 * For server-rendered console pages: send a signed-in person who lacks `scope` back to the
 * overview (and an anonymous one to /login). The API still enforces every scope on its own;
 * this only avoids showing a screen that could never load.
 */
export async function requirePageScope(scope: Scope): Promise<void> {
  const session = await auth();
  const role = session?.user?.role;
  if (!role || !isRole(role)) {
    redirect('/login');
  }
  if (!roleHasScope(role, scope)) {
    redirect('/admin');
  }
}
