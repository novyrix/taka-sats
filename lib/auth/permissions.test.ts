// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  ROLES,
  ROLE_SCOPES,
  type Role,
  roleHasScope,
  scopesFor,
  SYSTEM_ONLY_SCOPES,
} from './permissions';

const HUMAN_ROLES: readonly Role[] = ROLES;

describe('payout execution is structurally unreachable by any human role', () => {
  it.each(HUMAN_ROLES)('role %s does not hold payout:execute', (role) => {
    expect(roleHasScope(role, 'payout:execute')).toBe(false);
    expect(scopesFor(role).has('payout:execute')).toBe(false);
    expect(ROLE_SCOPES[role]).not.toContain('payout:execute');
  });

  it('payout:execute is declared system-only', () => {
    expect(SYSTEM_ONLY_SCOPES).toContain('payout:execute');
  });

  it('no system-only scope leaks into any role', () => {
    for (const role of HUMAN_ROLES) {
      for (const scope of SYSTEM_ONLY_SCOPES) {
        expect(roleHasScope(role, scope)).toBe(false);
      }
    }
  });
});

describe('role → scope matrix (REQUIREMENTS §3.2)', () => {
  it('supervisor can record collection events but not configure sessions', () => {
    expect(roleHasScope('supervisor', 'collection:record')).toBe(true);
    expect(roleHasScope('supervisor', 'session:configure')).toBe(false);
    expect(roleHasScope('supervisor', 'tag:revoke')).toBe(false);
    expect(roleHasScope('supervisor', 'payout:approve')).toBe(false);
  });

  it('hub_lead is a superset of supervisor plus payout approval', () => {
    for (const scope of scopesFor('supervisor')) {
      expect(roleHasScope('hub_lead', scope)).toBe(true);
    }
    expect(roleHasScope('hub_lead', 'payout:approve')).toBe(true);
    expect(roleHasScope('hub_lead', 'session:configure')).toBe(false);
  });

  it('only admin revokes tags, configures sessions, and manages API keys', () => {
    expect(roleHasScope('admin', 'tag:revoke')).toBe(true);
    expect(roleHasScope('admin', 'session:configure')).toBe(true);
    expect(roleHasScope('admin', 'apikey:manage')).toBe(true);
    for (const role of ['supervisor', 'hub_lead', 'partner'] as const) {
      expect(roleHasScope(role, 'tag:revoke')).toBe(false);
      expect(roleHasScope(role, 'apikey:manage')).toBe(false);
    }
  });

  it('partner is read-only and scoped to its sponsorship', () => {
    expect(roleHasScope('partner', 'session:metrics:read:sponsored')).toBe(true);
    expect(roleHasScope('partner', 'report:generate:own')).toBe(true);
    expect(roleHasScope('partner', 'collection:record')).toBe(false);
    expect(roleHasScope('partner', 'session:metrics:read:all')).toBe(false);
  });

  it('is deny-by-default for an unknown pairing', () => {
    expect(roleHasScope('supervisor', 'report:generate:all')).toBe(false);
  });
});
