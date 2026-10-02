// SPDX-License-Identifier: AGPL-3.0-only

import { SessionDetail } from '@/components/console/SessionDetail';
import { requirePageScope } from '@/lib/auth/page-guard';

export default async function SessionDetailPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  await requirePageScope('session:configure');
  const { id } = await params;
  return <SessionDetail id={id} />;
}
