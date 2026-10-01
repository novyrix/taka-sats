# ADR-0020: A multisig pool funds a capped, pluggable hot wallet

**Status:** Accepted (records D-28). Extends [ADR-0003](0003-pluggable-lightning-provider.md); does not replace it.

## Context

Payouts are many and small, so they must be automatic. A wallet that pays automatically has to
hold a key on a server, which means it must hold little. Meanwhile the programme's money should
not be movable by one person. ADR-0003 already chose a two tier treasury (a cold reserve and a
small float). Operators now want the shape stated in provider neutral terms, so that any
multisig tool and any hot wallet can be used, and so that a provider knows what is expected of it.

## Decision

1. **Two roles, both pluggable.**
   - The **pool** is an M of N multisig held by treasury stewards. Taka Sats never holds,
     sees or asks for its signing keys.
   - The **hot wallet** is a Lightning wallet behind the `LightningProvider` interface. It holds a
     capped float and pays collectors automatically.
2. **The pool funds the hot wallet by a recorded vote.** A steward proposes an amount, stewards
   approve, the transfer is signed in the pool's own wallet, and the arrival is recorded. The
   signatures in the pool wallet are the real control. Approvals recorded in Taka Sats are the
   accountable, visible record, written to the ledger.
3. **Stewards are not field supervisors.** The people who sign for money are not the people who
   record weights. One person cannot approve their own proposal.
4. **Taka Sats never moves pool funds.** It reads a watch only view for the balance and records
   outcomes. No payout path reaches the pool.
5. **The hot wallet is capped.** When it is short, payouts wait in `pending_float` and resume
   once it is refilled. A compromised server can lose at most the float.
6. **Providers are named by requirements, not by brand.** Requirements for both roles are
   published in [`docs/providers/README.md`](../providers/README.md). A provider is supported when
   it meets them and its evidence is recorded in the provider status table.
7. **No vendor is required.** Blink, Sparrow with Trezor, Nunchuk and Fedimint are examples,
   listed in [`docs/TREASURY.md`](../TREASURY.md), not dependencies.

## Consequences

- The hot wallet interface exists and payouts already wait for float. The pool side (balance
  view, proposals, approvals, ledger record, hot wallet cap) is not built. It is roadmap item M5-7.
- A custodial hot wallet can freeze its balance. The cap bounds the harm and the requirements
  ask providers to disclose custody and limits.
- Refills cost an on chain or Lightning fee, so they happen weekly or monthly, not per payment.
- Provider claims are weaker than evidence. The status table records only what has been run
  against a real account, and today no live provider has been.
- A new provider needs a documentation page and tests, not changes to payout code.

## Alternatives considered

- **Pay collectors straight from the multisig.** Rejected: every payout would need signatures.
- **One large custodial float.** Rejected: one compromised server or one frozen account loses
  everything.
- **Pick one vendor for each role.** Rejected: open source programmes in other places must be
  able to use what is available and lawful to them.
