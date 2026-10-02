// SPDX-License-Identifier: AGPL-3.0-only

import type { DisplayStatus } from '@/lib/status';

/**
 * Map each domain state onto the shared `DisplayStatus` vocabulary (shape + colour + text), so
 * every console status chip reuses `<StatusPill>`. The visible label is translated separately
 * (`Console.status.<domain>.<value>`); unknown values fall back to `needs_attention`.
 */

const COLLECTOR: Record<string, DisplayStatus> = {
  active: 'confirmed',
  pending: 'pending_payout',
  revoked: 'failed',
};

const DESTINATION: Record<string, DisplayStatus> = {
  verified: 'confirmed',
  pending_validation: 'pending_payout',
  invalid: 'failed',
  revoked: 'failed',
};

const PAYOUT: Record<string, DisplayStatus> = {
  paid: 'confirmed',
  queued: 'syncing',
  sending: 'syncing',
  failed: 'failed',
  awaiting_rate: 'pending_payout',
  awaiting_destination: 'needs_attention',
  pending_approval: 'needs_attention',
  pending_float: 'pending_payout',
};

const TOPUP: Record<string, DisplayStatus> = {
  proposed: 'needs_attention',
  approved: 'pending_payout',
  transferred: 'syncing',
  confirmed: 'confirmed',
  rejected: 'failed',
  cancelled: 'queued',
};

const ANOMALY: Record<string, DisplayStatus> = {
  open: 'needs_attention',
  confirmed: 'failed',
  dismissed: 'queued',
};

const SESSION: Record<string, DisplayStatus> = {
  active: 'confirmed',
  scheduled: 'queued',
  closed: 'queued',
};

export const COLLECTOR_STATES = Object.keys(COLLECTOR);
export const PAYOUT_STATES = [
  'pending_approval',
  'awaiting_destination',
  'awaiting_rate',
  'pending_float',
  'queued',
  'sending',
  'paid',
  'failed',
] as const;
export const TOPUP_STATES = [
  'proposed',
  'approved',
  'transferred',
  'confirmed',
  'rejected',
  'cancelled',
] as const;

function lookup(table: Record<string, DisplayStatus>, value: string): DisplayStatus {
  return table[value] ?? 'needs_attention';
}

export const collectorDisplay = (s: string): DisplayStatus => lookup(COLLECTOR, s);
export const destinationDisplay = (s: string): DisplayStatus => lookup(DESTINATION, s);
export const payoutDisplay = (s: string): DisplayStatus => lookup(PAYOUT, s);
export const topupDisplay = (s: string): DisplayStatus => lookup(TOPUP, s);
export const anomalyDisplay = (s: string): DisplayStatus => lookup(ANOMALY, s);
export const sessionDisplay = (s: string): DisplayStatus => lookup(SESSION, s);
