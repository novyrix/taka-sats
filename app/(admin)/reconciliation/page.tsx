// SPDX-License-Identifier: AGPL-3.0-only

import { requirePageScope } from '@/lib/auth/page-guard';
import { Reconciliation } from '@/components/console/Reconciliation';

export default async function ReconciliationPage() {
  await requirePageScope('report:generate:all');
  return <Reconciliation />;
}
