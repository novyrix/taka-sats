# ADR-0018: Payment destinations are records; spend credentials are never accepted

**Status:** Accepted (records D-26)

## Context

Payout destinations lived as a single `lightning_address` column on the collector, written at
enrolment and overwritten on change - no history, no way to say "this was validated", and no
defence against two collectors sharing one wallet. Separately, a wallet partner's physical card
showed that a scanned QR can be a *spend* credential: the Paybee card's Pay QR is
`https://card.paybee.buzz/<username>`, a page that moves the card holder's money, and the
username is the same as the Receive address's.

## Decision

1. A collector's payout target is a row in `collector_payment_destinations` (`lightning_address`
   or `lnurl_pay`), with a status (`pending_validation` → `verified` | `invalid`, or `revoked`),
   at most one *live* destination per collector (that destination is the primary), and an
   address that is **unique across live destinations** - two collectors cannot share a wallet.
2. The payout destination is **always the collector's primary verified destination, resolved
   server-side** - never request input (this restates D-22/§12.3 without the tag).
3. The first destination may be set by the registering supervisor; **replacing** a verified
   destination needs `collector:authorize` (hub_lead/admin) and revokes the old one in the same
   transaction. A destination change is the cleanest way to redirect money, so it is staff-only.
4. **Spend links are rejected before any network call**: hosts in `lightning.spend_link_hosts`
   (default `card.paybee.buzz`) raise `spend_credential_rejected`; the payload is never stored,
   logged, echoed, or converted into the matching receive address. All LNURL fetches are
   SSRF-guarded (https only, no private/loopback targets, timeouts, size cap, no redirects).
5. Validation that fails *transiently* (the wallet host is unreachable) stores the destination
   `pending_validation` and retries in a background job; a *definitive* failure is a 422. A
   payout never runs against a destination that is not `verified`.
6. `collectors.lightning_address` stays as a denormalised copy of the primary destination
   (the same pattern as `nfc_tag_id`) so existing readers and the provisioning job keep working.

## Consequences

A wallet provider is a data attribute (`provider_hint`, derived from config), not code: Paybee,
Blink and Fedi addresses all follow the same path. Destination history is auditable. Supervisors
must scan the Receive side of a card; scanning Pay yields a clear, safe rejection.

## Related

REQUIREMENTS D-26, §7, §12.3; ADR-0001, ADR-0013, ADR-0016; `docs/THREAT_MODEL.md`.
