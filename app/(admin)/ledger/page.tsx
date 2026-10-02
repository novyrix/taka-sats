// SPDX-License-Identifier: AGPL-3.0-only

import { Suspense } from 'react';
import { requirePageScope } from '@/lib/auth/page-guard';
import { Ledger } from '@/components/console/Ledger';

export default async function LedgerPage() {
  await requirePageScope('ledger:read');
  return (
    <Suspense fallback={null}>
      <Ledger />
    </Suspense>
  );
}
