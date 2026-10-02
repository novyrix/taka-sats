// SPDX-License-Identifier: AGPL-3.0-only

/**
 * One collection event with its verification picture: the answers to "how do we know this
 * weigh happened as claimed?". Each check is computed server-side from stored facts and returns
 * a stable `key` and a `status` the UI translates; nothing here changes any state.
 *
 * The checks that need the photo bytes (that they still hash to the recorded fingerprint) are
 * done by the browser against `photoPath`; the server reports only whether the photo arrived.
 */

import { desc, eq } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';
import {
  anomalyFlags,
  collectionEvents,
  collectors,
  ledgerEntries,
  materialRates,
  sessions,
  supervisors,
} from '@/lib/db/schema';
import { pointInRing } from '@/lib/fraud/geo';
import { getSettings } from '@/lib/config';
import { rateActiveAt } from '@/lib/rates';
import { geoBoundsSchema } from '@/lib/sessions';
import { type EventView, listEvents } from './queries';

export class EventNotFoundError extends Error {
  constructor() {
    super('collection event not found');
    this.name = 'EventNotFoundError';
  }
}

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'unknown';
export type CheckKey =
  | 'collector_authorized'
  | 'session_window'
  | 'rate_in_force'
  | 'photo_stored'
  | 'gps_inside'
  | 'duplicate_photo'
  | 'weight_outlier'
  | 'payout'
  | 'ledger_anchor';

export type EventCheck = {
  readonly key: CheckKey;
  readonly status: CheckStatus;
  readonly detail: Readonly<Record<string, string | number | boolean | null>>;
};

export type FlagView = {
  readonly id: string;
  readonly type: string;
  readonly status: 'open' | 'confirmed' | 'dismissed';
  readonly detectedAt: Date;
};

/** The facts the checks are judged from. Pure data: easy to test without a database. */
export type CheckFacts = {
  readonly recordedAt: Date;
  readonly graceMs: number;
  readonly collector: {
    readonly status: string;
    readonly authorizedBy: string | null;
    readonly authorizedAt: Date | null;
  };
  readonly session: {
    readonly start: Date;
    readonly end: Date;
    readonly bounds: readonly (readonly [number, number])[] | null;
  } | null;
  readonly eventRateId: string;
  readonly rateInForceId: string | null;
  readonly rateFiatMinor: number | null;
  readonly photoStored: boolean;
  readonly gps: { readonly lat: number; readonly lng: number } | { readonly reason: string };
  /** Include coordinates in the GPS detail (staff only). */
  readonly includeGeo: boolean;
  readonly flags: readonly FlagView[];
  readonly payout: { readonly status: string; readonly amountSats: number | null } | null;
  readonly ledger: { readonly seq: number; readonly entryHash: string } | null;
};

function flagCheck(key: 'duplicate_photo' | 'weight_outlier', flags: readonly FlagView[]) {
  const mine = flags.filter((f) => f.type === key);
  const open = mine.filter((f) => f.status === 'open').length;
  const confirmed = mine.filter((f) => f.status === 'confirmed').length;
  const status: CheckStatus = confirmed > 0 ? 'fail' : open > 0 ? 'warn' : 'pass';
  return { key, status, detail: { flagged: mine.length, open, confirmed } } as const;
}

export function evaluateChecks(f: CheckFacts): EventCheck[] {
  const checks: EventCheck[] = [];

  checks.push({
    key: 'collector_authorized',
    status: f.collector.status === 'active' ? 'pass' : 'fail',
    detail: {
      collectorStatus: f.collector.status,
      authorizedBy: f.collector.authorizedBy,
      authorizedAt: f.collector.authorizedAt?.toISOString() ?? null,
    },
  });

  if (f.session === null) {
    checks.push({ key: 'session_window', status: 'unknown', detail: { reason: 'no_session' } });
  } else {
    const inside =
      f.recordedAt.getTime() >= f.session.start.getTime() - f.graceMs &&
      f.recordedAt.getTime() <= f.session.end.getTime() + f.graceMs;
    checks.push({
      key: 'session_window',
      status: inside ? 'pass' : 'fail',
      detail: {
        start: f.session.start.toISOString(),
        end: f.session.end.toISOString(),
        graceMinutes: Math.round(f.graceMs / 60_000),
      },
    });
  }

  checks.push({
    key: 'rate_in_force',
    status:
      f.rateInForceId === null ? 'unknown' : f.rateInForceId === f.eventRateId ? 'pass' : 'fail',
    detail: { rateId: f.eventRateId, rateFiatMinor: f.rateFiatMinor },
  });

  checks.push({
    key: 'photo_stored',
    status: f.photoStored ? 'pass' : 'warn',
    detail: { stored: f.photoStored },
  });

  if ('reason' in f.gps) {
    checks.push({ key: 'gps_inside', status: 'warn', detail: { reason: f.gps.reason } });
  } else if (f.session?.bounds) {
    const inside = pointInRing(f.gps.lat, f.gps.lng, f.session.bounds);
    checks.push({
      key: 'gps_inside',
      status: inside ? 'pass' : 'fail',
      detail: f.includeGeo ? { lat: f.gps.lat, lng: f.gps.lng } : {},
    });
  } else {
    // A fix exists, but the session has no boundary to judge it against.
    checks.push({
      key: 'gps_inside',
      status: 'unknown',
      detail: { reason: 'no_bounds', ...(f.includeGeo && { lat: f.gps.lat, lng: f.gps.lng }) },
    });
  }

  checks.push(flagCheck('duplicate_photo', f.flags));
  checks.push(flagCheck('weight_outlier', f.flags));

  checks.push({
    key: 'payout',
    status:
      f.payout === null
        ? 'unknown'
        : f.payout.status === 'paid'
          ? 'pass'
          : f.payout.status === 'failed'
            ? 'fail'
            : 'warn',
    detail: { status: f.payout?.status ?? null, amountSats: f.payout?.amountSats ?? null },
  });

  checks.push({
    key: 'ledger_anchor',
    status: f.ledger ? 'pass' : 'fail',
    detail: { seq: f.ledger?.seq ?? null, entryHash: f.ledger?.entryHash ?? null },
  });

  return checks;
}

export type EventDetail = EventView & {
  readonly rate: { readonly id: string; readonly fiatMinorPerKg: number };
  readonly registrationType: string;
  readonly session: {
    readonly id: string;
    readonly location: string;
    readonly scheduledStart: Date;
    readonly scheduledEnd: Date;
    readonly status: string;
  } | null;
  readonly supervisor: { readonly id: string; readonly name: string } | null;
  readonly photoStored: boolean;
  readonly ledger: {
    readonly seq: number;
    readonly entryHash: string;
    readonly payloadHash: string;
  };
  readonly flags: readonly FlagView[];
  readonly checks: readonly EventCheck[];
};

/**
 * `recordedBy` limits the lookup to one supervisor's own events (a plain supervisor);
 * `includeGeo` is for staff.
 */
export async function getEventDetail(
  db: Database,
  id: string,
  { recordedBy, includeGeo }: { recordedBy?: string | undefined; includeGeo: boolean },
): Promise<EventDetail> {
  const { events } = await listEvents(
    db,
    { id, ...(recordedBy && { recordedBy }) },
    { limit: 1, includeGeo },
  );
  const view = events[0];
  if (!view) {
    throw new EventNotFoundError();
  }

  const [row] = await db
    .select({
      event: collectionEvents,
      collectorStatus: collectors.status,
      authorizedBy: collectors.authorizedBy,
      authorizedAt: collectors.authorizedAt,
      supervisorName: supervisors.name,
      entryHash: ledgerEntries.entryHash,
      payloadHash: ledgerEntries.payloadHash,
    })
    .from(collectionEvents)
    .innerJoin(collectors, eq(collectors.id, collectionEvents.collectorId))
    .innerJoin(ledgerEntries, eq(ledgerEntries.id, collectionEvents.ledgerEntryId))
    .leftJoin(supervisors, eq(supervisors.id, collectionEvents.supervisorId))
    .where(eq(collectionEvents.id, id));
  if (!row) {
    throw new EventNotFoundError();
  }
  const e = row.event;

  const [session] = e.sessionId
    ? await db.select().from(sessions).where(eq(sessions.id, e.sessionId))
    : [];
  const bounds = geoBoundsSchema.safeParse(session?.geoBounds);

  const flagRows = await db
    .select()
    .from(anomalyFlags)
    .where(eq(anomalyFlags.collectionEventId, id))
    .orderBy(desc(anomalyFlags.detectedAt));
  const flags: FlagView[] = flagRows.map((flag) => ({
    id: flag.id,
    type: flag.flagType,
    status:
      flag.reviewOutcome === 'confirmed' || flag.reviewOutcome === 'dismissed'
        ? flag.reviewOutcome
        : 'open',
    detectedAt: flag.detectedAt,
  }));

  const inForce = await rateActiveAt(db, e.material, e.recordedAt);
  const [rateRow] = await db.select().from(materialRates).where(eq(materialRates.id, e.rateId));

  const gps =
    e.gpsLat !== null && e.gpsLng !== null
      ? { lat: Number(e.gpsLat), lng: Number(e.gpsLng) }
      : { reason: e.gpsUnavailableReason ?? '' };

  const checks = evaluateChecks({
    recordedAt: e.recordedAt,
    graceMs: getSettings().anomaly.off_hours_grace_minutes * 60_000,
    collector: {
      status: row.collectorStatus,
      authorizedBy: row.authorizedBy,
      authorizedAt: row.authorizedAt,
    },
    session: session
      ? {
          start: session.scheduledStart,
          end: session.scheduledEnd,
          bounds: bounds.success ? (bounds.data.coordinates[0] ?? null) : null,
        }
      : null,
    eventRateId: e.rateId,
    rateInForceId: inForce?.id ?? null,
    rateFiatMinor: rateRow?.rateFiatMinor ?? null,
    photoStored: e.photoUrl !== null,
    gps,
    includeGeo,
    flags,
    payout: view.payout ? { status: view.payout.status, amountSats: view.payout.amountSats } : null,
    ledger: { seq: view.seq, entryHash: row.entryHash },
  });

  return {
    ...view,
    rate: { id: e.rateId, fiatMinorPerKg: rateRow?.rateFiatMinor ?? 0 },
    registrationType: e.registrationType,
    session: session
      ? {
          id: session.id,
          location: session.location,
          scheduledStart: session.scheduledStart,
          scheduledEnd: session.scheduledEnd,
          status: session.status,
        }
      : null,
    supervisor: row.supervisorName ? { id: e.supervisorId, name: row.supervisorName } : null,
    photoStored: e.photoUrl !== null,
    ledger: { seq: view.seq, entryHash: row.entryHash, payloadHash: row.payloadHash },
    flags,
    checks,
  };
}
