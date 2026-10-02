# ADR-0017: Cardless identity and the collector authorization gate

**Status:** Accepted (records D-24, D-25). Supersedes the "the tag encodes the Lightning
address" half of ADR-0001; its receive-only guarantee still holds.

## Context

The first design made an NFC tag the collector: the tag carried the Lightning address, and the
tag mapping resolved the payout. Field testing the first wallet partner showed a card need not
be NFC at all - a Paybee card has a Receive QR and a Pay QR and nothing to tap. Meanwhile an
alias-only enrolment with no credential makes "ghost collectors" (invented aliases that point
at a supervisor's own wallet) the cheapest fraud.

## Decision

1. **A collector exists independently of any physical credential** (D-24). Every collector has a
   permanent internal `id` (a client-generatable UUID - it is inside the signed event payload,
   so it never changes) and a server-allocated, human-readable `public_code` (`TS-KBR-0042`).
   Search by alias or code, a QR, and an NFC tag are all *lookup shortcuts into the supervisor's
   cached collector directory*. If every credential disappeared, Taka Sats would still work.
2. **A credential carries identity, never a payment target.** The QR/NFC payload is
   `takasats:<public_code>`. A found card therefore reveals nothing and can pay nobody.
3. **Only authorized collectors may take part** (D-25). A collector is `pending`, `active`
   (= authorized) or `revoked`. A supervisor's registration is `pending`; a `hub_lead` or
   `admin` authorizes it (`collector:authorize`). Only `active` collectors can be weighed (the
   offline cache lists only them; ingest rejects the rest), be issued an NFC tag, or be paid.
   Each decision is a row in `collector_authorizations` anchored in the ledger
   (`entry_type = 'collector_authorization'`). `collectors.authorization_required = false`
   turns the gate off for operators who do not want it.
4. The NFC tag is **issued only to authorized collectors** - the physical credential becomes the
   visible mark of vetting, not the identity itself.

## Consequences

- Ghost-collector fraud now needs a staff member to authorize the ghost.
- `tag_history` stays (it handles revocation by tag serial) but is optional per collector.
- Pre-existing collectors are grandfathered as `active`.
- A pending collector cannot be weighed, so field enrolment is "register now, weigh after
  authorization" - a deliberate friction for the pilot, relaxable by config.

## Related

REQUIREMENTS D-24, D-25, §7; ADR-0001, ADR-0014; `docs/TAKA_SATS_PROTOTYPE_ARCHITECTURE_V2.md`.
