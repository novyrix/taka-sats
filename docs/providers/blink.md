# Blink

Role: hot wallet
Status: unverified. The request and response shapes were checked against Blink's published GraphQL
schema on 2 October 2026. It has never been run against a live account.
Credentials needed: a Blink account with a **BTC wallet**, and an API key with the **Read** and
**Write** scopes (Write sends payments). Do not give it more. Create it in the Blink dashboard
under API keys. The key is set as `BLINK_API_KEY` in the environment, never in a settings file.
The BTC wallet id goes in `lightning.blink.float_wallet_id` (not secret), or in the environment as
`TAKASATS__LIGHTNING__BLINK__FLOAT_WALLET_ID` (the Docker Compose stack passes it through).

## What was checked, and where

Source: the public schema (`core/api/src/graphql/public/schema.graphql`) and the payment resolver in
Blink's open source repository, plus `dev.blink.sv`.

| Item | What we use | Checked |
|---|---|---|
| Endpoint | `https://api.blink.sv/graphql` (staging: `https://api.staging.blink.sv/graphql`) | docs |
| Auth header | `X-API-KEY: blink_...` | docs |
| Key scopes | Read (balance, history), Receive, Write (send payments) | docs |
| Pay mutation | `lnInvoicePaymentSend(input: LnInvoicePaymentInput!)` with `walletId`, `paymentRequest`, optional `memo` | schema |
| Alternatives | `lnAddressPaymentSend`, `lnurlPaymentSend` (both need an `amount`). Not used: we resolve the invoice ourselves so we can refuse one whose amount is not the amount we decided | schema |
| Result | `PaymentSendPayload { status, errors { message code path }, transaction }` | schema |
| Status enum | `SUCCESS`, `FAILURE`, `PENDING`, `ALREADY_PAID` | schema |
| Balance | `me { defaultAccount { walletById(walletId) { balance walletCurrency } } }`. A BTC wallet balance is in sats, a USD wallet balance is in cents | schema |
| Lookup | `walletById(...).transactionsByPaymentHash(paymentHash)` and `transactions(first)` | schema |
| Transaction | `status` (`SUCCESS`, `PENDING`, `FAILURE`), `direction` (`SEND`, `RECEIVE`), `memo`, `settlementFee`, `initiationVia { paymentHash }`, `settlementVia { preImage }`, `createdAt` (Unix seconds) | schema |
| Memo limit | 639 bytes | source |

## How a payment is reported and classified

| Blink says | We record | Why |
|---|---|---|
| `SUCCESS` | **paid**. The reference is the payment hash. If a preimage comes back it must hash to the invoice's payment hash, otherwise the outcome is unknown | The status is the verdict, the preimage is the proof |
| `FAILURE` with only these codes: `INSUFFICIENT_BALANCE`, `ROUTE_FINDING_ERROR`, `INVALID_INPUT`, `INVOICE_DECODE_ERROR`, `CANT_PAY_SELF`, `TRANSACTION_RESTRICTED`, `OPERATION_RESTRICTED`, `NEW_ACCOUNT_WITHDRAWAL_RESTRICTED`, `ENTERED_DUST_AMOUNT`, `NOT_AUTHENTICATED`, `NOT_AUTHORIZED`, `TOO_MANY_REQUEST` | **failed** (may be retried by staff) | These mean nothing was sent |
| `FAILURE` with any other code, or no code | **unknown** | Blink also returns `FAILURE` for internal faults (database, node offline, unexpected error), and those can happen after the payment left the node |
| `PENDING` | **unknown** | It may still settle |
| `ALREADY_PAID` | **unknown** | It says that invoice was paid, not that our payout was |
| A payload with errors and no status | **failed** | Blink rejects invalid input before doing anything |
| HTTP 4xx (not 408, 429) | **failed** | The request was rejected |
| HTTP 5xx, 408, 429, timeout, lost connection, unreadable answer | **unknown** | The request may have been processed |
| A top level GraphQL error such as `GRAPHQL_VALIDATION_FAILED` or `UNAUTHENTICATED` | **failed** | Rejected before execution |
| Any other top level GraphQL error on the payment call | **unknown** | |

An unknown outcome keeps the payment hash on the payout (`providerPaymentRef`), is flagged for an
admin, and is never retried automatically. The admin can ask Blink what happened with the payout
check tool (see [`../BACKEND.md`](../BACKEND.md), payouts) and then resolve it.

Blink has no idempotency key for sends. Our protection against paying twice is: claim the payout
before calling Blink, never retry an unknown outcome, and look the payment up by its hash before
resolving it. The memo carries the payout id, so a payment can also be found by scanning the
wallet's recent transactions for it.

Fees: the routing fee comes back as `transaction.settlementFee` (sats) and is recorded. Payments
to another Blink user and to nodes with a direct channel are free. Limits depend on the account
level and are shown in the Blink app.

## Known quirks

- Paying an invoice that belongs to the **same wallet** you pay from is refused (`CANT_PAY_SELF`, classified
  failed). For the first supervised test, use a receive address on a different wallet or account.
- Blink to Blink payments settle inside Blink (no routing, no fee, often an intra ledger settlement). The result
  still carries the payment hash; the preimage may or may not be present.
- A USD wallet cannot be the float: its balance is in cents. `provider:check` and the app refuse it.

## Deposits

The pool funds the wallet by sending bitcoin to a Blink on chain address, or by paying a Lightning
invoice created in the Blink app. The recorded treasury transfer is the audit trail; the app does
not move pool funds.

## Not verified yet (do these before real money)

Run `pnpm provider:check` (see [`../GETTING_STARTED.md`](../GETTING_STARTED.md)) with a real key.
Until that has been done and recorded below, assume any of these can still differ:

1. The balance query and the BTC wallet id against a real account.
2. A real 1 sat payment: the status returned, that `settlementFee` and the preimage are filled, and
   that the payment hash we compute from the invoice equals the one Blink reports.
3. That the memo appears on the sent transaction, so the memo scan works.
4. The exact error codes Blink returns for an empty wallet and an unroutable invoice.
5. Rate limits under a burst of payouts.

## Evidence

| Date | What | Result |
|---|---|---|
| 2 Oct 2026 | Schema and resolver review, unit tests with documented response shapes | Passed. No live account |
| 2 Oct 2026 | All five GraphQL documents we send (pay, balance, wallets, lookup by hash, recent transactions) validated with graphql-js against the public schema from Blink's repository (`main`) | 0 errors. Proves the query shapes, not the live behaviour |
