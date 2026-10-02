// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { useConsoleUser } from '@/components/console/context';
import { useApi } from '@/components/console/hooks';
import {
  ActionButton,
  DataState,
  DomainPill,
  ErrorNotice,
  KeyValue,
  PageHeader,
  Panel,
  TextField,
} from '@/components/console/kit';
import { Button } from '@/components/ui/button';
import { type ApiFail, api } from '@/lib/console/api';
import { formatDateTime } from '@/lib/console/format';

type SessionView = {
  id: string;
  location: string;
  scheduledStart: string;
  scheduledEnd: string;
  status: string;
  supervisorIds: string[];
};
type Person = { id: string; name: string; role: string; active: boolean };

const toLocalInput = (iso: string): string => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * One session: start it (a new session is only "scheduled"; supervisors can record only inside
 * an ACTIVE session whose window contains now), close it, move its window and change who is
 * assigned.
 */
export function SessionDetail({ id }: { readonly id: string }) {
  const t = useTranslations('Console.sessions');
  const user = useConsoleUser();
  const one = useApi<{ session: SessionView }>(`/sessions/${id}`);
  const roster = useApi<{ supervisors: Person[] }>('/supervisors?role=supervisor');
  const session = one.data?.session;

  return (
    <div className="space-y-6">
      <PageHeader
        title={session?.location ?? t('title')}
        actions={
          <Link href="/sessions" className="text-sm underline">
            {t('back')}
          </Link>
        }
      />
      <DataState loading={one.loading} error={one.error} onRetry={one.reload}>
        {session ? (
          <>
            <Panel title={t('state')}>
              <KeyValue
                items={[
                  { k: t('status'), v: <DomainPill domain="session" value={session.status} /> },
                  {
                    k: t('window'),
                    v: `${formatDateTime(session.scheduledStart, user.timeZone)} / ${formatDateTime(session.scheduledEnd, user.timeZone)}`,
                  },
                  { k: t('assigned'), v: session.supervisorIds.length },
                ]}
              />
              <p className="mt-3 text-sm text-muted-foreground">{t('activeHint')}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {session.status !== 'active' ? (
                  <ActionButton
                    label={t('start')}
                    testId="start-session"
                    run={() =>
                      api(`/sessions/${id}`, { method: 'PATCH', body: { status: 'active' } })
                    }
                    onDone={one.reload}
                  />
                ) : null}
                {session.status === 'active' ? (
                  <ActionButton
                    label={t('close')}
                    variant="outline"
                    confirm={t('closeConfirm')}
                    run={() =>
                      api(`/sessions/${id}`, { method: 'PATCH', body: { status: 'closed' } })
                    }
                    onDone={one.reload}
                  />
                ) : null}
              </div>
            </Panel>
            <EditForm
              key={`${session.scheduledStart}|${session.scheduledEnd}|${session.supervisorIds.join(',')}`}
              session={session}
              people={roster.data?.supervisors ?? []}
              onSaved={one.reload}
            />
          </>
        ) : null}
      </DataState>
    </div>
  );
}

function EditForm({
  session,
  people,
  onSaved,
}: {
  readonly session: SessionView;
  readonly people: readonly Person[];
  readonly onSaved: () => void;
}) {
  const t = useTranslations('Console.sessions');
  const [start, setStart] = useState(toLocalInput(session.scheduledStart));
  const [end, setEnd] = useState(toLocalInput(session.scheduledEnd));
  const [selected, setSelected] = useState<string[]>(session.supervisorIds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiFail | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await api(`/sessions/${session.id}`, {
      method: 'PATCH',
      body: {
        scheduledStart: new Date(start).toISOString(),
        scheduledEnd: new Date(end).toISOString(),
        supervisorIds: selected,
      },
    });
    setBusy(false);
    if (res.ok) {
      setSaved(true);
      onSaved();
    } else {
      setError(res);
    }
  }

  return (
    <Panel title={t('edit')}>
      <form onSubmit={(e) => void submit(e)} className="max-w-xl space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField
            label={t('start_label')}
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
          <TextField
            label={t('end_label')}
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
        <fieldset>
          <legend className="mb-2 font-display text-xs font-medium uppercase tracking-[0.02em] text-muted-foreground">
            {t('supervisors')}
          </legend>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {people.map((p) => (
              <li key={p.id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={selected.includes(p.id)}
                    onChange={(e) =>
                      setSelected((cur) =>
                        e.target.checked ? [...cur, p.id] : cur.filter((x) => x !== p.id),
                      )
                    }
                  />
                  {p.name}
                  {!p.active ? (
                    <span className="text-muted-foreground">({t('inactive')})</span>
                  ) : null}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        {error ? <ErrorNotice error={error} /> : null}
        {saved ? (
          <p role="status" className="text-sm font-medium">
            {t('saved')}
          </p>
        ) : null}
        <Button type="submit" size="sm" disabled={busy} data-testid="save-session">
          {busy ? t('saving') : t('save')}
        </Button>
      </form>
    </Panel>
  );
}
