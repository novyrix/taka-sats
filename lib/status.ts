// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The shared status vocabulary (DESIGN §8, §13.2).
 *
 * Every status a supervisor or admin sees is **shape + colour + text** — colour
 * never carries the meaning alone. `<StatusIcon>` / `<StatusPill>` accept only
 * one of these values, never a raw colour. Zero framework imports (D-04).
 */

export const DISPLAY_STATUSES = [
  'queued', // dotted circle — recorded locally, not yet sent
  'syncing', // circular-arrow (the one sanctioned loop, §9.4)
  'confirmed', // check — accepted by the server
  'needs_attention', // triangle — accepted but flagged for review
  'failed', // octagon/x — a genuine error (§4.4 red is allowed here)
  'pending_payout', // clock — verified, waiting on float or a second sign-off
] as const;

export type DisplayStatus = (typeof DISPLAY_STATUSES)[number];

/**
 * Colour is reinforcement only. Tokens, never raw hex:
 *  - muted        → not-yet-actioned (queued)
 *  - primary      → in progress / done well (syncing, confirmed)
 *  - foreground   → needs a human, but not an error — Ink + weight (§4.4)
 *  - destructive  → a genuine failure only (§4.4)
 */
export const STATUS_TONE: Readonly<Record<DisplayStatus, string>> = {
  queued: 'text-muted-foreground',
  syncing: 'text-primary',
  confirmed: 'text-primary',
  needs_attention: 'text-foreground',
  failed: 'text-destructive',
  pending_payout: 'text-foreground',
};

export function isDisplayStatus(value: unknown): value is DisplayStatus {
  return typeof value === 'string' && (DISPLAY_STATUSES as readonly string[]).includes(value);
}
