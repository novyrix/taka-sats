// SPDX-License-Identifier: AGPL-3.0-only

import { getTranslations } from 'next-intl/server';
import { cache, type ReactNode } from 'react';
import { getActor } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { currentSessionForSupervisor, type SessionWithSupervisors } from '@/lib/sessions';

/**
 * M2-7 (FR-6.1, US-6.1) on the PWA. A plain `supervisor` may only act
 * (enrol, weigh) while they have a session that is assigned to them, `active`,
 * and open right now. `hub_lead`/`admin` are not shift-bound and always pass.
 *
 * `resolveCurrentSession` is `cache`d so the layout badge and the page gate
 * share one query per render.
 */
const resolveCurrentSession = cache(async (): Promise<SessionWithSupervisors | null> => {
  const actor = await getActor();
  if (actor?.role !== 'supervisor') {
    return null;
  }
  return currentSessionForSupervisor(getDb(), actor.id);
});

/** Renders `children` only when the actor may act now; otherwise a clear panel. */
export async function SessionGate({ children }: { readonly children: ReactNode }) {
  const actor = await getActor();
  if (actor?.role !== 'supervisor') {
    return <>{children}</>;
  }
  const session = await resolveCurrentSession();
  if (session) {
    return <>{children}</>;
  }

  const t = await getTranslations('Session');
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
      <p className="font-display text-sm font-bold tracking-[-0.02em]">{t('noActiveSession')}</p>
      <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">
        {t('noActiveSessionHint')}
      </p>
    </div>
  );
}

/** The header chip: the supervisor's current session, or "No active session". */
export async function CurrentSessionBadge() {
  const actor = await getActor();
  if (actor?.role !== 'supervisor') {
    return null;
  }
  const session = await resolveCurrentSession();
  const t = await getTranslations('Session');
  return (
    <span className="font-mono text-xs text-muted-foreground">
      {session ? `${session.location} · ${t('active')}` : t('none')}
    </span>
  );
}
