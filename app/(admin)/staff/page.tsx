// SPDX-License-Identifier: AGPL-3.0-only

import { requirePageScope } from '@/lib/auth/page-guard';
import { Staff } from '@/components/console/Staff';

export default async function StaffPage() {
  await requirePageScope('session:configure');
  return <Staff />;
}
