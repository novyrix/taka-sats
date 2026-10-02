# ADR-0001: NFC tags are receive-only

**Status:** Accepted (ported from Technical Architecture §9 ADR-001)

## Context

Bolt Cards (NTAG424 DNA + `LNURLw`) are a spend/withdraw primitive - the merchant pulls
funds from the cardholder. Collectors need the reverse: to receive. A drain risk on a
physical object handed to informal workers is unacceptable.

## Decision

Issue static NTAG213/216 tags encoding a Lightning Address / LNURL-pay link. No rolling-code
cryptography - a receive link carries no drain risk if exposed. No code path derives a
withdraw primitive from a tag; BYO enrolment validates the submitted code as receive-capable
and rejects an `LNURLw`.

## Consequences

Tags are cheap (~$0.20-1.00 vs ~$0.90-2.50 for NTAG424), simple to provision in bulk, and
safe to reissue on loss with zero fund-recovery risk. Trade-off: cannot be extended to a
spend use case without a different tag type - acceptable, Taka Sats has no spend requirement.

## Related

REQUIREMENTS §7.2, §16; US-1.2/1.3. Enforced by a receive-only guarantee test.
