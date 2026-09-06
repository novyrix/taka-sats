// SPDX-License-Identifier: AGPL-3.0-only

import { getTranslations } from 'next-intl/server';
import { SessionGate } from '@/components/supervisor/session-context';
import { WeighFlow } from '@/components/weigh/WeighFlow';
import { getActor } from '@/lib/auth/session';

/**
 * The offline weigh flow (DESIGN §11.1, ROADMAP M3-4). Behind `<SessionGate>`
 * (M2-7 — a plain supervisor needs an active assigned session); `<WeighFlow>`
 * primes the offline cache on mount, then never touches the network.
 */
export default async function WeighPage() {
  const t = await getTranslations('Weigh');
  const actor = await getActor();

  return (
    <div className="space-y-6">
      <h1 className="font-display text-xl font-bold tracking-[-0.02em]">{t('title')}</h1>
      <SessionGate>
        {actor ? (
          <WeighFlow supervisorId={actor.id} />
        ) : (
          <p className="text-sm text-muted-foreground">{t('loading')}</p>
        )}
      </SessionGate>
    </div>
  );
}
