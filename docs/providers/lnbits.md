# LNbits

Role: hot wallet (optional, self hosted)
Status: unverified. Checked against the LNbits 1.6 OpenAPI document on 2 October 2026. Never run
against a live instance.
Credentials needed: the **admin key** of the float wallet (`LNBITS_ADMIN_KEY`, environment only).
Per collector wallet provisioning also needs the usermanager extension key and is a separate,
gated feature.

## What was checked

From `/openapi.json` of LNbits 1.6.1 (a public demo instance):

| Item | Value |
|---|---|
| Pay | `POST /api/v1/payments` with `{ out: true, bolt11, memo }` and header `X-Api-Key`. Answers **201** with a `Payment` |
| Payment fields | `payment_hash`, `status` (`pending`, `success`, `failed`), `amount` and `fee` in **millisatoshis**, `preimage`, `memo` (max 640) |
| Errors | 400 invalid invoice, 401 key, 520 "Payment or Invoice error" |
| Balance | `GET /api/v1/wallet` returns `balance` in msat |
| Lookup | `GET /api/v1/payments/{payment_hash}` (response shape is not described by the schema; we read `status` or the older `paid` flag) |

## How a payment is classified

| LNbits says | We record |
|---|---|
| 201 with `status: success` | **paid**, reference is the payment hash |
| 201 with `status: pending`, or no status | **unknown**. A 201 is not proof of payment |
| 201 with `status: failed` | **failed** |
| HTTP 4xx (not 408, 429) | **failed** |
| HTTP 5xx including 520, 408, 429, timeout, lost connection | **unknown** |

An unknown outcome keeps the payment hash on the payout. LNbits cannot be searched by our memo
through the API we use, so the check tool needs that hash.

## Not verified yet

A live 1 sat payment, whether the fee is reported as a negative msat number, the exact shape of
the lookup answer, and the usermanager and lnurlp provisioning calls.

## Evidence

| Date | What | Result |
|---|---|---|
| 2 Oct 2026 | OpenAPI review and unit tests with documented shapes | Passed. No live instance |
