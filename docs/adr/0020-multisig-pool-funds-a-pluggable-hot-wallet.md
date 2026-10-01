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

- The hot wallet interface exists and payouts already wait for float. The funding vote (proposals,
  approvals, ledger record, hot wallet cap, arrival check) is built as milestone item M5-7, see the
  addendum below. A read only balance view of the pool is not.
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

## Addendum: how the vote is recorded (M5-7)

Decisions taken when the funding vote was built. They refine the decision above and do not change it.

1. **Roles.** The three steward scopes (`treasury:read`, `treasury:propose`, `treasury:approve`) are held
   by `admin` only. `hub_lead` holds none: it is a field side role that authorizes collectors and approves
   payouts, so giving it the funding vote would let the people who vet collectors also approve the money
   that pays them. Programmes need at least three admin accounts held by three different people (the
   proposer and two approvers), or must lower `treasury.topup_approvals_required`.
2. **The approval rule is enforced twice.** `lib/treasury` refuses the proposer, and a database trigger
   on `treasury_topup_signoffs` refuses a proposer, or an approval on a proposal that is not `proposed`,
   even if the code is bypassed. Approvals are append only rows with `UNIQUE (topup, approver)`, so one
   person counts once. `approvals_required` is copied onto the proposal, so a later config change cannot
   weaken a vote already in flight.
3. **Any other steward can veto.** A single `reject` by a steward who is not the proposer ends the
   proposal. It can only stop money from moving, and a new proposal can follow. The proposer withdraws
   with `cancel`. Neither is possible once a transfer is recorded.
4. **The cap counts money on its way.** A proposal is refused when `float + funding in flight + amount`
   would exceed `treasury.hot_wallet_cap_sats` (0 means no cap). If a cap is set and the float cannot be
   read the proposal is refused: nothing is guessed. Proposals serialise on a lock so two at once cannot
   beat the cap.
5. **Arrival is judged by the rail, not by a person.** A steward records the pool transfer's reference
   (unique, so one transfer funds one proposal). The proposal is confirmed when the hot wallet balance,
   plus what payouts started since a baseline, is at least the baseline plus the amount. The baseline
   is read when the quorum is reached (or when the transfer is recorded if that read failed). The
   worker repeats the check on the payout sweep schedule and wakes payouts parked in `pending_float`
   through the existing sweep. This is evidence, not proof: the real control stays the signatures in
   the pool wallet.
6. **Every step is on the ledger.** Proposal, each approval, transfer recorded, confirmation, rejection
   and cancellation each append a `treasury_topup` entry in the same transaction as the row change. The
   entry type already existed, so no ledger change was needed.
7. **Residual risks.** One person holding two admin accounts defeats the distinct approver rule.
   Approvals recorded here and signatures in the pool wallet are separate: nothing links them
   cryptographically yet, so a funder should compare the recorded transfer reference with the pool
   wallet. The pool balance is not read.
