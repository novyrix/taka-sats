# Taka Sats — User Stories

**Waste-to-Bitcoin Earn-First Programme**
Afribit Africa

Version 1.0 — Companion to the Taka Sats PRD and Brand Guidelines

---

## How to Use This Document

Every story below traces back to a numbered functional requirement in the Taka Sats PRD (`FR-x.y`). Nothing here is invented independently of that document — this is the PRD translated into units small enough to build, estimate, and test one at a time.

**Format.** Each story follows the standard shape: *As a [persona], I want [goal], so that [benefit]*, followed by acceptance criteria written in Given/When/Then form, a priority, and its source requirement.

**Priority key**, aligned to the PRD's three-phase rollout:
- **Must (P1)** — required for the Phase 1 pilot to function at all
- **Should (P2)** — required to advance to Phase 2 (harden)
- **Could (P3)** — Phase 3 scale/exploration, not required for grant-readiness

**Personas used below** (full profiles in the PRD, Section 4): **Amina** (collector), **Brian** (supervisor), **Ronnie/Eddie** (admin), **Partner** (Trezor/Blink/Fedi rep), **Funder** (HRF/OpenSats reviewer).

A traceability matrix mapping every story back to its requirement and phase is at the end of this document (Section 10).

---

## 1. Epic: Collector Identity and NFC Tags
*Traces to PRD Section 6.1*

### US-1.1 — Enroll without documentation
**As** Amina (a prospective collector), **I want** to be enrolled in Taka Sats using only my name, **so that** I can start earning without needing an ID document I don't have.

*Acceptance criteria:*
- **Given** a new collector has no ID or phone, **when** a supervisor enrolls them with just a name or chosen alias, **then** the system creates a valid collector record with no ID field required.
- **Given** enrollment is complete, **when** the supervisor requests a tag, **then** a physical NFC tag is mapped to that collector record within the same session.

Priority: **Must (P1)** · Maps to: FR-1.1, FR-1.2

### US-1.2 — Receive payment by tapping a tag
**As** Amina, **I want** to simply tap my tag to receive payment, **so that** I don't need to read, type, or own a smartphone to get paid.

*Acceptance criteria:*
- **Given** my tag is enrolled, **when** a supervisor taps it against their phone during a verified weighing, **then** my collector record resolves correctly with no manual lookup needed.
- **Given** the tag is tapped, **when** I later receive a payout, **then** it arrives at the Lightning Address encoded on my tag with no further action from me.

Priority: **Must (P1)** · Maps to: FR-1.1

### US-1.3 — Replace a lost or damaged tag with no fund risk
**As** Amina, **I want** to get a new tag if mine is lost or breaks, **so that** I don't lose access to money I've already earned or will earn.

*Acceptance criteria:*
- **Given** my tag is lost, **when** a supervisor issues me a replacement, **then** it is mapped to my existing collector record and my earnings history is unaffected.
- **Given** a tag is receive-only, **when** someone else finds my lost tag, **then** they cannot spend, withdraw, or access any funds using it — the tag only allows sending money *to* the associated wallet, never *from* it.

Priority: **Must (P1)** · Maps to: FR-1.3

### US-1.4 — Revoke a tag on exit or suspected fraud
**As** Ronnie (admin), **I want** to revoke a collector's tag mapping, **so that** a departed or suspected-fraudulent collector's tag can no longer be used without affecting anyone else.

*Acceptance criteria:*
- **Given** a tag mapping is revoked in the admin dashboard, **when** that physical tag is subsequently tapped, **then** the system rejects it and logs the attempt.
- **Given** a revocation occurs, **when** any other collector's tag is checked, **then** it continues to function normally.

Priority: **Should (P2)** · Maps to: FR-1.4

### US-1.5 — Issue tags that survive real outdoor conditions
**As** Ronnie (admin), **I want** the physical tags we procure to survive rain, dust, and daily wear on a lanyard, **so that** collectors aren't showing up with unreadable tags a few weeks into the programme.

*Acceptance criteria:*
- **Given** a tag procurement decision, **when** a vendor is selected, **then** the chosen form factor is rated IP67 or IP68 and specified as a PVC card or ABS keyfob, not a paper sticker.
- **Given** a batch of tags is issued, **when** field-tested for two weeks under normal collector use, **then** none fail due to water, dust, or physical wear under normal conditions.

Priority: **Must (P1)** · Maps to: FR-1.5

---

## 2. Epic: Weighing and Collection Workflow
*Traces to PRD Section 6.2*

### US-2.1 — Record a collection event end to end
**As** Brian (supervisor), **I want** to record a full collection event — tap, material, weight, photo — in one continuous flow, **so that** I can process a queue of collectors quickly during a busy session.

*Acceptance criteria:*
- **Given** a collector has arrived, **when** I tap their tag, select a material type, enter a weight, and capture a photo, **then** the system computes sats owed automatically from the current rate table.
- **Given** all four steps are complete, **when** I confirm the event, **then** it is saved locally immediately, with no dependency on network connectivity.

Priority: **Must (P1)** · Maps to: FR-2.1, FR-2.4

### US-2.2 — Support multiple material types at different rates
**As** Ronnie (admin), **I want** to configure different per-kg sat rates for different material types, **so that** payment reflects the true recycling value of what's collected (e.g. plastics vs. metal).

*Acceptance criteria:*
- **Given** the admin dashboard, **when** I add or edit a material type and its rate, **then** it becomes immediately selectable in the supervisor app for new events.
- **Given** a rate change, **when** past events are viewed, **then** they retain the rate that was active at the time they were recorded, not the current rate.

Priority: **Must (P1)** · Maps to: FR-2.2

### US-2.3 — Capture complete evidence automatically
**As** Brian, **I want** the system to automatically attach timestamp and GPS data to every event I record, **so that** I don't have to remember to do it manually and the record is trustworthy by default.

*Acceptance criteria:*
- **Given** a collection event is being recorded, **when** I save it, **then** timestamp, GPS coordinates, and my supervisor ID are attached without any extra action on my part.
- **Given** GPS is unavailable at the moment of capture, **when** I try to save, **then** the app clearly warns me before allowing the event to save without location data.

Priority: **Must (P1)** · Maps to: FR-2.3

---

## 3. Epic: Fraud Prevention
*Traces to PRD Section 6.3 — the most safety-critical epic in the system*

### US-3.1 — Supervisors cannot move treasury funds
**As** Ronnie (admin), **I want** supervisors to have zero ability to direct payouts to any wallet, including their own, **so that** the person weighing waste can never be the person who benefits from lying about it.

*Acceptance criteria:*
- **Given** the supervisor app, **when** I look for any function that sends funds directly, **then** none exists — payout execution is a system function, never a supervisor-facing action.
- **Given** a supervisor's own Lightning Address, **when** it is checked against the collector wallet list, **then** the system prevents it from ever being registered as a collector payout destination.

Priority: **Must (P1)** · Maps to: FR-3.1

### US-3.2 — Require a second sign-off on large payouts
**As** Ronnie, **I want** payouts above a threshold I set to require a second person's approval, **so that** no single person — supervisor or admin — can authorize an unusually large payment alone.

*Acceptance criteria:*
- **Given** a payout threshold is configured, **when** a collection event's computed payout exceeds it, **then** the event is held in a pending state until a second, different user approves it.
- **Given** a pending second-approval event, **when** the same user who submitted it attempts to approve it, **then** the system rejects the self-approval.

Priority: **Should (P2)** · Maps to: FR-3.2

### US-3.3 — Maintain a tamper-evident record of everything
**As** a Funder (HRF/OpenSats reviewer), **I want** every collection and payout event to be part of an append-only, signed ledger, **so that** I can trust that historical records haven't been quietly edited to hide fraud.

*Acceptance criteria:*
- **Given** any collection or payout event is created, **when** I attempt to edit or delete it directly, **then** the system refuses — a correction can only be made by adding a new, linked record.
- **Given** the ledger, **when** any record is inspected, **then** its cryptographic signature can be independently verified against its content.

Priority: **Should (P2)** · Maps to: FR-3.3

### US-3.4 — Publish public, privacy-respecting proof of activity
**As** a Partner (Trezor/Blink/Fedi), **I want** to see publicly verifiable proof that collections actually happened, **so that** I can trust the impact data without needing to trust Afribit's word alone.

*Acceptance criteria:*
- **Given** a collection event is verified, **when** it is published as a Nostr attestation, **then** the event's authenticity can be independently checked by anyone, without revealing the collector's identity or (where configured) the exact amount paid.
- **Given** a published attestation, **when** its signature is verified by a third party, **then** any tampering with the original data is detectable.

Priority: **Should (P2)** · Maps to: FR-3.4

### US-3.5 — Reconcile paid weight against sold weight
**As** Ronnie, **I want** to see a report comparing total kg paid for against total kg actually sold to recyclers, **so that** I can catch inflated weights or phantom collectors before they become a pattern.

*Acceptance criteria:*
- **Given** a date range and material type, **when** I run a reconciliation report, **then** it shows paid-kg vs. sold-kg with the variance clearly highlighted.
- **Given** variance exceeds a configurable tolerance, **when** the report is generated, **then** it is flagged for review rather than silently accepted.

Priority: **Should (P2)** · Maps to: FR-3.5

### US-3.6 — Surface unusual activity automatically
**As** Ronnie, **I want** the system to flag statistically unusual patterns — repeated identical weights, activity concentrated on a few collectors, off-hours events — **so that** I don't have to manually scan every record looking for problems.

*Acceptance criteria:*
- **Given** a session's data, **when** an anomaly pattern is detected, **then** it appears in an admin review queue with enough context to investigate quickly.
- **Given** a flagged anomaly, **when** an admin reviews and dismisses or confirms it, **then** that decision is itself logged for future audit.

Priority: **Should (P2)** · Maps to: FR-3.6

### US-3.7 — Rotate supervisors and track who verified what
**As** Ronnie, **I want** to schedule supervisor rotation and see a full audit trail of which supervisor verified which events, **so that** stable collusion relationships are harder to form and spot audits have a clear trail to follow.

*Acceptance criteria:*
- **Given** a rotation schedule, **when** it's configured, **then** the supervisor assignment for future sessions reflects it automatically.
- **Given** any historical event, **when** I look it up, **then** I can see exactly which supervisor verified it, with no ambiguity.

Priority: **Should (P2)** · Maps to: FR-3.7

---

## 4. Epic: Offline Sync
*Traces to PRD Section 6.4*

### US-4.1 — Work with zero connectivity
**As** Brian, **I want** every core action in the supervisor app to work with no internet connection, **so that** Kibera's intermittent connectivity never stops me from processing collectors.

*Acceptance criteria:*
- **Given** the device has no network connection, **when** I tap, weigh, photograph, and sign off on an event, **then** every step completes successfully using local storage only.
- **Given** the app is fully offline, **when** I open it, **then** it loads and is usable — it does not require a network call just to start.

Priority: **Must (P1)** · Maps to: FR-4.1

### US-4.2 — Sync without losing or duplicating data
**As** Brian, **I want** my queued offline events to sync automatically and correctly when I regain connectivity, **so that** nothing I recorded is ever lost or accidentally recorded twice.

*Acceptance criteria:*
- **Given** several events were recorded offline, **when** connectivity returns, **then** all events sync to the backend exactly once each, with no duplicates and no drops.
- **Given** a sync is interrupted partway through, **when** connectivity returns again, **then** the sync resumes correctly from where it left off.

Priority: **Must (P1)** · Maps to: FR-4.2

### US-4.3 — See sync status at all times
**As** Brian, **I want** to see clearly whether each event is queued, syncing, or confirmed, **so that** I know whether my work has actually reached the system or is still waiting.

*Acceptance criteria:*
- **Given** an event has just been recorded offline, **when** I view it, **then** it's clearly marked as "queued."
- **Given** connectivity returns and sync begins, **when** I view the event, **then** its status updates to "syncing" and then "confirmed" without me needing to refresh manually.

Priority: **Must (P1)** · Maps to: FR-4.3

---

## 5. Epic: Waste Mapping
*Traces to PRD Section 6.5*

### US-5.1 — Build a collection map as a byproduct of normal use
**As** Ronnie, **I want** every collection event's location to automatically contribute to a map of collection activity, **so that** I get spatial insight without asking supervisors to do any extra mapping work.

*Acceptance criteria:*
- **Given** collection events with GPS data, **when** I open the admin map view, **then** I see collection points plotted on an OpenStreetMap base layer with no manual data entry required.
- **Given** enough events in one area, **when** I view the map, **then** hotspot density is visually distinguishable from sparse areas.

Priority: **Could (P3)** · Maps to: FR-5.1, FR-5.2

---

## 6. Epic: Supervisor Scheduling
*Traces to PRD Section 6.6*

### US-6.1 — Schedule and assign supervisor shifts
**As** Ronnie, **I want** to create sessions and assign supervisors to them in advance, **so that** every planned session has clear, known coverage.

*Acceptance criteria:*
- **Given** a new session, **when** I assign one or more supervisors to it, **then** only those supervisors can access the supervisor app during that session's active window.

Priority: **Must (P1)** · Maps to: FR-6.1

### US-6.2 — Get warned about coverage gaps
**As** Ronnie, **I want** to be alerted if a scheduled session has no assigned supervisor, **so that** I can fix the gap before the session starts rather than discovering it live.

*Acceptance criteria:*
- **Given** a session is scheduled within a configurable lead time and has no assigned supervisor, **when** that threshold is reached, **then** I receive a clear alert in the admin dashboard.

Priority: **Should (P2)** · Maps to: FR-6.2

### US-6.3 — Let collectors log activity when no supervisor is present
**As** Amina, **I want** to be able to log a provisional record of my collection even if no supervisor is at the drop point, **so that** I'm not turned away and my effort isn't wasted just because of a coverage gap.

*Acceptance criteria:*
- **Given** no supervisor is currently active at a location, **when** I use a self-serve drop point, **then** I can log a photo and estimated weight as a "pending" record.
- **Given** a pending record exists, **when** a supervisor later reviews and verifies it, **then** it becomes eligible for payout — it is never paid automatically without that verification step.

Priority: **Should (P2)** · Maps to: FR-6.3

---

## 7. Epic: Treasury and Payouts
*Traces to PRD Section 6.7*

### US-7.1 — Keep the bulk of funds in cold, multisig storage
**As** Ronnie, **I want** the majority of programme funds held in a multisig cold reserve, **so that** no single compromised device or person can move the bulk of Taka Sats' treasury.

*Acceptance criteria:*
- **Given** the treasury architecture, **when** the cold reserve is accessed, **then** it requires signatures from more than one independent key holder.
- **Given** the hot operating float, **when** its balance is checked, **then** it reflects only a small, configurable number of days of expected payouts — never the full treasury.

Priority: **Should (P2)** · Maps to: FR-7.1

### US-7.2 — Get alerted before the operating float runs dry
**As** Ronnie, **I want** an automatic alert when the hot float drops below a set threshold, **so that** I can top it up before collectors are ever left unable to be paid.

*Acceptance criteria:*
- **Given** a low-balance threshold is configured, **when** the hot float crosses it, **then** I receive an alert in the admin dashboard.
- **Given** an alert has fired, **when** I initiate a top-up from the cold reserve, **then** the hot float updates once the transaction confirms.

Priority: **Should (P2)** · Maps to: FR-7.2

### US-7.3 — Get paid in sats, priced fairly regardless of Bitcoin's volatility
**As** Amina, **I want** my payout to reflect a stable, fair value for my work even if Bitcoin's price moves, **so that** my effective wage doesn't secretly shrink because of market conditions I have no control over.

*Acceptance criteria:*
- **Given** a collection event's payout is computed, **when** it's converted to sats, **then** the conversion uses the live exchange rate at the moment of disbursement, applied to a stable fiat-equivalent value set by rate configuration.
- **Given** a payout has been sent, **when** I check my wallet, **then** the amount matches what I was told I'd receive, in sats, based on that rate.

Priority: **Must (P1)** · Maps to: FR-7.3

### US-7.4 — Never silently lose an earned payout
**As** Amina, **I want** my earned payout to be honored even if the programme's funds are temporarily low, **so that** I never do work and simply never get paid with no explanation.

*Acceptance criteria:*
- **Given** the operating pool is depleted at the moment of a verified collection, **when** the payout would normally execute, **then** it instead accrues as a visible "pending payout" rather than failing silently.
- **Given** a pending payout exists, **when** the pool is topped up, **then** the payout executes without requiring the collection to be re-verified.

Priority: **Should (P2)** · Maps to: FR-7.4

### US-7.5 — See treasury health at a glance
**As** Ronnie, **I want** a real-time view of hot balance, cold reserve, and pending payouts, **so that** I always know the true financial state of the programme without having to calculate it manually.

*Acceptance criteria:*
- **Given** the admin dashboard, **when** I view the treasury panel, **then** hot balance, cold reserve, and total pending payouts are all visible on one screen, current as of the last sync.

Priority: **Should (P2)** · Maps to: FR-7.5

---

## 8. Epic: Admin Dashboard
*Traces to PRD Section 6.8*

### US-8.1 — Configure and launch a session
**As** Ronnie, **I want** to create a session with its rate table, supervisors, and location in one workflow, **so that** setting up a day of collection doesn't require touching multiple disconnected tools.

*Acceptance criteria:*
- **Given** the "New Session" flow, **when** I set per-kg rates, assign supervisors, and define the geographic scope, **then** the session is fully ready for its scheduled window with no further configuration needed.

Priority: **Must (P1)** · Maps to: FR-8.1

### US-8.2 — Monitor a session as it happens
**As** Ronnie, **I want** to see collectors verified, kg collected, and sats disbursed updating live during an active session, **so that** I have real-time visibility instead of waiting for an end-of-day report.

*Acceptance criteria:*
- **Given** a session is active, **when** I open its live view, **then** verified-collector count, kg collected, and sats disbursed update as events sync in, without a manual page refresh.
- **Given** an anomaly is flagged during the session, **when** I'm viewing the live session, **then** it appears immediately alongside the other live metrics.

Priority: **Should (P2)** · Maps to: FR-8.2

### US-8.3 — Generate a report for a specific partner
**As** Ronnie, **I want** to generate a clean report scoped to a specific partner's sponsored sessions, **so that** I can share credible impact data with Trezor, Blink, or Fedi without manually compiling it each time.

*Acceptance criteria:*
- **Given** a partner and a date range, **when** I generate a report, **then** it includes only aggregate, pseudonymized data relevant to that partner's sponsored sessions.
- **Given** a generated report, **when** I export it, **then** it uses the same branded document rendering already established for Afribit's other documents — consistent fonts, layout, and no manual formatting work.

Priority: **Should (P2)** · Maps to: FR-8.3

---

## 9. Epic: Partner and Funder Reporting
*Traces to PRD Section 6.9*

### US-9.1 — See aggregate impact without accessing collector PII
**As** a Partner (Trezor/Blink/Fedi), **I want** a read-only dashboard scoped to the sessions I sponsor, **so that** I can track the impact of my support without ever seeing individually identifiable collector data.

*Acceptance criteria:*
- **Given** my partner account, **when** I log in, **then** I see only sessions tagged to my sponsorship, and only aggregate figures — no collector names, phone numbers, or individual payout amounts.
- **Given** my scoped view, **when** I attempt to access any session not tagged to my sponsorship, **then** access is denied.

Priority: **Should (P2)** · Maps to: FR-9.1

### US-9.2 — Access an open, credible dataset
**As** a Funder (HRF/OpenSats reviewer), **I want** to access an open, pseudonymized dataset of programme activity, **so that** I can independently verify Taka Sats' impact claims rather than taking them on faith.

*Acceptance criteria:*
- **Given** the published open dataset, **when** I inspect it, **then** it includes kg collected, sats paid, retention figures, and reconciliation status, with no collector-identifying information included.
- **Given** the dataset is updated, **when** I check its version history, **then** changes are tracked, not silently overwritten.

Priority: **Could (P3)** · Maps to: FR-9.2

---

## 10. Traceability Matrix

| Story | Epic | Requirement | Phase |
|---|---|---|---|
| US-1.1 | Collector Identity | FR-1.1, FR-1.2 | P1 |
| US-1.2 | Collector Identity | FR-1.1 | P1 |
| US-1.3 | Collector Identity | FR-1.3 | P1 |
| US-1.4 | Collector Identity | FR-1.4 | P2 |
| US-1.5 | Collector Identity | FR-1.5 | P1 |
| US-2.1 | Weighing Workflow | FR-2.1, FR-2.4 | P1 |
| US-2.2 | Weighing Workflow | FR-2.2 | P1 |
| US-2.3 | Weighing Workflow | FR-2.3 | P1 |
| US-3.1 | Fraud Prevention | FR-3.1 | P1 |
| US-3.2 | Fraud Prevention | FR-3.2 | P2 |
| US-3.3 | Fraud Prevention | FR-3.3 | P2 |
| US-3.4 | Fraud Prevention | FR-3.4 | P2 |
| US-3.5 | Fraud Prevention | FR-3.5 | P2 |
| US-3.6 | Fraud Prevention | FR-3.6 | P2 |
| US-3.7 | Fraud Prevention | FR-3.7 | P2 |
| US-4.1 | Offline Sync | FR-4.1 | P1 |
| US-4.2 | Offline Sync | FR-4.2 | P1 |
| US-4.3 | Offline Sync | FR-4.3 | P1 |
| US-5.1 | Waste Mapping | FR-5.1, FR-5.2 | P3 |
| US-6.1 | Scheduling | FR-6.1 | P1 |
| US-6.2 | Scheduling | FR-6.2 | P2 |
| US-6.3 | Scheduling | FR-6.3 | P2 |
| US-7.1 | Treasury | FR-7.1 | P2 |
| US-7.2 | Treasury | FR-7.2 | P2 |
| US-7.3 | Treasury | FR-7.3 | P1 |
| US-7.4 | Treasury | FR-7.4 | P2 |
| US-7.5 | Treasury | FR-7.5 | P2 |
| US-8.1 | Admin Dashboard | FR-8.1 | P1 |
| US-8.2 | Admin Dashboard | FR-8.2 | P2 |
| US-8.3 | Admin Dashboard | FR-8.3 | P2 |
| US-9.1 | Partner Reporting | FR-9.1 | P2 |
| US-9.2 | Partner Reporting | FR-9.2 | P3 |

**Coverage check:** every functional requirement in the PRD (FR-1.1 through FR-9.2) is claimed by at least one story above. If a future requirement is added to the PRD without a corresponding story here, treat that as a gap to close before development on that requirement begins.

---

*This document is a companion to the Taka Sats PRD and Brand Guidelines. Stories are written to be independently buildable and testable — engineering scoping should slice work along these boundaries rather than along the epic groupings, since a full epic is often larger than one sprint.*
