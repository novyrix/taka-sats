# Collector tag — hardware spec

| | |
|---|---|
| Status | M1-11 first draft |
| Maps to | FR-1.5, US-1.5, ADR-0001 |

The collector's physical token is the single piece of hardware in this system that touches
someone outside the programme. It has to survive outdoor use with zero maintenance and
carry zero fund-recovery risk if lost.

## Chip

**NTAG213 or NTAG216** (NFC Forum Type 2). Both are read/write, support a static URI
record, and are what encodes the LNURL-pay link / Lightning Address written at enrolment
(ADR-0001 — receive-only, no rolling code, no NTAG424/Bolt Card primitive).

| | NTAG213 | NTAG216 |
|---|---|---|
| User memory | 144 bytes | 888 bytes |
| Typical unit cost | ~$0.20–0.60 | ~$0.40–1.00 |
| Fits our payload? | Yes — an LNURL-pay bech32 string or a short Lightning Address comfortably fits in 144 bytes as a single NDEF URI record | Yes, with headroom |

**Default: NTAG213.** It is cheaper, bulk-provisions faster, and the payload is short.
Move to NTAG216 only if a future payload (e.g. a longer provisioned LNURLp URL) doesn't fit.

## Form factor

**IP67/IP68-rated** (FR-1.5) in one of two shapes, both wearable on a lanyard:

- **PVC card**, credit-card proportions (85.6 × 54 mm) — matches the delivered card art
  (`Initial assets/Taka_Sats_NFC_Tag_Front.png` / `..._Back.png`). Front carries the brand
  mark and the collector's tap affordance; the back states, in plain language, that the tag
  can only *receive* funds and carries no spend risk if lost (Brand Guidelines §—, PRD
  FR-1.1). This is a UX and trust decision, not just a design one — don't reword it away.
- **ABS keyfob** — an alternative for collectors who prefer it clipped to a bag or belt
  rather than carried as a card. Same chip, same back-of-tag language, adapted to the
  keyfob's printable area.

Both need a lanyard/keyring attachment point molded in, not glued on — glued attachments
are the first thing to fail in the field.

## Procurement checklist

- [ ] Confirm NTAG213 vs 216 unit price at the target order quantity (pilot: dozens; scale:
      hundreds) from at least two suppliers.
- [ ] Confirm IP67/68 rating is on the *manufacturer's datasheet* for the specific SKU
      ordered, not inferred from "similar" products.
- [ ] Order a small pilot batch (10–20) before a bulk order; run the durability test below
      on that batch first.
- [ ] Confirm the supplier can pre-print the delivered card art (front) and the back-face
      receive-only text, or that in-house printing/lamination is arranged.
- [ ] Confirm write compatibility with the Web NFC devices supervisors actually carry (gate
      **G2** — tracked separately from procurement).

## Durability test (before a bulk order, and again at M8-11's field test)

Run on the pilot batch: full submersion (simulating rain/washing), a week carried loose in
a pocket with keys/coins (abrasion), and a drop test onto concrete from ~1m. A tag that
fails to read after any of these does not go in the bulk order.

## Lifecycle notes for procurement

- A lost or damaged tag is a **reissue**, not a support incident that needs escalation —
  the collector keeps their earnings history, a supervisor maps a new tag to the same
  `collectors.id` (§7.2–7.3). Order enough spare stock that a reissue never blocks a
  collector from being paid.
- A revoked tag is rejected at the software layer (§7.3); it does not need to be physically
  recovered or destroyed, though recovering it when practical avoids someone finding and
  puzzling over a dead tag.
