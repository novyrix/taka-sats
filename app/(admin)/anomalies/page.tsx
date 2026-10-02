// SPDX-License-Identifier: AGPL-3.0-only

import { requirePageScope } from '@/lib/auth/page-guard';
import { Anomalies } from '@/components/console/Anomalies';

export default async function AnomaliesPage() {
  await requirePageScope('anomaly:review');
  return <Anomalies />;
}
