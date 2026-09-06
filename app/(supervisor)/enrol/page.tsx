// SPDX-License-Identifier: AGPL-3.0-only

import { getTranslations } from 'next-intl/server';
import { EnrolFlow } from '@/components/enrol/EnrolFlow';
import { getSettings } from '@/lib/config';

/**
 * Enrol a collector (DESIGN §11.2, ROADMAP M1-5/M1-7). One alias field, then
 * "Scan their wallet QR" (BYO — the default) or, only when
 * `custody.provisioning_enabled`, "Issue a wallet".
 */
export default async function EnrolPage() {
  const t = await getTranslations('Enrol');
  const { provisioning_enabled: provisioningEnabled } = getSettings().custody;

  return (
    <div className="space-y-6">
      <h1 className="font-display text-xl font-bold tracking-[-0.02em]">{t('title')}</h1>
      <EnrolFlow provisioningEnabled={provisioningEnabled} />
    </div>
  );
}
