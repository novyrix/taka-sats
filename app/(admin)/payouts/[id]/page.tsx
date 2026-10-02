// SPDX-License-Identifier: AGPL-3.0-only

import { PayoutDetail } from '@/components/console/PayoutDetail';

export default async function PayoutDetailPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PayoutDetail id={id} />;
}
