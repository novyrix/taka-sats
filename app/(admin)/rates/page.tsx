// SPDX-License-Identifier: AGPL-3.0-only

import { Rates } from '@/components/console/Rates';
import { requirePageScope } from '@/lib/auth/page-guard';

export default async function RatesPage() {
  await requirePageScope('session:configure');
  return <Rates />;
}
