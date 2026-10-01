# Taka Sats — Cardless Launch & Optional NFC Pilot Architecture

**Status:** Proposed architecture update for prototype  
**Date:** 2026-10-01  
**Project:** Taka Sats — Waste-to-Bitcoin Earn-First Programme  
**Organisation:** Afribit Africa  
**Purpose:** Define how Taka Sats launches without depending on NFC cards, while preserving offline-first field operation and allowing Paybee or other NFC-enabled cards to become optional accelerators later.

---

# 1. Executive decision

Taka Sats must **not require NFC cards to launch**.

The collector identity model should be:

> **software-first, credential-agnostic**

A collector exists in Taka Sats independently of any physical card.

Possible ways to identify that same collector later:

- pre-registered collector code,
- supervisor search by alias/code,
- QR code,
- printed paper/plastic card,
- Paybee Receive QR,
- NFC tag,
- future NFC-enabled Paybee card,
- another partner credential.

NFC becomes a convenience layer, not a dependency.

The launch principle is:

> **If all NFC hardware disappears tomorrow, Taka Sats must still be fully usable.**

---

# 2. Why this pivot matters

The earlier design placed too much operational importance on NFC tags.

That creates several problems:

- cards must be sourced,
- printed,
- encoded,
- distributed,
- replaced,
- tested across phones,
- and understood by every new programme deploying Taka Sats.

For a system intended to be reusable in many communities, that creates unnecessary setup friction.

Instead, the system should treat NFC exactly like a barcode scanner:

> useful when present, unnecessary when absent.

---

# 3. Core identity model

Every collector receives an internal Taka Sats ID at registration.

Example:

```text
collector_id = 01K7...
public_code  = TS-KBR-0042
alias        = Akinyi
```

The collector record is permanent.

Credentials can change around it.

```text
COLLECTOR
   |
   +-- alias: Akinyi
   |
   +-- code: TS-KBR-0042
   |
   +-- Lightning destination:
   |      akinyi@flow.paybee.buzz
   |
   +-- credentials:
          manual_code
          QR
          future NFC
```

The collector is never defined by the credential.

---

# 4. Launch identity methods

## Method A — pre-registration + manual code

This is the minimum viable launch method.

At registration:

```text
Akinyi
TS-KBR-0042
akinyi@flow.paybee.buzz
```

At the collection point, the supervisor can search:

```text
Akinyi
```

or enter:

```text
0042
```

The collector appears immediately.

No physical credential is required.

---

## Method B — pre-registration + QR

At enrolment, Taka Sats generates:

```text
https://taka.afribit.africa/c/TS-KBR-0042
```

or an opaque QR payload such as:

```text
takasats:TS-KBR-0042
```

This QR can be:

- printed on paper,
- added to a cheap plastic card,
- sent as an image,
- attached to an existing Paybee card,
- printed on a lanyard,
- or stored on another credential.

Scanning it simply identifies the collector.

---

## Method C — future NFC

NFC stores the exact same identity reference:

```text
takasats:TS-KBR-0042
```

or:

```text
https://taka.afribit.africa/c/TS-KBR-0042
```

NFC therefore adds speed but changes nothing else.

---

# 5. Paybee's role

For the current pilot, treat Paybee as:

> **the collector wallet layer**

Example:

```text
Akinyi
Lightning Address:
akinyi@flow.paybee.buzz
```

Taka Sats does not need Paybee to identify Akinyi.

It only needs Paybee to receive the payout.

Therefore:

```text
IDENTITY
Taka Sats

PAYMENT DESTINATION
Paybee
```

These are intentionally independent.

---

# 6. Paybee user without a smartphone

This is one of the strongest use cases.

A participant may have:

```text
Paybee physical card
Receive QR
Pay QR
```

but no smartphone.

That is fine.

During Taka Sats enrolment:

1. Supervisor registers the collector.
2. Supervisor scans the **Receive** QR on the Paybee card.
3. Taka Sats resolves/stores the Lightning Address.
4. Collector receives a Taka Sats public code.
5. Collector can later be identified by alias, public code, optional Taka QR, or future NFC.

The collector never needs a smartphone.

---

# 7. Pre-registration workflow

## 7.1 Before a field session

A supervisor/admin registers collectors.

Fields:

```text
Alias / preferred name
Phone (optional)
Community / location
Lightning Address
Credential type
Notes (optional)
```

Required for launch:

```text
alias
Lightning destination
```

System creates:

```text
collector_id
public_code
```

Example:

```text
Akinyi
TS-KBR-0042
akinyi@flow.paybee.buzz
```

---

## 7.2 Validate payment destination

Taka Sats validates:

```text
akinyi@flow.paybee.buzz
```

as a standard Lightning Address.

If valid:

```text
PAYMENT DESTINATION VERIFIED
```

If validation cannot happen because the supervisor is offline:

```text
PENDING VALIDATION
```

The collector can still be registered locally.

No payout occurs until the destination is later validated.

---

## 7.3 Optional test payment

For a pilot, a small test payment may be performed during registration.

Purpose:

- verify address ownership,
- confirm Paybee receipt,
- detect mistyped addresses,
- familiarise collector with the process.

This should be configurable, not required for all deployments.

---

# 8. Preparing an offline session

Before going to the field, the Supervisor PWA downloads the active session package.

Example:

```text
SESSION
Kibera Pilot — 03 Oct 2026
```

Cached locally:

```text
active collectors
aliases
public codes
credential mappings
verified payment destination state
materials
rates
session supervisors
collection location
configuration
```

Important:

The app does not need the Internet to identify a pre-registered collector.

---

# 9. Field collection flow — no NFC

This is the default launch flow.

## Step 1 — collector arrives

Collector says:

> Akinyi

or presents:

```text
TS-KBR-0042
```

Supervisor taps:

```text
Find collector
```

## Step 2 — lookup

The PWA searches the **local offline cache**.

Possible search:

```text
Akinyi
0042
TS-KBR-0042
```

Result:

```text
Akinyi
TS-KBR-0042
Wallet: verified
Status: active
```

## Step 3 — material

Supervisor chooses:

```text
PET
HDPE
Aluminium
```

## Step 4 — weight

Supervisor enters:

```text
4.8 kg
```

## Step 5 — photo

Mandatory evidence:

```text
Take photo
```

The image hash is computed locally.

## Step 6 — confirm

Summary:

```text
Akinyi
PET
4.8 kg

Indicative value:
KES 144 equivalent
```

Supervisor confirms.

## Step 7 — local queue

If offline:

```text
RECORDED OFFLINE
```

The event is saved locally.

Collector can leave.

No Internet is required for the field interaction.

---

# 10. Sync flow

When connectivity returns:

```text
LOCAL EVENT
    |
    v
SYNC QUEUE
    |
    v
TAKA SATS API
    |
    +-- validate collector
    +-- validate session
    +-- validate supervisor
    +-- validate material/rate
    +-- validate photo hash
    +-- check duplicate
    |
    v
VERIFIED / NEEDS ATTENTION
```

Every event remains idempotent.

A retry cannot create a second collection event.

---

# 11. Payout flow

Once verified:

```text
weight × material rate
```

Example:

```text
4.8 kg × KES 30/kg
= KES 144
```

At payout time:

```text
KES 144
   |
   v
approved BTC/KES rate
   |
   v
sats amount
```

Then:

```text
collector_id
   |
   v
current Lightning destination
   |
   v
akinyi@flow.paybee.buzz
   |
   v
Lightning payment
   |
   v
Paybee wallet
```

Paybee is the recipient wallet.

Taka Sats remains responsible for:

- work verification,
- payout calculation,
- payout authorisation,
- payout record,
- settlement proof.

---

# 12. Immediate payout vs queued payout

For the first pilot, prefer:

```text
RECORDED
   ↓
VERIFIED
   ↓
PAYOUT QUEUE
   ↓
PAID
```

rather than instant pay-on-submit.

Reasons:

- easier fraud review,
- easier reconciliation,
- protects against accidental duplicate collection,
- helps test rate logic,
- easier to recover from connectivity problems,
- allows operational learning.

Later, verified low-risk events can move toward near-instant payouts.

---

# 13. Recycler reconciliation

The recycler remains the physical-world reconciliation layer.

Example:

```text
Taka Sats PET recorded:
824 kg

Recycler accepted:
817 kg

Variance:
7 kg
```

Track:

```text
recorded kg
verified kg
paid kg
recycler accepted kg
variance %
recycler revenue
programme subsidy
```

This is a core Taka Sats function.

---

# 14. What happens to collectors who are NOT pre-registered?

Support field enrolment.

Supervisor taps:

```text
[ NEW COLLECTOR ]
```

Minimum form:

```text
Alias
Lightning Address
```

System creates a temporary local collector ID.

Example:

```text
local:collector:73ac...
```

The person can immediately submit waste.

When the phone reconnects:

```text
temporary ID
    ↓
server registration
    ↓
permanent public code
```

Example:

```text
TS-KBR-0068
```

This means pre-registration improves speed but is **not mandatory**.

---

# 15. Collectors without a Lightning wallet

## Mode A — recommended

Record the collection first.

Status:

```text
VERIFIED
PAYMENT DESTINATION REQUIRED
```

When a wallet is linked later:

```text
READY FOR PAYOUT
```

## Mode B — Paybee onboarding

Supervisor helps create/provision the Paybee account/card.

Then stores:

```text
username@flow.paybee.buzz
```

## Mode C — another provider

Taka Sats must allow another Lightning destination.

Examples:

```text
Blink
Paybee
Fedi
other Lightning Address provider
```

No Taka Sats business logic should depend on a specific wallet provider.

---

# 16. The optional NFC future

Paybee can be asked to add NFC to a future card batch.

Taka Sats should use NFC only for identity.

Recommended NFC payload:

```text
https://taka.afribit.africa/c/TS-KBR-0042
```

or:

```text
takasats:TS-KBR-0042
```

Not:

```text
akinyi@flow.paybee.buzz
```

This keeps identity separate from payment.

---

# 17. Future Paybee NFC card flow

If Paybee integrates NFC:

```text
PAYBEE + TAKA SATS CARD
```

Card may contain:

```text
NFC
→ Taka Sats collector identity

Receive QR
→ Paybee Lightning Address

Pay QR
→ Paybee spending flow
```

One physical card can support:

```text
TAP = identify for work
RECEIVE QR = receive sats
PAY QR = spend sats
```

But Taka Sats remains usable without it.

---

# 18. Credential hierarchy

Recommended lookup order:

```text
1. NFC tap
2. QR scan
3. public collector code
4. alias search
5. phone number search (if collected)
```

No one method is mandatory.

---

# 19. Updated data model

## collectors

```text
id
public_code
alias
phone_optional
location_id
status
created_at
```

## collector_credentials

```text
id
collector_id
type
external_value
status
issued_at
revoked_at
```

Types:

```text
manual_code
qr
nfc
paybee_card
partner_card
```

## collector_payment_destinations

```text
id
collector_id
type
address
provider_hint
verified_at
is_primary
revoked_at
```

Example:

```text
type = lightning_address
address = akinyi@flow.paybee.buzz
provider_hint = paybee
```

---

# 20. Important architectural separation

Do not combine:

```text
Collector
Credential
Payment Destination
Wallet Provider
Payout Rail
```

Model:

```text
COLLECTOR
   |
   +--> CREDENTIAL
   |      NFC / QR / manual code
   |
   +--> PAYMENT DESTINATION
          Lightning Address
                 |
                 +--> Paybee / Blink / etc.
```

The payout rail is separate again:

```text
Afribit payout wallet
        |
        v
Lightning network
        |
        v
collector destination
```

---

# 21. Updated UI — Supervisor home

Prototype:

```text
TAKA SATS

Kibera Session
23 collectors cached
Offline ready

[ START COLLECTION ]

Find collector
[ Search by name or code ]

[ Scan QR ]

NFC available
Tap card
```

NFC should not dominate the UI.

The primary action is:

```text
START COLLECTION
```

---

# 22. Collector lookup screen

```text
Find collector

[ Akinyi / TS-KBR-0042      ]
[ Musa / TS-KBR-0043        ]
[ Jane / TS-KBR-0044        ]

Search:
[________________________]

[ Scan QR ]

[ Add new collector ]
```

If NFC exists:

```text
Or tap card
```

not:

```text
Tap required
```

---

# 23. Collection screen

```text
Akinyi
TS-KBR-0042

Material
[ PET      ]
[ HDPE     ]
[ Aluminium]

Weight
[ 4.8 ] kg

[ TAKE PHOTO ]

Indicative value
KES 144

[ CONFIRM COLLECTION ]
```

---

# 24. Offline indicator

Keep it operational:

```text
OFFLINE
3 events waiting to sync
```

Not a blocking error.

The supervisor should continue working.

---

# 25. Payment states

Use explicit states:

```text
NO_DESTINATION
DESTINATION_PENDING_VALIDATION
READY_FOR_PAYOUT
PAYOUT_PENDING
PAID
PAYOUT_FAILED
```

Collection verification should not fail merely because a payment destination is temporarily unavailable.

---

# 26. Prototype phase

## Prototype P0 — cardless

Build first:

- collector pre-registration,
- field enrolment,
- collector public codes,
- Lightning Address registration,
- offline collector cache,
- manual alias/code search,
- QR credential generation,
- QR scanner,
- collection flow,
- photo evidence,
- offline queue,
- sync,
- payout queue,
- Paybee Lightning destination support.

Do **not** wait for NFC hardware.

## Prototype P1 — NFC adapter

After the cardless flow works:

- add Web NFC reader,
- map NFC payload to collector code,
- add NFC write/provisioning tools,
- test with generic NTAG213 cards,
- test future Paybee NFC sample.

NFC should require almost no change to domain logic.

---

# 27. Prototype acceptance test

A prototype is successful if this works:

```text
1. Register Akinyi.
2. Save akinyi@flow.paybee.buzz.
3. Generate TS-KBR-0042.
4. Put the supervisor phone in airplane mode.
5. Find Akinyi using alias or code.
6. Record PET, 4.8 kg.
7. Capture photo.
8. Confirm.
9. Close/reopen the app.
10. Confirm the event still exists.
11. Reconnect.
12. Sync.
13. Verify.
14. Queue payout.
15. Pay Akinyi.
16. Record settlement proof.
```

No NFC is used anywhere in this acceptance test.

That is deliberate.

---

# 28. NFC acceptance test

Later:

```text
1. Link NFC tag to TS-KBR-0042.
2. Put device offline.
3. Tap NFC tag.
4. Akinyi opens instantly from cached data.
5. Complete collection.
```

If this works, NFC is proven as an accelerator.

If it fails, the base system still works.

---

# 29. Paybee NFC request

What Afribit should ask Paybee:

> We are using Paybee as a participant wallet layer in Taka Sats. For our field workflow, it would be useful if the next Paybee card batch included a standard NFC Forum-compatible chip such as NTAG213/216 or an equivalent readable tag.
>
> We do not need the NFC chip to hold funds or wallet secrets. We only need it to carry a stable programme identifier or URL so our offline-first supervisor application can identify a participant with a tap.
>
> The existing Receive and Pay QR codes can remain unchanged.

Desired card:

```text
NFC:
Taka Sats identity

Receive QR:
Paybee Lightning receive destination

Pay QR:
Paybee spending flow
```

---

# 30. Why this is better for Paybee too

The request does not force Paybee to redesign its wallet architecture.

NFC is just an identity affordance.

Their existing Receive and Pay QR codes remain intact.

Afribit can test the NFC field workflow independently.

---

# 31. Deployment portability

A new community should be able to deploy Taka Sats with only:

```text
Android supervisor phone
Taka Sats PWA
Internet occasionally
weighing scale
camera
Lightning destination for participants
```

Optional:

```text
QR cards
NFC cards
Paybee cards
BLE scales
```

This is the portability target.

---

# 32. Revised architecture rule

Old mental model:

```text
Collector needs card
       ↓
card identifies collector
```

New model:

```text
Collector exists
       |
       +-- search
       +-- code
       +-- QR
       +-- NFC
       +-- partner credential
```

---

# 33. Revised product principle

Add:

> **No physical credential is required.**
>
> A credential may accelerate identification, but the collector's programme identity and earnings history live in Taka Sats, not on a card.

And:

> **Offline-first does not mean hardware-first.**
>
> Offline identity resolution comes from the supervisor's cached collector directory. NFC and QR are lookup shortcuts into that cache.

---

# 34. Team implementation priorities

1. Collector identity independent of credentials.
2. Offline cached collector directory.
3. Fast manual alias/code search.
4. QR credential generation and scanner.
5. Collection flow.
6. Sync and verification.
7. Lightning destination validation.
8. Payout queue.
9. Generic NFC adapter.
10. Paybee NFC pilot.

---

# 35. Suggested repository changes

```text
lib/
  collectors/
  credentials/
    index.ts
    manual.ts
    qr.ts
    nfc.ts
  payments/
    destination.ts
    resolver.ts
  payouts/
    engine.ts
```

Domain interfaces:

```ts
interface CollectorCredential {
  id: string
  collectorId: string
  type: 'manual' | 'qr' | 'nfc' | 'partner'
  externalValue: string
  status: 'active' | 'revoked'
}
```

```ts
interface PaymentDestination {
  collectorId: string
  type: 'lightning_address' | 'lnurl_pay'
  value: string
  providerHint?: string
  verifiedAt?: Date
}
```

---

# 36. Migration from current design

Change:

```text
NFC tag required for normal collector flow
```

to:

```text
NFC tag optional
```

Change:

```text
tag -> Lightning destination
```

to:

```text
credential -> collector
collector -> current Lightning destination
```

Keep:

- offline PWA,
- session logic,
- rates,
- photos,
- sync,
- ledger,
- separation of duties,
- payout queue,
- reconciliation,
- public/partner reporting.

---

# 37. Pilot recommendation

Launch the first Taka Sats pilot with:

```text
10–20 collectors
1 location
2 supervisors
2–3 materials
1 recycler
Paybee as one wallet option
manual + QR identification
no NFC dependency
```

For collectors who already use Paybee:

```text
scan Receive QR at enrolment
```

For collectors without smartphones:

```text
Paybee physical card can remain their wallet interface
```

Taka Sats identifies them independently.

---

# 38. What the pilot should prove

Not:

> Does NFC work?

Instead:

> Can we reliably turn verified recycling activity into traceable Bitcoin earnings?

Proof points:

```text
collector recognised
waste measured
evidence captured
event survives offline use
event syncs
event verifies
value is calculated
collector is paid
recycler confirms material
programme reconciles
```

---

# 39. Final operating model

```text
                     SPONSOR / AFRIBIT
                            |
                       payout float
                            |
                            v
                    LIGHTNING NETWORK
                            |
                            v
                     COLLECTOR WALLET
                    Paybee / Blink / etc.
                            ^
                            |
                         payout
                            |
                       TAKA SATS
                            ^
                            |
           +----------------+----------------+
           |                                 |
      evidence                         reconciliation
           |                                 |
     COLLECTION HUB --------------------> RECYCLER
           ^
           |
        COLLECTOR
           |
      identity via
  search / code / QR / NFC
```

---

# 40. Final rule for the prototype team

Build Taka Sats so that:

> **A collector can participate with no smartphone, no NFC card, and no Taka Sats app.**

The supervisor's device carries the application.

The collector only needs:

- a human-recognisable identity,
- and eventually a Lightning destination for payout.

Everything else is optional infrastructure.

That is the version of Taka Sats we should prototype first.


---

# UPDATE — Verification Architecture v2

**Effective date:** 2026-10-01  
**Supersedes:** Any assumption that manually entered kilograms are sufficient evidence, or that AI should directly determine payout kilograms from a single photo.

## A. New verification principle

Taka Sats should use:

```text
PHYSICAL SCALE
     +
PHOTO EVIDENCE
     +
OCR / AI CHECKS
     +
GPS / TIME
     +
RECYCLER MASS BALANCE
```

The physical scale remains the authoritative source of kilograms.

AI should challenge suspicious measurements rather than invent the payout weight.

---

## B. Research findings shaping this update

### CleanHub / Eddy pattern

A relevant existing system is CleanHub's Eddy platform.

Its published workflow includes:

- QR/location check-in,
- physical weighing on a digital scale,
- a photo of the waste on the scale,
- GPS and timestamps,
- AI checks for weight mismatch and weight outliers,
- duplicate-photo detection,
- offline-first data capture,
- re-weighing at a material-recovery facility,
- and mass-balance checks between collection and downstream stages.

This supports the Taka Sats direction:

```text
sensor truth
+
AI audit
+
downstream reconciliation
```

rather than:

```text
photo
→ exact AI kg
→ payout
```

References:

- https://eddy.cleanhub.com/about/eddys-plastic-tracking-software-explained
- https://eddy.cleanhub.com/
- https://www.cleanhub.com/blog/auto-flagging
- https://www.cleanhub.com/blog/how-does-the-tracking-with-the-cleanhub-software-work

### Plastic Bank pattern

Plastic Bank's published methodology uses:

- physical weighing by material,
- collection-branch records,
- processor receipts,
- and reconciliation between collected and processor-received quantities.

Reference:

- https://plasticbank.com/plastic-credit-methodology/

This reinforces recycler reconciliation as a core Taka Sats verification mechanism.

---

## C. What changes in the product

### Old weak path

```text
Supervisor types:
14.4 kg
       ↓
system trusts it
       ↓
payout
```

### New path

```text
Waste placed on physical scale
        ↓
scale displays 8.40 kg
        ↓
supervisor records/captures 8.40
        ↓
photo includes waste + scale
        ↓
OCR reads display
        ↓
AI checks plausibility
        ↓
event receives verification level
        ↓
payout
        ↓
later recycler reconciliation
```

---

# D. WeightSource abstraction

Create:

```ts
type WeightSource =
  | 'manual'
  | 'manual_ocr_verified'
  | 'ble_scale'
  | 'serial_scale'
  | 'industrial_scale'
```

Each event should store:

```text
weight_kg
weight_source
scale_id nullable
scale_reading_raw nullable
scale_calibration_id nullable
measured_at
```

The authoritative measurement must never be silently overwritten later.

Corrections create new linked audit records.

---

# E. Prototype P0 — manual digital scale + mandatory photo

Do this first.

Field flow:

```text
collector identified
      ↓
material selected
      ↓
waste placed on scale
      ↓
scale displays kg
      ↓
supervisor enters kg
      ↓
camera opens
      ↓
photo must show:
- waste
- scale
- scale display
      ↓
confirm
```

This is intentionally cheap and deployable immediately.

---

# F. OCR verification

The first automation should be OCR of the scale display.

Example:

```text
Submitted:
8.40 kg

OCR:
8.40 kg

Result:
PASS
```

Fraud/error example:

```text
Submitted:
18.40 kg

OCR:
8.40 kg

Result:
WEIGHT_MISMATCH
```

Policy:

```text
OCR agrees
→ eligible for higher confidence

OCR disagrees materially
→ NEEDS_REVIEW

OCR unavailable/uncertain
→ event remains valid but lower confidence
```

OCR failure must not block field collection.

---

# G. AI Auditor

Create a dedicated verification pipeline.

Suggested module:

```text
lib/verification/
```

The AI Auditor should return flags and evidence, not mutate the collection record.

Example:

```json
{
  "decision": "review",
  "flags": [
    "WEIGHT_MISMATCH",
    "DUPLICATE_IMAGE"
  ],
  "signals": {
    "submitted_weight_kg": 18.4,
    "ocr_weight_kg": 8.4,
    "material_prediction": "PET",
    "material_confidence": 0.91
  }
}
```

---

# H. Initial verification checks

Build high-value checks before sophisticated visual-weight models.

## A01 — scale visibility

```text
SCALE_NOT_VISIBLE
```

when the submitted evidence does not clearly contain the scale/display.

## A02 — OCR weight mismatch

```text
WEIGHT_MISMATCH
```

when image reading and submitted reading differ beyond configured tolerance.

## A03 — statistical weight outlier

Compare against:

```text
material
hub
session
collector history
supervisor history
```

Flag:

```text
WEIGHT_OUTLIER
```

## A04 — duplicate image

Use:

```text
SHA-256
perceptual hash
embedding similarity
```

Flag:

```text
DUPLICATE_IMAGE
```

## A05 — material visible

Flag:

```text
MATERIAL_NOT_VISIBLE
```

when the photo does not contain enough visible waste evidence.

## A06 — material classification

Compare selected material with visual classification.

Flag:

```text
MATERIAL_MISMATCH
```

## A07 — GPS mismatch

Compare event GPS against session/drop-point geofence.

Flag:

```text
LOCATION_MISMATCH
```

## A08 — time anomaly

Examples:

- impossible number of collections in a few minutes,
- collection outside active session,
- repeated unusual off-hours activity.

## A09 — repeated exact weights

Examples:

```text
10.00
10.00
10.00
10.00
```

Flag statistically unusual patterns.

## A10 — payout concentration

Look for unusual concentration by:

```text
collector
supervisor
hub
wallet destination
```

---

# I. AI visual weight estimation

Do **not** make this authoritative in the first build.

Preferred use:

```text
photo
   ↓
material detection
   ↓
depth / visible volume estimate
   ↓
local density model
   ↓
expected weight range
```

Example:

```text
Visual expected range:
6–11 kg

Physical scale:
8.4 kg

Result:
PLAUSIBLE
```

Suspicious:

```text
Visual expected range:
6–11 kg

Physical scale:
38.4 kg

Result:
WEIGHT_OUTLIER
```

Action:

```text
RE-WEIGH
SECOND PHOTO
or
HUMAN REVIEW
```

Never silently replace the physical reading with an AI prediction.

---

# J. Candidate computer-vision utilities

Potential building blocks:

```text
OpenCV
ONNX Runtime
YOLO-family object detector or equivalent
perceptual hashing
image embeddings
OCR engine
Depth Anything V2 Small
```

## Depth Anything V2

Useful for research into relative/metric depth and visible geometry.

Reference:

- https://github.com/DepthAnything/Depth-Anything-V2

Important licensing note:

The upstream project publishes different licences for different checkpoints. The Small model is listed under Apache-2.0 while larger checkpoints use more restrictive terms. The specific model licence must be checked before production inclusion.

Initial Taka Sats use:

```text
depth/volume signal
→ plausibility model
```

not:

```text
depth
→ exact payout kilograms
```

---

# K. Build the Taka Waste Dataset

Every physically verified collection should become training data.

Store:

```text
image
material
physical weight
weight source
scale ID
container/bag type where useful
location
timestamp
AI flags
final verification level
recycler reconciliation outcome
```

Example:

```json
{
  "material": "PET",
  "weight_kg": 8.4,
  "weight_source": "ble_scale",
  "verification_level": "V2"
}
```

This creates locally relevant labelled data.

Long-term objective:

> Train visual models on actual Kibera/community waste images paired with real measured kilograms rather than relying permanently on generic datasets.

---

# L. Connected scale should move earlier in the roadmap

Target:

```text
LOAD CELL
    ↓
HX711
    ↓
ESP32
    ↓
BLE
    ↓
Supervisor device
    ↓
Taka Sats PWA
```

This architecture is inexpensive and well established in open-hardware projects.

Taka Sats should define the software interface rather than depend on one hardware brand.

Example BLE measurement:

```json
{
  "device_id": "scale-kbr-03",
  "weight_kg": 8.4,
  "stable": true,
  "battery_pct": 72,
  "calibration_id": "cal-2026-10-a"
}
```

Only accept automatic capture when:

```text
stable = true
```

---

# M. Scale calibration

Connected does not mean accurate.

Track:

```text
scale_id
model
capacity
resolution
last_calibrated_at
calibration reference
tolerance
next calibration due
```

Field calibration should support known reference weights.

If calibration is outside tolerance:

```text
SCALE_CALIBRATION_FAILED
```

The scale must not generate high-confidence events until recalibrated.

---

# N. Verification levels

Keep verification confidence explicit.

## V0 — Manual

```text
manual weight
basic photo
supervisor record
```

Fallback.

## V1 — Evidence Verified

```text
manual weight
+
scale-visible photo
+
OCR comparison
+
GPS/time
+
duplicate checks
```

## V2 — Sensor Verified

```text
automatic BLE/serial scale reading
+
photo
+
AI checks
+
GPS/time
```

## V3 — Mass Reconciled

```text
V1/V2
+
hub aggregate weight
+
recycler receipt/weight
```

## V4 — Audited Impact

```text
V3
+
downstream processing evidence
+
no double counting
+
full ledger/audit trail
```

Do not mix this with payout status.

Example:

```text
verification_level = V2
payout_state = PAID
```

Later:

```text
verification_level = V3
payout_state = PAID
```

---

# O. Payout timing

Collectors should not normally wait for recycler settlement.

Pilot flow:

```text
COLLECTION
    ↓
SOURCE VERIFICATION
    ↓
PROVISIONALLY VERIFIED
    ↓
PAYOUT
```

Later:

```text
HUB MASS BALANCE
    ↓
RECYCLER RECEIPT
    ↓
FINAL VERIFIED IMPACT
```

Repeated reconciliation problems affect hub/supervisor risk and future review requirements.

Do not automatically claw payments back from collectors because a downstream operator has poor reconciliation.

---

# P. Mass balance

This becomes a core verification feature.

Example:

```text
Individual PET events:
382.6 kg
       ↓
Hub consolidated:
378.9 kg
       ↓
Recycler accepted:
374.8 kg
```

Calculate:

```text
collection_to_hub_variance
hub_to_recycler_variance
overall_variance
```

Possible documented reasons:

```text
moisture
contamination removed
sorting loss
spillage
scale tolerance
rejected material
```

Unexplained excess variance:

```text
MASS_BALANCE_ANOMALY
```

---

# Q. Recycler handover

Recycler handover becomes a first-class domain event.

Store:

```text
recycler
material
gross_weight
tare_weight
net_weight
price_per_kg
total_value
receipt/document/photo
timestamp
operator
```

This lets Taka Sats compare:

```text
paid kg
vs
verified collected kg
vs
recycler accepted kg
```

---

# R. Programme economics

Track:

```text
collector payout rate
recycler recovery value
programme subsidy
```

Example:

```text
Collector payout:
KES 30/kg

Recycler recovery:
KES 18/kg

Programme subsidy:
KES 12/kg
```

Core metrics:

```text
verified kg
reconciled kg
sats paid
KES-equivalent payout
recycler revenue
cost recovery %
subsidy per kg
operating cost per kg
```

---

# S. Online/offline split

## Must work offline

- collector lookup,
- new collector temporary registration,
- material selection,
- manual weight,
- BLE capture if locally supported,
- photo,
- GPS,
- event creation,
- local persistence,
- queue.

## Can happen after reconnect

- Lightning Address validation,
- heavy OCR if server-side,
- advanced AI inference,
- global duplicate comparison,
- payout,
- anomaly aggregation,
- mass-balance reports.

---

# T. Suggested repository modules

```text
lib/
  measurements/
    weight-source.ts
    manual.ts
    ble.ts
    serial.ts
    calibration.ts

  verification/
    pipeline.ts
    flags.ts
    ocr.ts
    duplicate-image.ts
    material-classifier.ts
    visual-weight-range.ts
    anomaly.ts

  inventory/
    lots.ts
    mass-balance.ts
    recycler-handover.ts
```

Keep the existing collector, credential, payment-destination and payout modules.

---

# U. Suggested data-model additions

## collection_events

Add/ensure:

```text
weight_kg
weight_source
scale_id nullable
scale_reading_raw nullable
scale_calibration_id nullable
verification_level
verification_status
```

## verification_checks

```text
id
event_id
check_type
status
confidence
observed_value
expected_value
metadata_json
model_version nullable
created_at
```

## scales

```text
id
external_device_id
model
capacity_kg
resolution_kg
status
last_calibrated_at
```

## scale_calibrations

```text
id
scale_id
calibrated_at
reference_weights
results
tolerance
passed
operator_id
```

## recycler_handovers

```text
id
recycler_id
material_id
gross_kg
tare_kg
net_kg
price_per_kg
total_value
receipt_url
recorded_at
```

## mass_balance_runs

```text
id
location_id
material_id
period_start
period_end
collection_kg
hub_kg
recycler_kg
variance_kg
variance_pct
status
```

---

# V. Revised prototype roadmap

## P0 — Cardless collection foundation

Build:

- collector registration,
- public collector codes,
- Lightning Address destinations,
- Paybee as a normal Lightning destination,
- offline collector cache,
- alias/code search,
- QR identification,
- field enrolment,
- manual digital-scale weight,
- mandatory photo,
- offline queue,
- sync.

Exit:

```text
No NFC
No collector smartphone
No Internet
→ collection still completes
```

## P1 — Evidence-backed weighing

Build:

- scale-photo capture guidance,
- image hashing,
- GPS/time,
- OCR prototype,
- submitted-vs-OCR comparison,
- exact duplicate detection,
- review queue,
- V0/V1 verification levels.

Fraud acceptance test:

```text
photo scale = 8.40 kg
manual entry = 18.40 kg
→ WEIGHT_MISMATCH
```

## P2 — AI Auditor v1

Build:

- perceptual duplicate detection,
- scale visibility,
- waste visibility,
- material classifier,
- weight statistical outliers,
- supervisor/hub anomaly checks.

No exact visual payout kilograms yet.

## P3 — Connected scale

Build:

- `WeightSource`,
- BLE scale prototype,
- device registry,
- stable reading,
- calibration,
- V2.

Exit:

```text
sensor weight cannot be casually edited
```

## P4 — Recycler reconciliation

Build:

- hub aggregate,
- recycler handover,
- receipt evidence,
- material inventory lot,
- mass balance,
- V3.

## P5 — Visual weight R&D

Only after enough physical ground truth exists.

Research:

- segmentation,
- depth,
- visible volume,
- locally fitted material-density models,
- weight range prediction.

Use for anomaly detection only until validated.

## P6 — AI Auditor v2

Combine:

```text
scale
OCR
material model
visual range
GPS
time
image duplication
collector patterns
supervisor patterns
mass-balance history
```

Output:

```text
confidence
flags
recommended action
```

---

# W. Prototype UI update

Collection example:

```text
Akinyi
TS-KBR-0042

Material
PET

Weight
[ 8.40 ] kg
Source: Manual

[ TAKE SCALE PHOTO ]

Checks:
✓ Waste visible
✓ Scale visible
✓ OCR 8.40 kg
✓ Weight matches

[ CONFIRM COLLECTION ]
```

Future BLE:

```text
Scale TS-SCALE-03 connected

Stable:
8.40 kg

[ USE WEIGHT ]
```

---

# X. Admin review example

```text
EVENT #1288

Collector:
Akinyi

Material:
PET

Submitted:
18.40 kg

OCR:
8.40 kg

Visual expected range:
6–11 kg

Flags:
WEIGHT_MISMATCH
WEIGHT_OUTLIER

[ REQUEST RE-WEIGH ]
[ ACCEPT WITH NOTE ]
[ REJECT ]
```

Every review action is audited.

---

# Y. Build sprint starting now

## Sprint A — Collection

- [ ] Cardless collector registration
- [ ] Paybee Lightning Address storage
- [ ] Offline directory
- [ ] Alias/code search
- [ ] QR scanner
- [ ] Offline field enrolment
- [ ] Material picker
- [ ] Manual weight
- [ ] Mandatory photo
- [ ] Offline queue
- [ ] Sync

## Sprint B — Verification

- [ ] Image SHA-256
- [ ] GPS/time
- [ ] Scale-photo requirement
- [ ] OCR proof of concept
- [ ] Weight mismatch tolerance
- [ ] `WEIGHT_MISMATCH`
- [ ] exact duplicate-image check
- [ ] verification-check records
- [ ] admin review queue
- [ ] V0/V1 states

## Sprint C — Reconciliation foundation

- [ ] Recycler model
- [ ] Recycler handover
- [ ] Receipt upload
- [ ] Hub aggregate/material lot
- [ ] mass-balance calculation
- [ ] variance flag

In parallel:

- [ ] evaluate a commercial BLE scale,
- [ ] prototype ESP32 + HX711 + load-cell reference device,
- [ ] begin collecting labelled images paired with physical scale readings.

---

# Z. New final rules

> **No physical card is required.**

> **No collector smartphone is required.**

> **Physical measurement is the authoritative source of kilograms.**

> **AI audits kilograms; it does not invent payout kilograms.**

> **Manual measurements remain available but carry lower confidence until independently verified.**

> **Recycler mass balance is part of verification, not merely reporting.**

> **Every high-confidence collection should improve the Taka Waste Dataset.**

> **NFC, Paybee, BLE scales and AI models remain replaceable adapters around the Taka Sats core.**

---

# Immediate team instruction

Start building:

```text
CARDLESS IDENTITY
+
PAYBEE / LIGHTNING DESTINATION
+
OFFLINE COLLECTION
+
PHYSICAL DIGITAL SCALE
+
MANUAL KG
+
MANDATORY SCALE PHOTO
+
OCR CROSS-CHECK
+
REVIEW FLAGS
+
PAYOUT
+
RECYCLER RECONCILIATION FOUNDATION
```

Do not block the prototype on NFC, BLE hardware or photo-only weight estimation.

The prototype is successful when it can detect that a supervisor typed `18.40 kg` while the photographed scale shows `8.40 kg`, preserve the event for review, and still operate offline in the field.
