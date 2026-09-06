// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { RotationWithName } from '@/lib/rotations';
import type { SupervisorSummary } from '@/lib/supervisors';

type Props = {
  readonly rotations: readonly RotationWithName[];
  readonly supervisors: readonly SupervisorSummary[];
};

type ApiError = { error?: { message?: string } };

function toIso(local: string): string {
  if (!local) {
    return '';
  }
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

export function RotationsManager({ rotations, supervisors }: Props) {
  const t = useTranslations('Admin.rotations');
  const router = useRouter();

  const [supervisorId, setSupervisorId] = useState('');
  const [location, setLocation] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fmt = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

  async function onCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    const startIso = toIso(start);
    const endIso = toIso(end);
    if (!supervisorId || !location.trim() || !startIso || !endIso) {
      setError(t('error.missing'));
      return;
    }
    if (new Date(endIso) <= new Date(startIso)) {
      setError(t('error.order'));
      return;
    }

    setBusy(true);
    const res = await fetch('/api/v1/rotations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        supervisorId,
        location: location.trim(),
        windowStart: startIso,
        windowEnd: endIso,
      }),
    });
    setBusy(false);

    if (res.status === 201) {
      setSupervisorId('');
      setLocation('');
      setStart('');
      setEnd('');
      router.refresh();
      return;
    }
    const body = (await res.json().catch(() => ({}))) as ApiError;
    setError(body.error?.message ?? t('error.generic'));
  }

  async function onDelete(id: string): Promise<void> {
    setError(null);
    const res = await fetch(`/api/v1/rotations/${id}`, { method: 'DELETE' });
    if (res.status === 204) {
      router.refresh();
      return;
    }
    setError(t('error.deleteFailed'));
  }

  return (
    <div className="space-y-8">
      <form
        onSubmit={onCreate}
        className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-2"
      >
        <div className="space-y-2">
          <Label htmlFor="rot-supervisor">{t('field.supervisor')}</Label>
          <select
            id="rot-supervisor"
            value={supervisorId}
            onChange={(e) => setSupervisorId(e.target.value)}
            className="flex h-11 w-full rounded-lg border border-input bg-card px-3 py-2 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option value="">{t('field.supervisorNone')}</option>
            {supervisors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.role})
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="rot-location">{t('field.location')}</Label>
          <Input
            id="rot-location"
            maxLength={200}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder={t('field.locationPlaceholder')}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rot-start">{t('field.start')}</Label>
          <Input
            id="rot-start"
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rot-end">{t('field.end')}</Label>
          <Input
            id="rot-end"
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive sm:col-span-2">
            {error}
          </p>
        )}
        <div className="sm:col-span-2">
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? t('adding') : t('add')}
          </Button>
        </div>
      </form>

      {rotations.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[44rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left font-display text-xs uppercase tracking-[0.02em] text-muted-foreground">
                <th className="px-4 py-3 font-medium">{t('col.supervisor')}</th>
                <th className="px-4 py-3 font-medium">{t('col.location')}</th>
                <th className="px-4 py-3 font-medium">{t('col.window')}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rotations.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium">{r.supervisorName}</td>
                  <td className="px-4 py-3">{r.location}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {fmt.format(r.windowStart)} → {fmt.format(r.windowEnd)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="ghost" size="sm" onClick={() => onDelete(r.id)}>
                      {t('remove')}
                    </Button>
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
