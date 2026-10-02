// SPDX-License-Identifier: AGPL-3.0-only

import { Suspense } from 'react';
import { Payouts } from '@/components/console/Payouts';

export default function PayoutsPage() {
  return (
    <Suspense fallback={null}>
      <Payouts />
    </Suspense>
  );
}
