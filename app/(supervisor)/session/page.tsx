// SPDX-License-Identifier: AGPL-3.0-only

import { getTranslations } from 'next-intl/server';
import { SignOutButton } from '@/components/auth/SignOutButton';
import { SessionSummary } from '@/components/weigh/SessionSummary';

/**
 * The session rollup + queue (DESIGN §11.3, ROADMAP M3-9). No `<SessionGate>`
 * — a supervisor can review what they've queued even after the session
 * window closes. All data is read from IndexedDB by the client component.
 */
export default async function SessionPage() {
  const t = await getTranslations('SessionSummary');

  return (
    <div className="space-y-6 px-5 py-6">
      <h1 className="font-display text-xl font-bold tracking-[-0.02em]">{t('title')}</h1>
      <SessionSummary />
      <div className="border-t border-border pt-4">
        <p className="mb-2 text-xs text-muted-foreground">{t('signOutNote')}</p>
        <SignOutButton className="min-h-11" />
      </div>
    </div>
  );
}
