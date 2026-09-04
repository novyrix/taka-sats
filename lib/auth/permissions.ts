// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Role → scope matrix (REQUIREMENTS §3.2, FR-3.1, D-06).
 *
 * The matrix is data, not branching logic, so it can be diffed, tested
 * exhaustively (M2-10), and reasoned about at a glance. Enforcement is
 * deny-by-default: a `(role, scope)` pair not listed here is denied.
 *
 * SECURITY INVARIANT (Code Style Guide §9.3–9.4): the payout-execution scope
 * `payout:execute` appears in NO role's scope list. Directing or executing a
 * payout is a system function only; the destination is always resolved
 * server-side from the tapped tag's mapping and is never client input. The
 * companion test fails the build if this invariant is broken.
 *
 * Zero framework imports (D-04).
 */

export const ROLES = ['supervisor', 'hub_lead', 'admin', 'partner'] as const;
export type Role = (typeof ROLES)[number];

export const SCOPES = [
  'collector:enrol', // enrol a collector, issue/replace a tag
  'collection:record', // record a collection event
  'tag:revoke', // revoke a tag mapping
  'session:configure', // configure sessions, rates, thresholds
  'payout:approve', // approve an above-threshold payout that is not your own submission
  'payout:execute', // execute/direct a payout — SYSTEM ONLY, in no role
  'treasury:topup:initiate', // initiate a cold→hot top-up (still needs a 2nd sign-off)
  'anomaly:review', // review/resolve anomaly flags
  'session:metrics:read:own', // live metrics for your own sessions
  'session:metrics:read:all', // live metrics for every session
  'session:metrics:read:sponsored', // live metrics for sessions you sponsor
  'report:generate:all', // generate any partner/funder report
  'report:generate:own', // generate reports within your own scope
  'apikey:manage', // create/revoke API keys
] as const;
export type Scope = (typeof SCOPES)[number];

/** Scopes that exist but belong to no human role — system functions only. */
export const SYSTEM_ONLY_SCOPES = ['payout:execute'] as const satisfies readonly Scope[];
export type SystemOnlyScope = (typeof SYSTEM_ONLY_SCOPES)[number];

const supervisorScopes = [
  'collector:enrol',
  'collection:record',
  'session:metrics:read:own',
] as const satisfies readonly Scope[];

/** The one source of truth for what each role may do. */
export const ROLE_SCOPES: Readonly<Record<Role, readonly Scope[]>> = Object.freeze({
  supervisor: supervisorScopes,
  hub_lead: [...supervisorScopes, 'payout:approve'],
  admin: [
    'collector:enrol',
    'collection:record',
    'tag:revoke',
    'session:configure',
    'payout:approve',
    'treasury:topup:initiate',
    'anomaly:review',
    'session:metrics:read:all',
    'report:generate:all',
    'apikey:manage',
  ],
  partner: ['session:metrics:read:sponsored', 'report:generate:own'],
});

const ROLE_SCOPE_SETS: Readonly<Record<Role, ReadonlySet<Scope>>> = Object.freeze({
  supervisor: new Set(ROLE_SCOPES.supervisor),
  hub_lead: new Set(ROLE_SCOPES.hub_lead),
  admin: new Set(ROLE_SCOPES.admin),
  partner: new Set(ROLE_SCOPES.partner),
});

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** All scopes granted to a role, as an immutable set. */
export function scopesFor(role: Role): ReadonlySet<Scope> {
  return ROLE_SCOPE_SETS[role];
}

/** Deny-by-default check: does this role hold this scope? */
export function roleHasScope(role: Role, scope: Scope): boolean {
  return ROLE_SCOPE_SETS[role].has(scope);
}

/** True when the scope is a system-only function no human role can hold. */
export function isSystemOnlyScope(scope: Scope): scope is SystemOnlyScope {
  return (SYSTEM_ONLY_SCOPES as readonly Scope[]).includes(scope);
}
