# Treasury: a shared pool that funds a small hot wallet

How Taka Sats holds the programme's money, who has to agree before it moves, and how payouts to
collectors stay automatic. Written for operators, funders and the stewards who hold keys.

## The idea in one picture

```
  SHARED POOL                          HOT WALLET                      COLLECTORS
  (multisig, M of N keys)  ──vote──►   (small, capped, automated)  ──►  (their own wallets)
  Nobody can move it alone.            Pays collectors after each      Receive only. No account
  Everyone can see the balance.        verified collection.            with us.
```

- The **pool** holds most of the money. Moving it needs several people to sign. Anyone can see its
  balance.
- The **hot wallet** holds only a few days of payouts. The Taka Sats worker pays collectors from it
  automatically, because paying hundreds of small amounts by hand is not workable.
- A **vote** is how the hot wallet gets refilled: the stewards agree on an amount and sign a
  transfer from the pool to the hot wallet. When the hot wallet is empty, payouts wait until the
  next vote. Nothing is lost and nothing is paid twice.

The most a compromised server can lose is what is in the hot wallet. That is why it is kept small.

## Both halves are pluggable

Taka Sats does not depend on any one wallet or provider. Each half is a role that any provider
can fill, provided it meets the requirements in [`providers/README.md`](providers/README.md).

| Role | What it must do | Examples that can fill it |
|---|---|---|
| **Pool** | Hold funds under an M of N multisig. Share a read only view of the balance. Let several signers approve a transfer. | A Bitcoin multisig built with Trezor and Sparrow, Nunchuk, Specter or Casa. A Fedimint federation. |
| **Hot wallet** | Pay a Lightning address or invoice through an authenticated API. Report its balance. Report each payment's result honestly. Accept deposits from the pool. | Blink, LNbits, a Fedimint client wallet |

The code already treats the hot wallet as a plug in (`LightningProvider`, chosen by
`lightning.float_provider`). The pool is described by a contract and workflow here. The vote that
funds the hot wallet from it is built; a read only view of the pool's own balance is not (see
"What exists today").

## Who signs

The signers are **treasury stewards**, not field supervisors. A supervisor records weights, so the
same person should not also approve the money that pays for them. That separation is the whole
point.

- At least three stewards, from at least two organisations, for example Afribit Africa, a
  sponsor and an independent trustee.
- Each steward holds their own hardware key. No one holds two keys.
- Start with 2 of 3. Move to 3 of 5 as the programme and its balance grow.
- Every steward keeps a copy of the wallet's recovery information, so the pool survives any one
  person, device or vendor disappearing.

## How a funding vote works

1. **Proposal.** A steward proposes an amount for a period, for example "enough for two weeks of
   payouts". The treasury view shows the hot wallet balance, the cap and the room under it, the
   proposals already on their way and the payouts waiting for funds, so the vote is informed. (It
   will also show the pool balance once a read only view is configured.) A proposal that would take
   the hot wallet above its cap is refused.
2. **Approval.** Stewards approve in Taka Sats: by default two distinct people, never the one who
   proposed. Each approval is recorded in the ledger with the steward's name. Any steward other than
   the proposer can also reject the proposal, and the proposer can withdraw it.
3. **Signing.** The transfer is prepared and signed in the wallet that holds the pool. This is the
   real control. The funds cannot move without enough valid signatures, whatever any server says.
   Afterwards a steward records the transaction id (or other reference) in Taka Sats. One transfer
   can back only one proposal.
4. **Arrival.** Taka Sats does not take anyone's word that the money arrived. It confirms the
   proposal when the hot wallet's own balance shows the funds (counting what payouts spent in the
   meantime). Payouts waiting for funds then resume at once.
5. **Record.** The proposal, each approval, the transaction id and the result are written to the
   ledger, so a funder can see who agreed to what.

Step 3 is the one that protects the money. Steps 1, 2 and 5 are how the programme stays
accountable and visible.

## What the software does and does not do

| Taka Sats **does** | Taka Sats **never** does |
|---|---|
| Record proposals, approvals and outcomes in the ledger | Hold, see or ask for the pool's signing keys |
| Notice when funds arrive at the hot wallet | Move money out of the pool |
| Refuse a refill that would take the hot wallet above its cap, and warn when it is low | Let one person approve their own proposal |
| Show the pool balance from its public view, once one is configured (not built yet) | Pay from the pool directly to a collector |
| Pay collectors automatically from the hot wallet | Let anyone type in where a payment goes |

## Limits you should know

- **The hot wallet is a single point of failure by design.** Keep it small. If it is a custodial
  service, its operator can freeze it. A small float limits that risk and does not remove it.
- **A refill is a real transaction with a fee.** Refill weekly or monthly, not per payment.
- **Waiting is a feature.** When the hot wallet runs dry, payouts show as waiting for funds. The
  collector's record is safe and the payment is made after the next vote.
- **Stewards must be reachable.** A quorum that cannot meet cannot refill. Plan for holidays and
  lost devices, and rehearse recovery before holding meaningful value. By default a vote needs the
  proposer plus two other stewards, so a programme needs at least three admin accounts held by three
  different people.
- **The software cannot tell who a steward really is.** Stewards are admin accounts. Keep them
  separate from the people who record weights, and give each their own login. Taka Sats stops one
  account approving its own proposal, but it cannot stop one person holding two accounts.
- **Approving in Taka Sats does not move money.** Only enough signatures in the pool wallet do. If
  an approval is recorded here and the transfer is never signed, nothing is lost: the proposal
  stays open until someone cancels or rejects it.
- **Legal status of the hot wallet is the operator's responsibility.** A custodial provider holds
  the float, so check what licences and rules apply where you operate.

## Example setups

| Setup | Pool | Hot wallet | Notes |
|---|---|---|---|
| Pilot, low cost | A 2 of 3 multisig on Trezor devices, coordinated with Sparrow (free and open source) | Blink | The cheapest path that keeps every part open. Verify that your hot wallet provider accepts on chain deposits |
| Easier for non technical stewards | The same pool coordinated in Nunchuk | Blink | A paid app, but friendlier for a group |
| Community federation | A Fedimint federation | A Fedimint client wallet | Guardians hold the pool together. Spending ecash does not need a vote per payment, so confirm what approval features your federation offers |

None of these is a requirement. Anything that meets the provider requirements will work.

## What exists today

| Piece | Status |
|---|---|
| Hot wallet plug in (`LightningProvider`) with Blink, LNbits, Fedimint (not yet implemented) and a demo provider | Built. Blink and LNbits have never been run against a live account |
| Payouts that wait when the hot wallet is short, and resume | Built |
| Float balance and low balance warning for admins | Built |
| Payment results classified so an uncertain payment is never retried blindly | Built |
| Funding proposals, steward approvals (never the proposer, each counted once), rejection and cancellation | Built |
| Recording the pool transfer's reference, and confirming arrival from the hot wallet's own balance | Built |
| The ledger record of every step, and payouts resuming once a refill is confirmed | Built |
| A cap on the hot wallet balance (`treasury.hot_wallet_cap_sats`, off by default) | Built |
| A one call treasury view (hot wallet, cap, proposals in flight, payouts waiting) | Built |
| A read only view of the pool's own balance | **Planned**. The treasury view says "not configured" rather than showing zero |
| A Fedimint hot wallet | **Planned** |

The funding vote is built as a record and a set of checks around a transfer that happens elsewhere.
It has been tested against a demo wallet only. Blink and LNbits have never been run against a live
account, so the arrival check has not been seen against a real balance either.

## Decision record

See [`adr/0020-multisig-pool-funds-a-pluggable-hot-wallet.md`](adr/0020-multisig-pool-funds-a-pluggable-hot-wallet.md).
