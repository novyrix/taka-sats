// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Keep a signed-in session honest. A session is a signed JWT that stays valid for weeks (so a phone
 * can work offline), which means it would keep its role and its access long after an admin
 * deactivated the account or changed its role. This re-reads the account every time the session is
 * read: a deactivated or deleted account ends the session at once, and the role is always the one
 * stored now, never the one the token was issued with.
 *
 * If the lookup itself fails (a database blip), the token is kept as it is: an outage must not
 * sign every phone out, and nobody can cause one from outside.
 */

import { isRole, type Role } from './permissions';

export type LiveAccount = { readonly role: Role; readonly locale: string } | null;

/** Resolve the account behind a token; `null` when it no longer exists or is inactive. */
export type AccountLookup = (id: string, partner: boolean) => Promise<LiveAccount>;

type TokenLike = { sub?: string | undefined; role?: unknown; locale?: unknown };

export async function refreshSessionToken<T extends TokenLike>(
  token: T,
  lookup: AccountLookup,
  onLookupError: (error: unknown) => void = () => undefined,
): Promise<T | null> {
  if (!token.sub) {
    return null;
  }
  let live: LiveAccount;
  try {
    live = await lookup(token.sub, token.role === 'partner');
  } catch (error) {
    onLookupError(error);
    return token;
  }
  if (!live || !isRole(live.role)) {
    return null;
  }
  // A partner token must stay a partner and a staff token must stay staff: the table decides.
  token.role = live.role;
  token.locale = live.locale;
  return token;
}
