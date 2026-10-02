// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import sheng from '@/messages/sheng.json';
import sw from '@/messages/sw.json';
import { PAYOUT_STATES, TOPUP_STATES } from './status-map';

type Tree = { [key: string]: Tree | string };

function keys(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : keys(value, `${prefix}${key}.`),
  );
}

const get = (tree: Tree, path: string): unknown =>
  path.split('.').reduce<unknown>((node, part) => (node as Tree | undefined)?.[part], tree);

describe('console messages', () => {
  it('en, sw and sheng define exactly the same keys', () => {
    const base = keys(en as Tree).sort();
    expect(keys(sw as Tree).sort()).toEqual(base);
    expect(keys(sheng as Tree).sort()).toEqual(base);
  });

  it('has a readable message for every documented API error code', () => {
    const codes = [
      'invalid_request',
      'unauthorized',
      'forbidden',
      'no_active_session',
      'destination_replace_forbidden',
      'self_approval',
      'not_your_collector',
      'not_found',
      'collector_not_authorized',
      'destination_in_use',
      'conflict',
      'invalid_cursor',
      'self_resolution',
      'not_resolvable',
      'reference_in_use',
      'reference_mismatch',
      'provider_disagrees',
      'resolution_final',
      'self_change',
      'last_admin',
      'review_final',
      'invalid_state',
      'tag_revoked',
      'payload_too_large',
      'unsupported_media_type',
      'spend_credential_rejected',
      'not_receive_capable',
      'unsafe_lnurl_target',
      'invalid_lightning_address',
      'photo_hash_mismatch',
      'unprocessable',
      'hot_wallet_cap_exceeded',
      'lightning_endpoint_unreachable',
      'exchange_feed_error',
      'provider_misconfigured',
      'stale_exchange_rate',
      'storage_unconfigured',
      'ledger_key_invalid',
      'float_unavailable',
      'internal_error',
      'network',
    ];
    for (const code of codes) {
      expect(get(en as Tree, `Console.errors.${code}`), code).toEqual(expect.any(String));
    }
  });

  it('labels every payout, treasury and collector state', () => {
    for (const state of PAYOUT_STATES) {
      expect(get(en as Tree, `Console.status.payout.${state}`), state).toEqual(expect.any(String));
      expect(get(en as Tree, `Console.payouts.filters.${state}`), state).toEqual(
        expect.any(String),
      );
    }
    for (const state of TOPUP_STATES) {
      expect(get(en as Tree, `Console.status.topup.${state}`), state).toEqual(expect.any(String));
    }
    for (const state of ['active', 'pending', 'revoked']) {
      expect(get(en as Tree, `Console.status.collector.${state}`), state).toEqual(
        expect.any(String),
      );
    }
  });

  it('translates every sync rejection code the server can return', () => {
    const codes = [
      'content_hash_mismatch',
      'invalid_timestamp',
      'collector_not_found',
      'collector_not_authorized',
      'no_rate',
      'rate_mismatch',
      'supervisor_not_assigned',
      'event_not_yours',
      'invalid_event',
      'session_not_found',
      'outside_session_window',
      'future_timestamp',
      'invalid_data',
    ];
    for (const code of codes) {
      expect(get(en as Tree, `Sync.reasons.${code}`), code).toEqual(expect.any(String));
    }
  });

  it('uses no long dashes in the console copy', () => {
    const text = JSON.stringify((en as Tree).Console) + JSON.stringify((en as Tree).Sync);
    expect(text).not.toMatch(/[–—]/);
  });
});
