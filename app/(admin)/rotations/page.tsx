// SPDX-License-Identifier: AGPL-3.0-only

import { getTranslations } from 'next-intl/server';
import { RotationsManager } from '@/components/admin/RotationsManager';
import { getDb } from '@/lib/db/client';
import { listRotations } from '@/lib/rotations';
import { listSupervisors } from '@/lib/supervisors';

/**
 * Supervisor rotations (ROADMAP M2-8, FR-3.7, FR-6.1). A rotation rosters a
 * supervisor to a location for a window; a new session whose location + window
 * overlaps one auto-assigns the rostered supervisor (`createSession`).
 */
export default async function RotationsPage() {
  const t = await getTranslations('Admin.rotations');
  const db = getDb();
  const [rotations, supervisors] = await Promise.all([
    listRotations(db),
    listSupervisors(db, { roles: ['supervisor', 'hub_lead'] }),
  ]);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-display text-xl font-bold tracking-[-0.02em]">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </div>
      <RotationsManager rotations={rotations} supervisors={supervisors} />
    </div>
  );
}
