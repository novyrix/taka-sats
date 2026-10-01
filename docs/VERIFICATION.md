# Verification protocol

How Taka Sats decides that a collection really happened, that the person was paid the right
amount, and that nobody changed the record afterwards. Written for funders, auditors and
partner organisations. Developers will find the exact behaviour in
[`BACKEND.md`](BACKEND.md), [`LEDGER.md`](LEDGER.md) and
[`THREAT_MODEL.md`](THREAT_MODEL.md).

## The principle

**A physical measurement is the authority. Evidence supports it. Software flags what looks
wrong. People decide. The record cannot be quietly edited. The real world is the final check.**

No single check is trusted on its own. Each layer catches something the others miss, and the
last layer, comparing what we paid for against what the recycler actually received, catches
what the first six cannot.

Status key: **Built** means it works today and is tested. **Partial** means part of it works.
**Planned** means it is designed but not yet built.

## The seven layers

### 1. Who is taking part (Built)

- A collector is **approved by a staff member** before they can be weighed or paid. A
  supervisor can register someone, but only a hub lead or an admin can approve them. The
  approval is recorded in the ledger with the name of the approver.
- A supervisor can only record inside a **session** they are assigned to, during its time
  window.
- A collector's identity is a simple code and an alias. No national ID number is collected.
  A QR code or an NFC tag can carry that code, but it grants nothing and holds no money.

### 2. What was collected (Built, with limits)

For every collection the supervisor records the material, the weight from a physical scale,
a photo, the time, the session, and the GPS position (or a written reason if GPS is not
available).

- The photo should show the material, the scale and the scale's display. The phone computes a
  fingerprint of the photo before it is uploaded, and the server re-computes it. A photo
  that does not match its fingerprint is refused.
- **Weight is entered by hand today.** The record says so (`weight source: manual`). Support
  for connected scales is designed and the field already exists, so a scale reading can be
  recorded as such later without changing the record format.
- Reading the scale display from the photo automatically (OCR) is **Planned**. It will run in
  a "measure only" mode first, so we learn how accurate it is before it is allowed to flag
  anything.

### 3. Sealing the record (Built)

When the supervisor confirms, the phone seals the record with a digital fingerprint of all its
contents. The record is saved on the phone first and sent later, even days later.

When it arrives, the server recomputes the fingerprint and compares. Any difference means the
record was altered, and it is rejected for a human to look at.

The server also checks that:

- the collector is currently approved,
- the supervisor was assigned to that session,
- the time falls inside the session window and is not in the future,
- the rate used is the one that was in force when the weighing happened,
- the weight is within sane limits.

A record that fails a check is **never silently dropped**. It comes back marked "needs
attention" with a reason, so a person can fix the cause. Sending the same record twice never
creates a second one.

### 4. Automatic checks that raise flags (Built)

After a record is accepted, the system looks for patterns that suggest a problem. It only
**flags**; it never blocks a payment by itself. A person reviews each flag.

| Check | What it looks for |
|---|---|
| Duplicate photo | The same photo used for a different collection |
| Repeated weights | A supervisor recording the same weight several times in a row |
| Location | A collection recorded outside the session's area |
| Unusual weight | A weight far outside what is normal for that material |
| Payment concentration | A few collectors receiving most of a session's payments |

Flags go to a review queue. A reviewer marks each one confirmed or dismissed, and a second
reviewer can overturn the decision. The reasons are kept.

### 5. People who must agree (Built)

- **Payments need a second person.** The person who recorded a collection can never approve
  its payment. During the pilot **every** payment waits for approval, and the first payment to
  any new wallet always does.
- A collector's **wallet address** can be set by the supervisor who registered them, only until
  staff approve the collector. After that, only staff can change it. Two collectors cannot
  share one wallet.
- Nobody can type in where a payment goes. The destination is always the collector's verified
  wallet, looked up by the system.
- The amount is calculated once, on the server, in whole satoshis, at the exchange rate on the
  day of payout, using the material rate that applied when the weighing happened.

### 6. A record nobody can quietly change (Built)

Every important fact goes into one **append-only ledger**: collections, payments, staff
approvals, recycler sales. Each entry contains a fingerprint of the one before it, like links in a
chain. Changing or deleting an old entry breaks every later link, and the database itself
refuses edits and deletions.

The programme signs a checkpoint of the ledger at regular intervals. **Anyone** can download the
ledger and a free verification script and check, on their own computer, that nothing was
altered. See [`LEDGER.md`](LEDGER.md).

### 7. Checking against the real world (Built, needs real data)

At the end of a period, staff record what the recycler **actually received** and weighed. The
system compares the total we recorded collecting with the total the recycler accepted. A gap
above the tolerance (5 percent by default) is flagged for investigation. Normal reasons for a
gap, such as moisture or contamination removed, are noted by a person.

This is the check that is hardest to fake, because it depends on someone outside the collection
team. It only works once real recycler receipts are entered, so it needs the pilot to run.

## Verification levels

Each collection carries a confidence level that is kept separate from its payment status.

| Level | Meaning | Status |
|---|---|---|
| V0 | Manual weight, photo, supervisor's record | **Every record today** |
| V1 | V0, plus the scale display read from the photo and agreeing | Planned |
| V2 | A connected scale supplied the weight automatically | Planned |
| V3 | V1 or V2, plus the hub total and the recycler's receipt agree | Partly possible, by period |
| V4 | V3, plus downstream processing evidence and no double counting | Planned |

We state V0 plainly. A report to a funder should say how many records are at each level, not
imply a higher one.

## What this protocol does not prove

Honest limits matter more than a long list of features.

- **A supervisor and a collector working together** could stage a photo and invent a weight.
  Layers 4 and 5 make this harder and more visible. Layer 7 is what catches it at scale.
- **A photo can be staged.** It shows effort and context, not proof of origin.
- **Spot audits are a procedure, not software.** We recommend re-weighing a random sample of
  collections at the hub every week and rotating supervisors between sites. The software
  records the results but does not enforce the audits.
- **The ledger proves a record was not altered after it was written.** It does not prove the
  record was true when written. That is what the physical scale, the photo and the recycler
  comparison are for.

## How a funder or auditor can check this

1. Read the public summary at `/api/v1/stats/summary` for totals with no personal details.
2. Download the ledger and the public key, then run `scripts/verify-ledger.ts` on your own
   machine. Exit code 0 means the chain is intact.
3. Ask for the list of flags raised and how each was resolved.
4. Ask for the reconciliation reports comparing collected and recycler-accepted weight.
5. Visit a collection point and re-weigh a sample.

## Proposed pilot measures

These are proposals for the first pilot, to be agreed with Afribit Africa before it starts, so
success is decided in advance rather than after the results.

- Records accepted without needing attention, as a percentage of all synced.
- Time from weighing to payment.
- Payment success rate and the reasons for failures.
- Flags raised per 100 collections, and the share confirmed after review.
- Difference between recorded and recycler-accepted weight, by material.
- Share of records at each verification level.
