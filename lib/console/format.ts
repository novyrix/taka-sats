// SPDX-License-Identifier: AGPL-3.0-only

/** Display helpers for the operator console. Pure; safe on the server and in the browser. */

export function formatSats(sats: number | null | undefined): string {
  if (sats === null || sats === undefined) {
    return '';
  }
  return `${new Intl.NumberFormat('en-GB').format(sats)} sats`;
}

/** Fiat is carried in minor units (KES cents). */
export function formatFiat(minor: number | null | undefined, currency = 'KES'): string {
  if (minor === null || minor === undefined) {
    return '';
  }
  return `${currency} ${new Intl.NumberFormat('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100)}`;
}

export function formatDateTime(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...(timeZone && { timeZone }),
  }).format(date);
}

/** First 8 characters of an id or hash, for compact display next to a copy affordance. */
export function shortId(value: string | null | undefined): string {
  return value ? value.slice(0, 8) : '';
}

export function formatKg(kg: number): string {
  return `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 3 }).format(kg)} kg`;
}

/** Partially hide a Lightning address for lists (full address stays on the detail page). */
export function maskAddress(address: string | null | undefined): string {
  if (!address) {
    return '';
  }
  const at = address.indexOf('@');
  if (at <= 0) {
    return `${address.slice(0, 6)}...`;
  }
  const user = address.slice(0, at);
  return `${user.slice(0, 2)}${'*'.repeat(Math.max(user.length - 2, 1))}${address.slice(at)}`;
}
