// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Standalone hash-chain verifier (D-19, ROADMAP M4-8).
 *
 * A technical auditor runs this against `GET /api/v1/ledger` output (or a saved
 * export) to confirm the chain links are unbroken and a checkpoint signature is
 * valid. Implemented in M4-8; this is the entry-point stub.
 *
 *   pnpm tsx scripts/verify-ledger.ts <ledger-export.json>
 */

import { NotYetImplemented } from '@/lib/money';

function main(): void {
  throw new NotYetImplemented('scripts/verify-ledger.ts is implemented in M4-8');
}

main();
