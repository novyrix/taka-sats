# Taka Sats — Brand Guidelines

**Waste-to-Bitcoin Earn-First Programme**
Afribit Africa

Version 1.0 — Companion to the Taka Sats Brand Board (visual reference) and the Taka Sats PRD

---

## 1. Brand Architecture

Taka Sats is a **programme of Afribit Africa**, not a standalone organisation. Its brand is built as a deliberate sub-brand: it inherits Bitcoin Orange (`#F7931A`) directly from Afribit's parent identity for instant family recognition, and adds **Taka Green** as its one distinctive extension colour, representing circularity, growth, and the value created from waste.

This is the same architectural principle used across all of Afribit's programmes: one shared foundation, one distinguishing mark per programme. Taka Sats should always be recognisable as *an Afribit thing* first, and a Taka Sats thing second.

---

## 2. Colour Palette

| Token | Hex | RGB | Usage |
|---|---|---|---|
| Bitcoin Orange | `#F7931A` | 247, 147, 26 | Primary accent — fills, icons, highlights. Inherited from Afribit. |
| Taka Green | `#3E6336` | 62, 99, 54 | Taka Sats' own colour — circularity, growth. Safe for body text. |
| Ink | `#141414` | 20, 20, 20 | Primary text colour. |
| Cream | `#FAF8F4` | 250, 248, 244 | Warm background alternative to pure white; earthy, organic feel. |
| Orange — Deep | `#C4700C` | 196, 112, 12 | Hover/pressed states only. Never a primary fill. |
| Green — Deep | `#2A4525` | 42, 69, 37 | Dark-mode surfaces, high-emphasis text. |
| Green — Tint | `#89A86C` | 137, 168, 108 | Success states, light backgrounds. |
| Rule / Border | `#DEDEDE` | 222, 222, 222 | Dividers only, never a fill. |

**Taka Green's exact value was not invented** — it was extracted directly from the logo artwork (weighted average of the dominant green pixel clusters in the circular-arrow and leaf elements) and refined for consistent use as a standalone UI colour. Bitcoin Orange is not re-derived from the logo; it uses Afribit's already-established `#F7931A` so the two brands share the identical accent value rather than two subtly different oranges.

### 2.1 Accessibility — measured, not assumed

Every pairing below was calculated using the actual WCAG 2.1 relative-luminance contrast formula against the real brand hex values, not eyeballed:

| Pairing | Contrast Ratio | Verdict |
|---|---|---|
| Bitcoin Orange text on White | 2.30 : 1 | **FAIL** — never use orange as body text on a light background |
| Black Ink text on Bitcoin Orange background | 8.02 : 1 | **PASS AAA** — orange belongs as a *fill*, with dark text on top |
| Taka Green text on White | 6.90 : 1 | **PASS AA** — green is safe for real body text on white |
| Black Ink text on White | 18.42 : 1 | **PASS AAA** — the default, always-safe pairing |
| Taka Green on Bitcoin Orange / Orange on Green | 3.00 : 1 | Passes AA-Large only — large headline text only, never body copy |

**The one rule that matters most:** orange is a *fill colour*, not a *text colour*. If you find yourself setting Bitcoin Orange as the color of a sentence on a white or cream background, stop — use Taka Green instead, or set the orange as a background with dark text on top of it.

---

## 3. Typography

Taka Sats does **not** introduce a third font system. It lives inside the Afribit Console ecosystem and inherits Console's interface typefaces directly, exactly as specified in the Console Ecosystem Brief:

| Role | Typeface | Used for |
|---|---|---|
| Headings, navigation, labels | **Space Grotesk** (Bold/Medium) | Section titles, buttons, nav items |
| Body copy | **Hanken Grotesk** (Regular/Medium) | Descriptions, instructions, all reading text |
| Weights, sat amounts, tag IDs, timestamps | **JetBrains Mono** (Medium/Bold) | Anywhere a number or identifier needs unambiguous, aligned characters |

Reusing Console's fonts rather than picking new ones keeps the entire Afribit product family visually coherent — a collector or supervisor moving between the Taka Sats module and any other part of Console should never feel like they've entered a different product.

---

## 4. Logo Usage

### 4.1 Clear space
Minimum clear space around the logo, on all four sides, equals the height of the "B" glyph inside the Bitcoin symbol. Nothing — text, other logos, page edges — enters this zone.

### 4.2 Minimum size
24px / 6mm tall for both digital and print use. Below this size the leaf detail on the mark loses legibility and should be dropped in favor of a simplified version if one is ever needed.

### 4.3 Approved backgrounds
The logo is tested and approved on **white** and on **Ink (`#141414`)**. Both maintain full legibility of every element (orange circle, green arrow, leaf, wordmark).

### 4.4 What never changes
- The ratio of orange to green within the mark
- The relationship between the circular arrow and the leaf
- The logo's proportions (never stretched or squeezed to fit a layout)

---

## 5. Do's and Don'ts

**Do:**
- Use orange as a fill or icon colour, never as small body text
- Use green for any text that needs to sit directly on a white or cream background
- Keep the logo's clear space intact in every application
- Let the logo sit on white or Ink — both are tested and both work

**Don't:**
- Set orange body text on a white or light background — it fails WCAG AA and is genuinely hard to read
- Recolour the logo, or change the ratio of orange to green within it
- Place the logo on a busy photograph without a solid colour safe area behind it
- Introduce a third brand colour. Orange and green, plus ink/white/cream neutrals, is the complete palette

---

## 6. Application Assets Delivered With This Guide

Alongside this document, the following production-ready assets are provided:

- **Taka_Sats_Brand_Board.png** — the full visual brand reference (palette, typography specimens, logo usage, do's/don'ts) as a single shareable image
- **Taka_Sats_NFC_Tag_Front.png** / **Taka_Sats_NFC_Tag_Back.png** — the physical collector tag design (credit-card proportions, 85.6×54mm), directly implementing PRD requirement FR-1.1. The back face explicitly tells the collector, in plain language, that the tag can only receive funds and carries no spend risk if lost — this is both a UX and a trust decision, not just a design one
- **Taka_Sats_App_Icon_512/192/64/32.png** — the PWA/app icon set at standard sizes, symbol-only (no wordmark at small sizes, following standard icon convention — the OS renders the app name separately)
- **Taka_Sats_Brand_Pattern_Strip.png** — a repeating decorative element built from the logo's own circular-arrow motif, alternating in the two brand colours. **Use sparingly** — once per document or screen as a closing accent, never tiled as a repeating background texture or used behind body text

### 6.1 A note on restraint

Every decorative element in this system is deliberately minimal. This follows a hard lesson learned elsewhere in Afribit's document design work: bordered cards, busy patterns, and decorative flourishes are the most common visual signature of template-made, AI-generated design. The Taka Sats brand — like Afribit's parent brand — stays restrained: one accent colour doing the work at a time, generous white space, and decoration that appears once, deliberately, rather than everywhere.

---

*This document and the accompanying visual brand board are the reference for any future Taka Sats asset — the supervisor app, the admin dashboard module, printed collateral, or partner-facing materials. When in doubt, the rule is: does this look like Afribit's existing document and Console brand system, wearing Taka Sats' green? If yes, it's on-brand.*
