// SPDX-License-Identifier: AGPL-3.0-only

import { requirePageScope } from '@/lib/auth/page-guard';
import { Treasury } from '@/components/console/Treasury';

export default async function TreasuryPage() {
  await requirePageScope('treasury:read');
  return <Treasury />;
}
