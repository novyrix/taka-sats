// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { PartnerSummary } from '@/lib/partners';
import type { SupervisorSummary } from '@/lib/supervisors';

type Props = {
  readonly supervisors: readonly SupervisorSummary[];
  readonly partners: readonly PartnerSummary[];
};

type ApiError = { error?: { message?: string } };

/** `datetime-local` value (local wall time) → ISO, or '' if unparseable. */
function toIso(local: string): string {
  if (!local) {
    return '';
  }
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

export function NewSessionForm({ supervisors, partners }: Props) {
  const t = useTranslations('Admin.newSession');
  const router = useRouter();
  const geoFieldId = useId();

  const [location, setLocation] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [supervisorIds, setSupervisorIds] = useState<readonly string[]>([]);
  const [sponsorPartnerId, setSponsorPartnerId] = useState('');
  const [geoRaw, setGeoRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleSupervisor(id: string): void {
    setSupervisorIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    let geoBounds: unknown;
    if (geoRaw.trim()) {
      try {
        geoBounds = JSON.parse(geoRaw);
      } catch {
        setError(t('error.geoJson'));
        return;
      }
    }

    const startIso = toIso(start);
    const endIso = toIso(end);
    if (!startIso || !endIso) {
      setError(t('error.window'));
      return;
    }
    if (new Date(endIso) <= new Date(startIso)) {
      setError(t('error.order'));
      return;
    }

    setBusy(true);
    const res = await fetch('/api/v1/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        location: location.trim(),
        scheduledStart: startIso,
        scheduledEnd: endIso,
        supervisorIds,
        ...(sponsorPartnerId ? { sponsorPartnerId } : {}),
        ...(geoBounds !== undefined ? { geoBounds } : {}),
      }),
    });
    setBusy(false);

    if (res.status === 201) {
      const created = (await res.json().catch(() => null)) as { session?: { id?: string } } | null;
      // Land on the session itself: a new session is only scheduled until someone starts it.
      router.push(created?.session?.id ? `/sessions/${created.session.id}` : '/sessions');
      router.refresh();
      return;
    }
    const body = (await res.json().catch(() => ({}))) as ApiError;
    setError(body.error?.message ?? t('error.generic'));
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="location">{t('field.location')}</Label>
        <Input
          id="location"
          required
          maxLength={200}
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder={t('field.locationPlaceholder')}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="start">{t('field.start')}</Label>
          <Input
            id="start"
            type="datetime-local"
            required
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="end">{t('field.end')}</Label>
          <Input
            id="end"
            type="datetime-local"
            required
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="font-display text-xs font-medium uppercase tracking-[0.02em] text-muted-foreground">
          {t('field.supervisors')}
        </legend>
        {supervisors.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('field.noSupervisors')}</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {supervisors.map((s) => (
              <li key={s.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={supervisorIds.includes(s.id)}
                    onChange={() => toggleSupervisor(s.id)}
                  />
                  <span className="font-medium">{s.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{s.role}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      {partners.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor="sponsor">{t('field.sponsor')}</Label>
          <select
            id="sponsor"
            value={sponsorPartnerId}
            onChange={(e) => setSponsorPartnerId(e.target.value)}
            className="flex h-11 w-full rounded-lg border border-input bg-card px-3 py-2 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option value="">{t('field.sponsorNone')}</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor={geoFieldId}>{t('field.geo')}</Label>
        <textarea
          id={geoFieldId}
          rows={4}
          value={geoRaw}
          onChange={(e) => setGeoRaw(e.target.value)}
          placeholder='{"type":"Polygon","coordinates":[[[36.78,-1.29],[36.79,-1.29],[36.79,-1.30],[36.78,-1.29]]]}'
          className="flex w-full rounded-lg border border-input bg-card px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
        <p className="text-xs text-muted-foreground">{t('field.geoHint')}</p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" size="lg" disabled={busy}>
        {busy ? t('submitting') : t('submit')}
      </Button>
    </form>
  );
}
