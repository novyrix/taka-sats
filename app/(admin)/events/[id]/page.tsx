// SPDX-License-Identifier: AGPL-3.0-only

import { EventDetail } from '@/components/console/EventDetail';

export default async function EventDetailPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EventDetail id={id} />;
}
