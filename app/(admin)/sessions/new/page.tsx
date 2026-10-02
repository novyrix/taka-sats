// SPDX-License-Identifier: AGPL-3.0-only

import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { NewSessionForm } from '@/components/admin/NewSessionForm';
import { getDb } from '@/lib/db/client';
import { listPartners } from '@/lib/partners';
import { listSupervisors } from '@/lib/supervisors';

/**
 * The admin "New Session" one-flow (DESIGN §5.2, FR-8.1): one
 * page — location, window, assigned supervisors, optional geo scope, optional
 * sponsoring partner — that leaves a session ready for its window. The staff
 * roster and partner list are loaded server-side and passed to the form.
 */
export default async function NewSessionPage() {
  const t = await getTranslations('Admin.newSession');
  const db = getDb();
  const [supervisors, partners] = await Promise.all([
    listSupervisors(db, { roles: ['supervisor', 'hub_lead'] }),
    listPartners(db),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <Link href="/sessions" className="text-xs text-muted-foreground hover:underline">
          ← {t('back')}
        </Link>
        <h1 className="font-display text-xl font-bold tracking-[-0.02em]">{t('title')}</h1>
      </div>
      <NewSessionForm supervisors={supervisors} partners={partners} />
    </div>
  );
}
