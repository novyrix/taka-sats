// SPDX-License-Identifier: AGPL-3.0-only

import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { buttonVariants } from '@/components/ui/button';
import { getSettings } from '@/lib/config';
import { getDb } from '@/lib/db/client';
import { cn } from '@/lib/utils';
import { listSessions } from '@/lib/sessions';

/** Session lifecycle badge tone — reinforcement only, tokens never raw hex. */
const STATUS_CLASS: Record<string, string> = {
  scheduled: 'text-muted-foreground',
  active: 'text-primary',
  closed: 'text-muted-foreground/70',
};

export default async function AdminSessionsPage() {
  const t = await getTranslations('Admin.sessions');
  const sessions = await listSessions(getDb());
  const fmt = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: getSettings().programme.timezone,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-xl font-bold tracking-[-0.02em]">{t('title')}</h1>
        <Link href="/sessions/new" className={buttonVariants({ size: 'sm' })}>
          {t('new')}
        </Link>
      </div>

      {sessions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left font-display text-xs uppercase tracking-[0.02em] text-muted-foreground">
                <th className="px-4 py-3 font-medium">{t('col.location')}</th>
                <th className="px-4 py-3 font-medium">{t('col.window')}</th>
                <th className="px-4 py-3 font-medium">{t('col.status')}</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <Link href={`/sessions/${s.id}`} className="font-medium hover:underline">
                      {s.location}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {fmt.format(s.scheduledStart)} → {fmt.format(s.scheduledEnd)}
                  </td>
                  <td
                    className={cn(
                      'px-4 py-3 font-display text-xs font-medium uppercase tracking-[0.02em]',
                      STATUS_CLASS[s.status] ?? 'text-muted-foreground',
                    )}
                  >
                    {t(`state.${s.status}`)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
