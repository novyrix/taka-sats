// SPDX-License-Identifier: AGPL-3.0-only

import { SessionGate } from '@/components/supervisor/session-context';
import { WeighFlow } from '@/components/weigh/WeighFlow';
import { auth } from '@/auth';
import { getActor } from '@/lib/auth/session';

/**
 * The offline weigh flow (DESIGN §11.1). Behind `<SessionGate>`
 * (M2-7 — a plain supervisor needs an active assigned session); `<WeighFlow>`
 * primes the offline cache on mount, then never touches the network.
 */
export default async function WeighPage() {
  const session = await auth();
  const actor = await getActor();

  return (
    <SessionGate>
      {actor ? (
        <WeighFlow supervisorId={actor.id} supervisorName={session?.user?.name ?? undefined} />
      ) : null}
    </SessionGate>
  );
}
