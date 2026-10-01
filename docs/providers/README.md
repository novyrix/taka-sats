# Provider requirements

Taka Sats works with any wallet provider that meets these requirements. We do not endorse or
depend on a vendor. If you run a wallet service and want it to work with Taka Sats, this page
tells you exactly what we need. If you operate a programme, it tells you what to ask your
provider.

Two roles exist. See [`../TREASURY.md`](../TREASURY.md) for how they fit together.

## Hot wallet providers

The hot wallet pays collectors automatically. It implements the `LightningProvider` interface in
[`lib/lightning/LightningProvider.ts`](../../lib/lightning/LightningProvider.ts).

### Required

| # | Requirement | Why |
|---|---|---|
| H1 | Pay a Lightning address, an LNURL pay code or a BOLT11 invoice through an authenticated API | Payouts run unattended |
| H2 | A credential that can send payments but cannot change account settings or export keys, ideally with a per payment limit | A leaked key should lose only the float |
| H3 | Report the available balance | Payouts wait when it is short, and admins see it |
| H4 | Report each payment as **succeeded**, **failed** or **pending**, and never report failed for an outcome that might still settle | A wrongly failed payment can be retried and paid twice |
| H5 | Return a transaction id or payment hash usable as proof of payment | The ledger records it |
| H6 | A payment reference we supply (for example a memo) that is searchable afterwards, or a safe duplicate rule | We must be able to confirm whether a payment already went out |
| H7 | A way to receive deposits from the pool: an on chain address, or a Lightning invoice | The pool refills it |
| H8 | Documented fees and limits | Budgeting and pilot planning |

### Helpful

- A test mode, a testnet or a sandbox account.
- Webhooks for payment results.
- Published rate limits and an uptime record.
- The ability to hold several wallets in one account.

### Our side of the bargain

- The destination of every payment is the collector's verified wallet, looked up by us. Your
  API will never receive a destination that a user typed in.
- We check that an invoice's amount equals the amount we asked for before paying it.
- An uncertain payment is held for a person to check, never retried automatically.
- The key is read from the environment, never logged and never sent to a browser.

### Checking a provider yourself

`pnpm provider:check` is the operator tool: it checks credentials, reads the balance, proves a
receive address works and can send one supervised payment of 1 to 100 sats, then reports whether
the answer was classified paid, failed or unknown. See [`../GETTING_STARTED.md`](../GETTING_STARTED.md).
It works against the demo provider too. Your provider page should record the date you ran it and
what you saw.

### Contract tests

A provider is considered supported when it passes the shared checks in `lib/lightning`, including
the receive only rules and the payment outcome classification
([`pay-outcomes.test.ts`](../../lib/lightning/pay-outcomes.test.ts)).

## Pool providers (the multisig)

The pool holds the programme's funds. Taka Sats never holds its keys.

### Required

| # | Requirement | Why |
|---|---|---|
| P1 | M of N multisig, with M of at least 2, where no single person can move funds | The core promise |
| P2 | A standard output descriptor that can be exported as a **read only** view | So the balance can be shown and anyone can audit it |
| P3 | Standard PSBT signing (BIP 174), so any compatible wallet or device can co-sign | No lock in to one app |
| P4 | Support for several independent hardware signers | Stewards keep their own keys |
| P5 | Recovery that does not depend on the vendor | The pool must outlive any company |
| P6 | Fee bumping (RBF) | A stuck refill must be fixable |

### Helpful

- A way to publish the pool address or view key so the public can verify the balance.
- Signer coordination that does not require sending keys over the internet.

### Fedimint as a pool

A Fedimint federation holds funds in a threshold multisig run by its guardians. It can fill the
pool role if it offers a client that can send to Lightning through a gateway. It does not by
itself provide a vote on each spend, so check what approval features your federation offers.

## Provider status

Evidence matters more than claims. This table records what we have actually verified.

| Provider | Role | Status | Last verified |
|---|---|---|---|
| Demo provider | Hot wallet | Built for tests and demos only. It sends nothing and is refused in production unless explicitly allowed | Always |
| [Blink](blink.md) | Hot wallet | Implemented. Request and response shapes checked against Blink's published schema (2 Oct 2026). **Never run against a live account** | Not yet |
| [LNbits](lnbits.md) | Hot wallet | Implemented. Payment shapes checked against the LNbits 1.6 OpenAPI document. **Never run against a live instance** | Not yet |
| Fedimint | Hot wallet | Not implemented | Not applicable |
| Trezor with Sparrow | Pool | Planned. Supports multisig through Sparrow | Not yet |
| Nunchuk | Pool | Planned | Not yet |
| Fedimint federation | Pool | Planned | Not yet |

## Adding a provider

1. Implement the interface and add a test file that covers the requirements above.
2. Add a short page under `docs/providers/` using the template below.
3. Add an entry to the status table with the date you ran it against a real account and what you
   saw.
4. Open a pull request. Nothing in the payout code should need to change.

### Template

```markdown
# <Provider name>

Role: hot wallet | pool
Status: unverified | verified on <date>
Credentials needed: <what the operator must create, and the minimum permissions>
How a payment is reported: <statuses the provider returns and how each is classified>
Deposits: <how the pool funds it>
Fees and limits: <links>
Known quirks: <anything surprising>
Evidence: <how it was tested, with dates>
```
