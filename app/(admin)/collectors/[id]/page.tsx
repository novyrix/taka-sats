// SPDX-License-Identifier: AGPL-3.0-only

import { CollectorDetail } from '@/components/console/CollectorDetail';

export default async function CollectorDetailPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CollectorDetail id={id} />;
}
