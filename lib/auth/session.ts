// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The RBAC gate every `/api/v1` route handler goes through (M2-2, pulled
 * forward to unblock M1-4). Deny-by-default: no session → 401; a session
 * without the required scope → 403. Resolves the Auth.js JWT session — no DB
 * round trip (§3.1's offline-surviving session).
 *
 * This module *does* import the Next-adjacent `auth()` helper, so it is not
 * one of D-04's framework-free `lib/` subpackages — it is the seam between
 * them and the route layer.
 */

import { auth } from '@/auth';
import { type Role, type Scope, roleHasScope } from './permissions';

export type Actor = {
  readonly kind: 'supervisor';
  readonly id: string;
  readonly role: Role;
};

export class UnauthorizedError extends Error {
  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error {
  constructor(public readonly scope: Scope) {
    super(`Missing required scope: ${scope}`);
    this.name = 'ForbiddenError';
  }
}

/** The signed-in supervisor, or null if there is no valid session. */
export async function getActor(): Promise<Actor | null> {
  const session = await auth();
  if (!session?.user) {
    return null;
  }
  return { kind: 'supervisor', id: session.user.id, role: session.user.role };
}

/**
 * @throws {UnauthorizedError} no valid session.
 * @throws {ForbiddenError} the signed-in role does not hold `scope`.
 */
export async function requireScope(scope: Scope): Promise<Actor> {
  const actor = await getActor();
  if (!actor) {
    throw new UnauthorizedError();
  }
  if (!roleHasScope(actor.role, scope)) {
    throw new ForbiddenError(scope);
  }
  return actor;
}
