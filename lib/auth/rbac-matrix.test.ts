// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The exhaustive role × scope matrix (ROADMAP M2-10, REQUIREMENTS §3.2,
 * Code Style Guide §9.4). EXPECTED is transcribed by hand from §3.2 — if
 * `lib/auth/permissions.ts` ever widens a scope, a cell here fails loudly.
 *
 * The single most important row: `payout:execute` is `false` for every
 * human role — directing a payout is a system function only.
 */

import { describe, expect, it } from 'vitest';
import { ROLES, type Role, roleHasScope, SCOPES, type Scope } from './permissions';

type Row = Record<Role, boolean>;
const F: Row = { supervisor: false, hub_lead: false, admin: false, partner: false };
const row = (over: Partial<Row>): Row => ({ ...F, ...over });

const EXPECTED: Record<Scope, Row> = {
  'collector:enrol': row({ supervisor: true, hub_lead: true, admin: true }),
  'collector:authorize': row({ hub_lead: true, admin: true }),
  'collector:read': row({ supervisor: true, hub_lead: true, admin: true }),
  'collection:record': row({ supervisor: true, hub_lead: true, admin: true }),
  'rates:read': row({ supervisor: true, hub_lead: true, admin: true }),
  'session:read': row({ supervisor: true, hub_lead: true, admin: true }),
  'tag:revoke': row({ admin: true }),
  'session:configure': row({ admin: true }),
  'payout:read': row({ supervisor: true, hub_lead: true, admin: true }),
  'payout:approve': row({ hub_lead: true, admin: true }),
  'payout:execute': row({}), // ← NO human role. Ever.
  'treasury:topup:initiate': row({ admin: true }),
  'anomaly:review': row({ admin: true }),
  'reconciliation:write': row({ admin: true }),
  'session:metrics:read:own': row({ supervisor: true, hub_lead: true }),
  'session:metrics:read:all': row({ admin: true }),
  'session:metrics:read:sponsored': row({ partner: true }),
  'report:generate:all': row({ admin: true }),
  'report:generate:own': row({ partner: true }),
  'apikey:manage': row({ admin: true }),
  'ledger:read': row({ admin: true }),
};

describe('RBAC matrix — every (role, scope) cell matches REQUIREMENTS §3.2', () => {
  it('SCOPES and EXPECTED cover exactly the same set (no scope left untested)', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...SCOPES].sort());
  });

  const cells = SCOPES.flatMap((scope) => ROLES.map((role) => ({ scope, role })));

  it.each(cells)('$role × $scope', ({ scope, role }) => {
    expect(roleHasScope(role, scope)).toBe(EXPECTED[scope][role]);
  });

  it('no human role can reach a payout-execution path (Code Style Guide §9.4)', () => {
    for (const role of ROLES) {
      expect(roleHasScope(role, 'payout:execute')).toBe(false);
    }
  });
});
