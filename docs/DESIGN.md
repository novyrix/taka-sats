# Taka Sats - Design System & UI Implementation Guide

**Waste-to-Bitcoin Earn-First Programme · Afribit Africa**

| | |
|---|---|
| Document status | Draft v0.1 - for engineering + design sign-off |
| Date | 2026-09-03 |
| Companions | `Initial assets/Taka_Sats_Brand_Guidelines.md` (authoritative on brand), `docs/REQUIREMENTS.md`, `Initial assets/Taka_Sats_Code_Style_Guide.md` |
| Audience | Implementors (human or agent). This tells you **which components to reuse and how to theme them**, so you build screens by composition, not from scratch. |

---

## 0. How to use this document

1. **Do not hand-roll a component that §6 maps to a library.** Pull it from the named source, re-theme it with the tokens in §4, and move on.
2. **The Brand Guidelines win every tie.** This document operationalises them; it never overrides them. If something here contradicts `Taka_Sats_Brand_Guidelines.md`, the Brand Guidelines are right - fix this document.
3. **Three surfaces, three budgets (§3).** A component that is fine in the Admin dashboard may be banned in the Supervisor PWA. Check the surface column before you adopt.
4. **Every library is pinned and license-checked before adoption** - see §7. All recommendations here are permissively licensed and compatible with the project's AGPL-3.0.
5. **`prefers-reduced-motion` and the brand palette rules are hard constraints**, enforced in review and (where possible) in lint/CI - see §9 and §13.

The `shadcn/ui` primitive set is the **mandated foundation** (Code Style Guide §3.1, "shared primitives, shadcn/ui-sourced, per the Console Ecosystem Brief"). Everything else in §6 is a *selective addition* on top of it. Anything genuinely reusable that we add should be a candidate to upstream into the Console shared primitives.

---

## 1. Design principles (Taka Sats-specific)

These derive from the PRD's core product principles and the Brand Guidelines' note on restraint.

1. **Earn-first means friction-free.** The collector-facing moment (tap) has **zero UI** beyond a glyph and a colour change. The supervisor flow is the shortest tap-count that still captures mandatory evidence.
2. **Evidence reads as evidence.** Weights, sats, timestamps, tag IDs, hashes are always in the mono typeface, tabular, aligned - they should *look* like a record, not like marketing copy.
3. **Trust through plainness.** No gradients-on-gradients, no glass-morphism, no decorative motion. The Brand Guidelines call bordered-card-and-flourish styling "the most common visual signature of template-made, AI-generated design." We avoid that signature deliberately.
4. **One accent at a time.** Bitcoin Orange **or** Taka Green is doing the work in a given region - never both competing. Orange is a *fill*, green is *text-safe*.
5. **Sunlight, one hand, cheap phone.** The Supervisor PWA is designed for an outdoor market on a sub-$150 Android. High contrast, large targets, minimal JS.
6. **Motion is feedback, never decoration.** It confirms a tap, shows sync progress, counts a payout up. If it does not communicate state, it does not ship.

---

## 2. Brand constraints recap (from the Brand Guidelines - non-negotiable)

### 2.1 Colour (exact hex, from `Taka_Sats_Brand_Board.png`)

| Token | Hex | Role - and the hard rule |
|---|---|---|
| Bitcoin Orange | `#F7931A` | Fills, icons, highlights. **Never `color:` on text over a light background** (2.30:1, fails AA). Dark text *on* orange is fine (8.02:1, AAA). |
| Taka Green | `#3E6336` | Taka Sats' own colour. **Safe as body text on white/cream** (6.90:1, AA). Primary actions, links, positive framing. |
| Ink | `#141414` | Primary text. Default, always safe (18.42:1 on white). |
| Cream | `#FAF8F4` | Warm background. The PWA's default canvas. |
| Orange - Deep | `#C4700C` | Hover/pressed of an orange fill **only**. Never a primary fill. |
| Green - Deep | `#2A4525` | Dark-mode surfaces; high-emphasis text on light. |
| Green - Tint | `#89A86C` | Success states, subtle positive backgrounds. |
| Rule / Border | `#DEDEDE` | Dividers only. **Never a fill.** |

No ninth colour. No tints/shades beyond these unless generated as *transparency* of an existing token (e.g. `rgb(62 99 54 / 0.08)` for a hover wash).

### 2.2 Typography - the three faces, no fourth

| Face | Weights used | Everywhere it appears |
|---|---|---|
| **Space Grotesk** | 500, 700 | Headings, nav, tab labels, buttons, table column headers, stat labels |
| **Hanken Grotesk** | 400, 500 | Body copy, descriptions, instructions, form help text, empty states |
| **JetBrains Mono** | 500, 700 | Sat amounts, weights (kg), tag IDs, timestamps, hashes, Lightning addresses, ledger sequence numbers - anything that is data |

Taka Sats **does not introduce a font system** - these are inherited from Afribit Console.

### 2.3 Logo & motif

- Logo approved on **white** and **Ink** only. Clear space = height of the "B" glyph. Min 24px / 6mm.
- The mark carries three motifs we may reuse *sparingly* as UI language:
  - **Circular arrow** (recycling) → the sanctioned "brand animation": a slow rotation while syncing, a settle when confirmed. This is the *only* looping animation allowed.
  - **Leaf** → success / positive-impact iconography accent.
  - **Circuit nodes** (three dots + traces on the left of the mark) → visual language for the verification chain / ledger (e.g. the ledger explorer, the "chain intact" indicator).
- The **pattern strip** (`Taka_Sats_Brand_Pattern_Strip.png`): **once per screen, as a closing accent.** Never tiled, never behind text, never as a section background.

### 2.4 Restraint rules (Brand Guidelines §6.1)

- Prefer whitespace and a background-shade change over borders to separate content.
- If a card needs an edge: **one** of {1px `#DEDEDE` border} **or** {a single soft shadow} - never both, never plus a gradient.
- No decorative gradients. The only gradient permitted is a barely-there vertical wash on the public hero, if at all.
- Generous whitespace is the house style. When in doubt, add space, not a divider.

---

## 3. The three surfaces and their budgets

Everything in this system is scoped to one of these. **Check the surface before adopting a component.**

| | **Supervisor PWA** | **Admin dashboard** | **Public site** |
|---|---|---|---|
| Device | Sub-$150 Android, outdoors, one-handed, offline | Desktop / laptop, office, online | Any device, mostly desktop + mobile web |
| Users | Brian (supervisor), hub leads | Ronnie / Eddie (admin), partners | Funders, press, the public |
| Priorities | Speed, offline, huge targets, sunlight contrast, tiny JS | Density, live data, tables, charts, keyboard | Trust, clarity, "the numbers are real", fast first paint |
| JS budget | **Strict.** Core route interactive < 3s on 3G. No Motion in the critical path. anime.js lazy-loaded, tree-shaken, on 3-4 screens only. | Generous. Motion, Recharts, TanStack Table all fine. | Moderate. Mostly static/SSG. One tasteful hero. Number tickers. |
| Component sources | shadcn/ui, Vaul, Sonner, Lucide, minimal anime.js | shadcn/ui, KokonutUI (re-themed), Motion, Recharts/shadcn-charts, TanStack Table+Virtual, cmdk, Tremor blocks | shadcn/ui, Motion, Magic UI (number ticker, animated beam - re-themed), Leaflet |
| Banned here | KokonutUI animated backgrounds, Aceternity effects, parallax, any looping animation except the sanctioned circular-arrow sync spinner | parallax, scroll-jacking | scroll-jacking, autoplay video, cookie-wall patterns |

---

## 4. Design tokens

Single source of truth: `app/globals.css` (CSS custom properties) mapped into the Tailwind theme. Tokens follow the shadcn/ui naming convention so shadcn components theme automatically.

### 4.1 Colour tokens (light)

```css
:root {
  /* brand raw values - do not use directly in components; use the semantic tokens below */
  --brand-bitcoin:      #F7931A;
  --brand-bitcoin-deep: #C4700C;
  --brand-green:         #3E6336;
  --brand-green-deep:    #2A4525;
  --brand-green-tint:    #89A86C;
  --brand-ink:           #141414;
  --brand-cream:         #FAF8F4;
  --brand-rule:          #DEDEDE;

  /* semantic (shadcn-compatible) */
  --background:            var(--brand-cream);   /* PWA canvas; admin uses #FFFFFF surfaces on top */
  --foreground:            var(--brand-ink);
  --card:                  #FFFFFF;
  --card-foreground:       var(--brand-ink);
  --popover:               #FFFFFF;
  --popover-foreground:    var(--brand-ink);
  --primary:               var(--brand-green);   /* primary actions, links - text-safe */
  --primary-foreground:    #FFFFFF;
  --secondary:             rgb(62 99 54 / 0.08); /* green wash */
  --secondary-foreground:  var(--brand-green-deep);
  --muted:                 rgb(20 20 20 / 0.04);
  --muted-foreground:      rgb(20 20 20 / 0.60);
  --accent:                rgb(62 99 54 / 0.10);
  --accent-foreground:     var(--brand-green-deep);
  --destructive:           #B4232B;              /* a red not in the brand set - used ONLY for true errors; see §4.4 */
  --destructive-foreground:#FFFFFF;
  --success:               var(--brand-green-tint);
  --success-foreground:    var(--brand-green-deep);
  --border:                var(--brand-rule);
  --input:                 var(--brand-rule);
  --ring:                  var(--brand-green);
  --radius:                0.5rem;               /* 8px base; see §4.3 */

  /* the one token that carries the "never on text" rule in its name */
  --fill-bitcoin:          var(--brand-bitcoin);
  --fill-bitcoin-pressed:  var(--brand-bitcoin-deep);
}
```

### 4.2 Colour tokens (dark) - admin + optional PWA night mode

```css
:root[data-theme="dark"], :root:not([data-theme="light"]) .dark {
  --background:          var(--brand-ink);
  --foreground:          #F4F2EE;
  --card:               var(--brand-green-deep);
  --card-foreground:    #F4F2EE;
  --primary:            var(--brand-green-tint);   /* lighter green for contrast on dark */
  --primary-foreground: var(--brand-ink);
  --muted:              rgb(255 255 255 / 0.06);
  --muted-foreground:   rgb(255 255 255 / 0.64);
  --border:             rgb(255 255 255 / 0.12);
  --ring:               var(--brand-green-tint);
  --fill-bitcoin:       var(--brand-bitcoin);      /* orange fill unchanged; still never text */
}
```

`next-themes` drives `data-theme`. The Supervisor PWA defaults to light (sunlight); dark is opt-in.

### 4.3 Spacing, radius, elevation

- **Spacing scale:** 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64 (px). Tailwind default already matches. PWA gutters: 16 (edge) / 24 (section). Admin gutters: 24 / 32.
- **Radius:** `--radius` 8px base. Buttons/inputs 8px. Cards 12px. Full-bleed sheets 16px top corners only. Pills (status) 999px. **Never** mix many radii on one screen.
- **Elevation:** two levels, no more.
  - `elev-1` - `0 1px 2px rgb(20 20 20 / 0.06)` - resting cards, sheets.
  - `elev-2` - `0 6px 24px rgb(20 20 20 / 0.10)` - popovers, active bottom sheet, command palette.
  - Focus is a 2px `--ring` outline with 2px offset - never a glow.

### 4.4 The `--destructive` red

The brand palette has **no red.** Errors, failed payouts, and destructive confirms need one. We add exactly one: `#B4232B` (≈ 5.9:1 on white, AA). It is reserved for **genuine error and destructive-action** states only - never for "attention", "pending", or emphasis (use Ink + weight, or the green wash, for those). This is the single sanctioned deviation from the eight-colour palette and is documented here so a reviewer does not flag it as off-brand.

### 4.5 Typography tokens

```css
:root {
  --font-display: "Space Grotesk", ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif;
  --font-body:    "Hanken Grotesk", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono:    "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
```

**Type scale** (rem, `--font-body` line-heights in parens):

| Token | PWA | Admin / Public | Face | Use |
|---|---|---|---|---|
| `text-display` | 1.75 (1.2) | 2.5 (1.15) | display 700 | Page hero, public counters |
| `text-h1` | 1.375 (1.25) | 1.75 (1.2) | display 700 | Screen title |
| `text-h2` | 1.125 (1.3) | 1.375 (1.25) | display 500 | Section title |
| `text-body` | **1.0 (1.55)** | 0.9375 (1.55) | body 400 | Default reading text. PWA body is **16px minimum** (sunlight + accessibility). |
| `text-label` | 0.8125 (1.4) | 0.8125 (1.4) | display 500, tracking +0.02em | Field labels, stat labels, tab labels |
| `text-caption` | 0.75 (1.4) | 0.75 (1.4) | body 400 | Help text, timestamps in prose |
| `text-data-lg` | 2.0 (1.1) | 2.5 (1.1) | mono 700, `tabular-nums` | The headline number on a stat card / payout confirm |
| `text-data` | 1.0 (1.2) | 1.0 (1.2) | mono 500, `tabular-nums` | Inline sats, kg, IDs, timestamps in tables |

All mono usages set `font-variant-numeric: tabular-nums` so columns of figures align.

### 4.6 Font loading

- `next/font` with self-hosted Google sources (`Space_Grotesk`, `Hanken_Grotesk`, `JetBrains_Mono`), `subsets: ['latin']`, `display: 'swap'`, exposed as the CSS variables above.
- **Preload** `--font-body` and `--font-mono` on the PWA (they're in the first paint). `--font-display` can load non-blocking.
- No FOIT: the fallback stacks in §4.5 are metrics-close enough that swap is acceptable. Verify with a `size-adjust` pass at M0-16.
- Swahili/Sheng use the Latin script - no extra subset needed. Budget for ~15-25% text expansion vs English in layouts (see §13.6).

---

## 5. Layout systems

### 5.1 Supervisor PWA - "thumb-first single column"

```
┌─────────────────────────────┐
│  ▸ Sync status bar (sticky top)             │  queued 3 · syncing · ✓ confirmed
├─────────────────────────────┤
│                                             │
│   Content - single column, 16px gutters     │
│   Big headings, 16px+ body, generous space  │
│                                             │
│   (multi-step flows use a Vaul bottom       │
│    sheet that slides over this)             │
│                                             │
├─────────────────────────────┤
│   PRIMARY ACTION (full-width, 56-64px tall) │  ← always in the thumb zone
│   secondary action (text button) above it   │
└─────────────────────────────┘
```

- **One primary action per screen**, full-width, bottom-anchored, ≥ 56px tall (64px for the weigh-confirm). Green fill, white text.
- Sync status is a persistent sticky bar (never a toast you can miss) - see §11.3.
- Multi-step (the weigh flow) is a **Vaul drawer / bottom sheet**, not a route push - keeps the queue context visible behind it and is faster to dismiss.
- Camera capture is full-bleed with a single shutter control and a visible "scale + waste must be in frame" guide.
- No hamburger menu. At most a 3-4 item bottom tab bar: **Weigh · Enrol · Queue · Session**.

### 5.2 Admin dashboard - "console app shell"

```
┌────────┬──────────────────────────────────┐
│         │  Top bar: session switcher · ⌘K palette · account   │
│  Side   ├──────────────────────────────────┤
│  nav    │                                                     │
│ (collap │   Main - 12-col grid, 24/32 gutters                 │
│  sible) │   KPI row · charts · tables                          │
│         │                                                     │
│  Sess-  │                        ┌───────────────────┐        │
│  ions   │                        │  Right rail (opt): │        │
│  Rates  │                        │  live anomaly feed │        │
│  Treas- │                        │  / entity detail   │        │
│  ury    │                        └───────────────────┘        │
│  ...    │                                                     │
└────────┴──────────────────────────────────┘
```

- Left sidebar: Sessions, Collectors, Payouts, Treasury, Reconciliation, Anomalies, Map, Reports, API keys, Settings. Collapsible to icons.
- `⌘K` command palette (`cmdk`) for jump-to-session, jump-to-collector, run-report.
- Content is a 12-col grid. KPI cards top, then the primary table/chart, optional right rail for a live feed or a selected-row detail.
- Density toggle (comfortable / compact) affecting table row height and card padding.
- Tables: sticky header, `TanStack Table` for sort/filter/pagination, `TanStack Virtual` when > ~200 rows (events, payouts).

### 5.3 Public site - "confident and numeric"

- Centered, `max-w-6xl`, big vertical rhythm (64-96px between sections).
- Section order: **Live impact counters** → **How it works** (a 3-step flow: Collect → Verify → Pay, optionally with a Magic UI *animated beam* connecting them, re-themed) → **Ledger explorer** (search a sequence, verify a checkpoint) → **Open dataset** (download JSON/CSV, link the API docs) → **Partners** (logos on solid safe-areas per Brand §5) → footer (AGPL badge, repo link, `afribit.africa`).
- The pattern strip appears **once**, as the footer's top accent.
- Hero: wordmark + one sentence + the two lead counters (cumulative kg, cumulative sats). No stock photography behind text.

---

## 6. Component inventory - "need → use this"

This is the table implementors work from. **If a row exists, use it. Do not build your own.**

### 6.1 Primitives & interaction (all surfaces)

| Need | Use | Source | Theming / notes |
|---|---|---|---|
| Button, Input, Select, Checkbox, Radio, Switch, Label, Textarea | shadcn/ui | shadcn/ui (Radix + CVA) | Primary = green fill. Orange only as an *icon* inside a button, never the button text colour. Min height 44px, 56px on PWA primary. |
| Dialog / Modal | shadcn `Dialog` | shadcn/ui | Admin/public only. PWA uses the sheet instead. |
| Bottom sheet / Drawer | `Vaul` (`Drawer`) | vaul (shadcn wraps it) | The PWA weigh flow, enrol flow, filters. Snap points for multi-step. |
| Toast / notification | `Sonner` | sonner | Payout confirmed, report ready, error. **Not** for sync status (that's a persistent bar). Max 1 line + action. |
| Tabs, Accordion, Tooltip, Popover, Dropdown menu, Hover card | shadcn/ui | shadcn/ui | Tooltip disabled on touch - use a popover on the PWA. |
| Command palette | `cmdk` (shadcn `Command`) | cmdk | Admin `⌘K` only. |
| Combobox / async search (collector lookup fallback) | shadcn `Command` in a popover, or Origin UI combobox | shadcn / Origin UI | The manual-search fallback for NFC (G2). Must be fast, keyboard-first, works offline against the cached collector list. |
| Form state + validation | `react-hook-form` + `@hookform/resolvers/zod` | RHF | Zod schemas are shared with the API (Code Style Guide §7). |
| Date / time range picker | shadcn `Calendar` (react-day-picker) + a range preset list | shadcn | Reconciliation, reports, map filter. Presets: today / 7d / 30d / session. |
| Empty states | hand-built pattern (icon + one line + one action) | - | Leaf glyph for "nothing yet, that's fine"; circuit glyph for "waiting on sync". |
| Skeleton / loading | shadcn `Skeleton` | shadcn | Shape-matched, no shimmer animation on the PWA (static grey block). |

### 6.2 Data display (mostly Admin + Public)

| Need | Use | Source | Notes |
|---|---|---|---|
| Data table (sort/filter/paginate) | `TanStack Table` + shadcn table styles | tanstack | Events, payouts, collectors, anomalies, reconciliation rows. |
| Virtualised long list/table | `TanStack Virtual` | tanstack | Auto-enable > ~200 rows. |
| KPI / stat card | shadcn `Card` + our stat pattern (§12), or a re-themed **KokonutUI** stat card | shadcn / KokonutUI | Big number in `text-data-lg` mono. One accent element max. See §12.1. |
| Charts (line/area/bar) | shadcn **Chart** component (wraps `Recharts`) | shadcn/Recharts | kg over time, sats disbursed, reconciliation variance, treasury balance. Series colours: green primary, ink secondary, orange *only* for a single "highlight" series. |
| Sparkline | Recharts `<LineChart>` minimal, or `@tremor` spark | Recharts / Tremor | Inside KPI cards. |
| Dashboard blocks (KPI row, chart+table layouts) | **Tremor** blocks (Apache-2.0, copy-paste) re-themed | tremor | Speeds up the admin build; re-theme to tokens, strip Tremor's default blue. |
| Map | `Leaflet` + `react-leaflet` + OSM raster tiles (v1) | leaflet | Collection points, hotspot density (heat layer). Public view: clustered + jittered per `settings.transparency.public_map_jitter_metres`. |
| Map (self-hosting-friendly upgrade path) | `MapLibre GL` + **Protomaps** PMTiles | maplibre / protomaps | Single-file vector tiles, no tile server - fits the self-host ethos (D-03). Adopt if raster perf/clustering becomes a problem; not required for v1. |
| Timeline (program lifecycle, event history) | Origin UI timeline, or hand-built | Origin UI | Collector history, event → verify → payout → attestation. |
| Badge / status pill | shadcn `Badge` + our status system (§9.3) | shadcn | **Always shape + colour + text.** Never colour alone. |
| Copy-to-clipboard (Lightning address, hash, tag ID) | shadcn button + `navigator.clipboard` | - | Mono text, truncated middle, click to copy, Sonner confirm. |

### 6.3 Motion & delight (scoped - see §10)

| Need | Use | Source | Surface |
|---|---|---|---|
| Number count-up (payout confirm, public counters) | `anime.js` v4 `animate()` + `utils.round` | anime.js | PWA (payout confirm only), Public |
| Sync spinner (circular-arrow motif) | inline SVG + `anime.js` rotate loop, `svg` utilities | anime.js | PWA sync bar |
| Tap-success checkmark draw-on | inline SVG stroke-dashoffset + `anime.js` | anime.js | PWA weigh-confirm |
| Staggered list entrance | `anime.js` `stagger()` (PWA), `Motion` layout/`AnimatePresence` (Admin) | anime.js / Motion | Admin list refresh, PWA queue (subtle, ≤ 300ms total) |
| Layout transitions, drag, gestures | `Motion` (`motion/react`) | motion | Admin + Public only - never in the PWA critical path |
| "Flow" diagram on the public "how it works" | **Magic UI** animated-beam (re-themed) or a static SVG | magic ui | Public only. Static SVG is the fallback if it feels too flashy. |
| Rich cards / backgrounds from **KokonutUI** | selected card + button components, **re-themed to tokens**, gradients removed | KokonutUI | Admin + Public. **PWA: no.** Animated backgrounds: **never.** |
| Aceternity UI effects | evaluate case-by-case; default **no** | aceternity | If used at all, Public hero only, with `prefers-reduced-motion` off-switch, and sign-off against Brand §6.1. |

### 6.4 PWA infrastructure

| Need | Use | Source | Notes |
|---|---|---|---|
| Service worker / offline shell / background sync | `Serwist` (`@serwist/next`) | serwist | Maintained successor to `next-pwa` for the App Router. Precache the shell; Background Sync for the outbox. |
| IndexedDB wrapper | `idb` (Jake Archibald) | idb | Thin, typed. Stores: `events`, `collectors`, `sessionConfig`, `outbox`. |
| Install prompt / A2HS | hand-built using `beforeinstallprompt` | - | A quiet, dismissable banner - not a modal. |
| Camera | `getUserMedia` + `<canvas>` for the SHA-256 (D-12) | web platform | Downscale to ~1600px long edge, JPEG q≈0.7 before hashing/upload. |
| QR scan (BYO Blink Paycode, M1-5) | `@zxing/browser` or `barcode-detection` API with a zxing fallback | zxing | Validate the decoded payload is receive-capable before storing. |
| Web NFC | native `NDEFReader` | web platform | Chrome/Android only; manual search is the first-class fallback (G2). |

### 6.5 Icons

| Need | Use | Notes |
|---|---|---|
| UI icon set | **Lucide** (`lucide-react`) | 2px stroke matches Space Grotesk's geometry. Tree-shaken imports only. |
| Duotone accent icons (sparingly) | **Phosphor** duotone | Only where a two-tone icon genuinely helps (e.g. the leaf/impact marks). Colours limited to green + green-tint, or ink + orange-fill. |
| Material-type icons (PET, HDPE, LDPE, aluminium, glass, paper, e-waste) | **custom set**, commissioned/drawn to spec | Single 2px stroke, monochrome (Ink or Green), legible at 32px, square viewBox. Delivered as an SVG sprite. Placeholder: Lucide approximations until the set lands. |
| "Tap your tag" glyph | **custom**, derived from the logo's circular-arrow | Animated subtly on the PWA idle-lookup screen (anime.js). |
| Brand mark in-app | the delivered `TakaSats logo.png` / app-icon set (`Taka_Sats_App_Icon_*`) | Already produced - do not redraw. |

---

## 7. Library evaluations (with licences)

All licences below are permissive and compatible with the project's **AGPL-3.0-only** distribution. **Pin exact versions; re-verify the API and licence at adoption time** (config-first / verify ethos).

| Library | What it is | Licence | Verdict for Taka Sats |
|---|---|---|---|
| **shadcn/ui** | Copy-in React components on Radix + Tailwind + CVA | MIT | **Foundation - mandated.** You own the code (good for AGPL + audit). Theme via §4 tokens. |
| **Radix UI** | Unstyled accessible primitives (under shadcn) | MIT | **Yes.** Accessibility baseline. |
| **Tailwind CSS** | Utility CSS | MIT | **Yes** (already implied by the Console stack). v4 if the Console is on v4; otherwise pin v3 and match Console. |
| **anime.js** (v4) | Lightweight imperative animation; timeline, stagger, SVG, timers, scroll | MIT | **Yes, scoped.** The user asked for it specifically and it fits: tiny, tree-shakeable (`animate`, `stagger`, `svg`, `utils`), framework-agnostic, ideal for the count-up / checkmark / circular-arrow moments. **Do not** use it for general layout animation (that's Motion's job on Admin). Lazy-import in the PWA. |
| **Motion** (ex-Framer Motion, `motion/react`) | React animation, layout transitions, gestures, `AnimatePresence` | MIT | **Yes, Admin + Public only.** Not in the PWA critical path (bundle + CPU on cheap devices). KokonutUI depends on it. |
| **KokonutUI** | Design-forward copy-paste React components (Tailwind + Motion), shadcn-compatible | MIT / free (open components) | **Yes, selectively.** Cherry-pick cards, buttons, counters, toasts. **Re-theme to §4 tokens** - strip its default gradients and colours. **Never** its animated backgrounds; **never** in the PWA. Verify each component's licence header on copy-in. |
| **Magic UI** | Marketing-oriented animated components (number ticker, animated beam, marquee) | MIT | **Yes, Public only, 1-2 components.** The number ticker and (maybe) the animated beam for "how it works". Re-theme. |
| **Aceternity UI** | Flashy animated sections | Free / mostly MIT (verify per component) | **Default no.** Too much flourish for this brand. If ever used: Public hero only, reduced-motion off-switch, explicit Brand sign-off. |
| **Origin UI** | Large set of shadcn-compatible components (inputs, comboboxes, timelines, tables) | MIT | **Yes, utilitarian.** Good source for the combobox, timeline, richer inputs. |
| **Tremor** (Raw / blocks) | Dashboard KPI + chart blocks (Recharts + Tailwind) | Apache-2.0 | **Yes, Admin.** Speeds the dashboard build; re-theme off Tremor blue. |
| **Recharts** | Composable React charts | MIT | **Yes** - via the shadcn `Chart` wrapper. Stable, well-understood. Wrap so it can be swapped. |
| **visx** / **Nivo** / **unovis** | Lower-level / alternative charting | MIT | **Not for v1.** Revisit only if Recharts can't express a needed chart. |
| **TanStack Table / Virtual / Query** | Headless table, virtualisation, server-state | MIT | **Yes.** Table + Virtual for Admin. Query for the PWA client + live Admin views (App Router reduces but doesn't remove the need). |
| **Leaflet** + **react-leaflet** | Raster-tile mapping | BSD-2-Clause / MIT | **Yes, v1.** Lightest path to an OSM map with markers + heat. |
| **MapLibre GL JS** + **Protomaps** | Vector tiles; PMTiles single-file, self-hostable | BSD-3-Clause / BSD | **Upgrade path.** Adopt if clustering/perf needs it; the PMTiles model suits self-hosting (D-03). |
| **Sonner** | Toasts | MIT | **Yes.** |
| **Vaul** | Drawer / bottom sheet | MIT | **Yes - the PWA's main modal surface.** |
| **cmdk** | Command menu | MIT | **Yes, Admin.** |
| **Lucide** | Icon set | ISC | **Yes - the base UI icon set.** |
| **Phosphor Icons** | Icon set with duotone weight | MIT | **Sparingly**, for duotone accents only. |
| **next-themes** | Theme (dark mode) switching | MIT | **Yes.** |
| **Serwist** | Service worker toolkit for Next App Router | MIT | **Yes - PWA offline layer.** |
| **idb** | IndexedDB promise wrapper | ISC | **Yes.** |
| **@zxing/browser** | QR/barcode decoding in the browser | MIT / Apache-2.0 | **Yes** - BYO Paycode scan, with the native `BarcodeDetector` used first where available. |
| **qrcode** | Generates QR codes (SVG) locally in the browser | MIT | **Yes, Admin only.** Renders a collector's printable credential QR (`takasats:<publicCode>`, identity only). Nothing is sent to a third party. |
| **class-variance-authority**, **tailwind-merge**, **clsx** | shadcn styling utilities | MIT | **Yes** (come with shadcn). |
| **date-fns** + **@internationalized/date** | Date math + i18n-safe dates | MIT | **Yes.** Africa/Nairobi from `settings.programme.timezone`. |

Anything not in this table needs a line in `docs/DESIGN.md` (this file) and a note in the pull request before it enters `package.json`.

---

## 8. Iconography detail

- **Stroke & grid:** 24×24 viewBox, 2px stroke, round caps/joins (Lucide's defaults). Custom icons match this exactly.
- **Colour:** monochrome - `currentColor`, set to Ink or Green by context. Orange only for an icon that is itself a "fill" element (e.g. the bitcoin mark). Never a multicolour icon except the brand mark and the Phosphor duotone exceptions.
- **Status icons:** each status has a **distinct shape**, not just a colour: `queued` = dotted circle, `syncing` = circular-arrow (animated), `confirmed` = check, `needs attention` = triangle, `failed` = octagon/x, `pending payout` = clock. Colour reinforces, never carries the meaning alone (§13.2).
- **Material icons:** ship as one SVG sprite (`public/icons/materials.svg`), referenced by `<use>`. Until the commissioned set exists, map each material to a Lucide placeholder in `lib/materials.ts` so swapping is one file.
- **Sizes:** 16 (inline), 20 (buttons/table), 24 (nav), 32-48 (material chips, empty states), 64+ (the tap glyph).

---

## 9. Motion & animation system

### 9.1 Principles

1. **Functional only.** Feedback (a tap registered), continuity (a sheet's origin), or status (sync progress, a count-up). No ambient/decorative motion.
2. **Fast.** State change 120-200ms · entrance 200-320ms · exit 120-180ms · count-up 800-1200ms (the one long one, and only for a number the user just earned).
3. **Easing.** Entrance `easeOutCubic` · move `easeInOutQuad` · exit `easeInQuad` · count-up `easeOutExpo`.
4. **Stagger** 20-40ms, total capped ≈ 300ms.
5. **One loop, ever:** the circular-arrow sync spinner. Nothing else loops.

### 9.2 `prefers-reduced-motion: reduce` - hard rule

When set, **every** animation degrades to either an instant state change or a ≤ 100ms opacity fade. The count-up shows the final number immediately. The sync spinner becomes a static icon with text ("Syncing…"). This is enforced with a single `useReducedMotion()` gate (Motion) and an `anime`-side guard util; a Playwright test asserts the count-up is skipped under the emulated setting.

### 9.3 Per-surface policy

- **PWA:** anime.js only, lazy-loaded (`import('animejs')` inside the 3 screens that use it: weigh-confirm, sync bar, payout-confirm). Tree-shake to `{ animate, stagger, svg, utils }`. No Motion. Total animation JS on the critical path: **0 bytes** (all deferred).
- **Admin:** Motion for layout/list transitions and `AnimatePresence`; anime.js if an imperative count-up is needed. Keep entrances subtle - this is a work tool.
- **Public:** Motion + one Magic UI ticker + optional animated beam. Still restrained - the numbers are the star, not the transitions.

### 9.4 The sanctioned brand animation

The logo's **circular arrow** is the only motif we animate as a loop, and only to mean "recycling / syncing / in progress":
- Syncing: rotate 360° over 1.4s, linear, infinite, `will-change: transform`.
- Confirmed: stop at 0°, a 240ms `easeOutBack` settle, then swap to the check icon.
- Drawn as a single `<path>` so it stays crisp at 16-24px and respects `currentColor`.

---

## 10. Card & surface design (the anti-template rules)

The Brand Guidelines single out bordered cards + flourishes as the tell of template design. So:

1. **Separate with space and shade first.** A "card" is often just a white block on the cream canvas with 16-24px padding and generous margin - **no border, no shadow**.
2. **If it needs an edge, pick one:** a 1px `#DEDEDE` border **or** `elev-1` shadow. Not both. Not plus a gradient. Not plus a coloured left-bar unless that bar *is* the status indicator.
3. **Radius consistency:** cards 12px, everything inside them ≤ 8px. One screen, one card radius.
4. **No nested cards.** A card inside a card means the hierarchy is wrong - use a divider or a subhead.
5. **Max one accent per card.** A stat card has a big number *or* a trend chip *or* an orange indicator dot - not all three.
6. **Headers are type, not chrome.** A card title is `text-label` in Space Grotesk; it doesn't need a filled header band.

### 10.1 Stat card pattern (Admin KPI, Public counter)

```
┌ (white block, 12px radius, elev-1, 20px pad) ─────────┐
│  KG COLLECTED                          ▸ +4.2% wk      │   ← text-label (display 500), optional trend chip (green text, no bg)
│  12,480                               kg               │   ← text-data-lg (mono 700), unit in text-label muted
│  ····································· sparkline ······  │   ← optional, green stroke, no fill, no axis
└──────────────────────────────────────────┘
```

### 10.2 Session card (Admin list / PWA session tab)

- Status = a coloured **dot + word** top-left (`● Active`, `○ Scheduled`, `◍ Closed`), not a full pill fill.
- Location in `text-h2`, window in `text-data` mono, assigned supervisors as small avatars/initials.
- One primary action (`Open` / `Monitor`), text button.

### 10.3 List row (events, payouts, anomalies)

- Row height 48 (compact) / 56 (comfortable). Zebra via a 2% ink wash on odd rows, **no row borders**.
- Left: status icon (shape-coded). Then mono data columns, right-aligned numbers. Trailing: a `⋯` menu.
- Tap target for the whole row on the PWA; hover-reveal actions on Admin.

---

## 11. Key screen blueprints

Wireframe-level, to align implementors. Full behaviour is in `docs/REQUIREMENTS.md` (the FR/US the screen serves is noted).

### 11.1 PWA - Weigh flow (FR-2.1, US-2.1) - a single Vaul sheet, 4 snap steps

1. **Collector** - big "Tap tag" target with the animated tap glyph; below it, a text button "Search by name" → cached combobox. On resolve: collector alias in `text-h1`, small "not them?" reset.
2. **Material** - a grid of material chips (icon + localized label), only those with an active rate this session. One tap advances.
3. **Weight** - a large numeric keypad, value shown in `text-data-lg` mono with `kg`. (BLE auto-fills this later; manual always available.) "Next" primary.
4. **Photo + confirm** - full-bleed camera with the in-frame guide; shutter; then a review line (`alias · material · 4.2 kg · ≈2,100 sats` - the sats in mono, prefixed `≈` because it's indicative). Confirm = 64px green primary. On confirm: the checkmark draw-on, sheet closes, queue count increments, Sonner "Saved - queued".

Never blocks on network. GPS-missing shows an inline amber-free warning (Ink + triangle icon) before allowing save.

### 11.2 PWA - Enrol (FR-1.2, US-1.1)

- One field: **Alias**. Big. Then two buttons: **"Scan their wallet QR"** (BYO, default) and - only if `custody.provisioning_enabled` - **"Issue a wallet"**.
- Scan path: full-bleed QR scanner → decoded → "Receive-only ✓" check (or a clear reject for a withdraw code) → "Write tag" → hold tag to phone → success.
- Whole thing is one sheet, works offline (validation deferred).

### 11.3 PWA - Sync status (FR-4.3, US-4.3)

- Sticky top bar, always present. Three visual states, each **shape + colour + text**:
  - `Queued (3)` - dotted-circle icon, Ink text, muted bg.
  - `Syncing…` - circular-arrow spinner (the brand animation), green text.
  - `All synced ✓` - check, green-tint bg, collapses to a thin line after 3s.
  - `1 needs attention` - triangle, `--destructive` text, tap → the needs-attention list with reasons.
- Tapping the bar opens the Queue tab (full list with per-item state).

### 11.4 Admin - Session live view (FR-8.2, US-8.2)

- Header: session name, `● Active`, window (mono), supervisors.
- KPI row (stat cards): Collectors verified · KG collected · Sats disbursed · Pending payouts · Anomaly flags.
- Main: a live event stream table (TanStack + Virtual, newest on top, SSE-updated) with a small area chart of cumulative kg above it.
- Right rail: live anomaly feed - each flag a compact row with type, event link, "review" action.
- Everything updates without a manual refresh; new rows fade in (Motion, 200ms, reduced-motion → instant).

### 11.5 Admin - Reconciliation (FR-3.5, US-3.5)

- Filters: date range presets + material.
- A grouped bar chart: paid-kg vs sold-kg per material; variance % labelled; bars over tolerance get an orange highlight (fill) + a triangle marker.
- Below: the `reconciliation_reports` table, flagged rows first.
- "Export" → branded PDF (same renderer as partner reports).

### 11.6 Admin - Treasury (FR-7.5, US-7.5)

- Three stat cards on one row: **Float balance** (provider name as the label), **Cold reserve** (watch-only), **Pending payouts**.
- A balance-over-time area chart.
- Low-float state: the Float card's number turns Ink-bold with a triangle + "below threshold" line (no red unless the payout pipeline is actually failing).
- Actions: "Record top-up" → the two-sign-off flow.

### 11.7 Public - Impact home

- Hero: wordmark, one sentence, two big `AnimatedTicker` counters (cumulative kg, cumulative sats) in `text-display` mono.
- "How it works": Collect → Verify → Pay, three cards, optional animated beam between them (or a static SVG).
- "Every payout is on a public ledger" → a search box (enter a sequence number) + the latest checkpoint (hash, signed, timestamp, "verify" link to `docs/LEDGER.md`).
- "Open data" → download JSON/CSV, link `/api/v1/docs`.
- Partners on solid safe-areas. Footer: pattern strip accent, AGPL badge, GitHub link, `afribit.africa`.

---

## 12. Accessibility (WCAG 2.1 AA minimum; the money/evidence paths aim AAA)

1. **Contrast** - only the pairings the Brand Board marks PASS. Orange is never text on light. A CI check (see §13.1) fails the build on a disallowed pairing.
2. **Never colour alone** - every status is shape + colour + text (§8, §11.3).
3. **Touch targets** - 44px min, 56-64px for PWA primary actions. 8px min gap between targets.
4. **Focus** - visible 2px `--ring` outline, 2px offset, on every interactive element. Never `outline: none` without a replacement.
5. **Keyboard** - full keyboard operation on Admin (tables, palette, dialogs). Radix/shadcn give this; don't break it.
6. **Reduced motion** - §9.2, enforced + tested.
7. **Screen reader** - semantic landmarks, `aria-live="polite"` on the sync bar and live KPI values, labelled form controls (RHF + shadcn `Label`), meaningful `alt` on the evidence photo thumbnails ("scale reading and waste for event …").
8. **Outdoor/sunlight** - the PWA ships a "high contrast" affordance that swaps the cream canvas for pure white and bumps text to the next weight; test on a real device at midday (M8-3).
9. **One-handed** - primary actions in the bottom third; nothing critical in the top corners.
10. **Text expansion** - Swahili/Sheng run ~15-25% longer than English; layouts must not truncate labels or break at that length. Pseudo-locale test in CI (M8-4).

---

## 13. Enforcement - how this stays true

| Rule | Enforcement |
|---|---|
| §13.1 Only PASS colour pairings | An ESLint/stylelint rule + a Playwright axe pass on every route; disallowed pairing fails CI. `--fill-bitcoin` is the only Orange token and its name signals "not text". |
| §13.2 Status = shape + colour + text | Code review checklist item; the `<StatusPill>` / `<StatusIcon>` components only accept a `status` enum, never a raw colour. |
| §13.3 No new fonts, no ninth colour | Tokens live in one file; a PR touching raw hex outside `globals.css` is flagged. The one sanctioned addition (`--destructive` red) is documented in §4.4. |
| §13.4 Motion is functional + reduced-motion-safe | `useReducedMotion` gate is mandatory; a Playwright test asserts count-up/spinner degrade. No `@keyframes` loops except the sync spinner (grep check). |
| §13.5 PWA bundle budget | CI size check on the PWA entry + weigh route; Motion/KokonutUI imports in PWA code fail the check. anime.js must be dynamically imported. |
| §13.6 Reuse over rebuild | Review checklist: "does §6 already map this need?" A hand-rolled table/drawer/toast is a change-request. |
| §13.7 New dependency | Must be added to §7 (this file) in the same PR, with its licence noted. |

---

## 14. Asset pipeline

- **Fonts:** `next/font` self-hosted, variables per §4.5. No CDN font loads (offline + privacy + the CSP the PWA will set).
- **Icons:** Lucide via tree-shaken imports; custom material sprite at `public/icons/materials.svg`; the tap glyph as an inline React component (it animates).
- **Brand assets (already delivered - do not recreate):** `TakaSats logo.png`, `Taka_Sats_Brand_Board.png`, `Taka_Sats_Brand_Pattern_Strip.png`, `Taka_Sats_NFC_Tag_Front/Back.png`, `Taka_Sats_App_Icon_{512,192,64,32}.png`. Store under `public/brand/`; the app-icon set feeds the PWA manifest.
- **PWA manifest:** name "Taka Sats", theme colour `#3E6336` (green - it's the safe one), background `#FAF8F4`, icons from the delivered set, `display: standalone`, `orientation: portrait`.
- **Evidence photos:** never bundled - R2/MinIO at runtime; thumbnails generated server-side.

---

## 15. What implementors must NOT do

- ❌ Set Bitcoin Orange as a text colour on a light background. (Use Taka Green, or Ink.)
- ❌ Introduce a fourth typeface or a ninth colour (the `--destructive` red in §4.4 is the *only* sanctioned addition).
- ❌ Ship Motion, KokonutUI, or any animated background in the Supervisor PWA critical path.
- ❌ Use colour as the only signal for a status.
- ❌ Stack border + shadow + gradient on a card. Pick at most one edge treatment.
- ❌ Tile the pattern strip or put it behind text. Once per screen, as an accent.
- ❌ Add a dependency without updating §7 here.
- ❌ Hand-roll a component that §6 already maps to a library.
- ❌ Animate anything as a loop except the circular-arrow sync spinner.
- ❌ Block a supervisor interaction on a network call or an animation finishing.

---

## 16. Open design questions

| # | Question | Needs |
|---|---|---|
| DQ-1 | Material-type icon set - commission, or draw in-house? Which materials in the v1 set? | Afribit + a designer; blocks final chips, Lucide placeholders unblock M3 |
| DQ-2 | Is a PWA dark/night mode in scope for v1, or light-only + the high-contrast toggle? | Field input (do supervisors work after dark?) |
| DQ-3 | Public "how it works" - animated beam (Magic UI) or a static SVG? | Brand sign-off against §2.4 restraint |
| DQ-4 | Exact Space/Hanken/JetBrains weights available from the Console - confirm 500/700 and 400/500 are the licensed cut | Console Ecosystem Brief owner |
| DQ-5 | KokonutUI / Tremol / Origin UI components - which specific ones do we copy in? Freeze a shortlist at M2 so the Admin build isn't a scavenger hunt | Design + implementor pairing session |
| DQ-6 | Do partners get the dark theme by default (report-friendly) or light? | Ronnie |

---

## 17. Adoption checklist by milestone (what design work each build milestone pulls in)

| Milestone | Design/UI deliverables |
|---|---|
| **M0** | Tokens in `globals.css` (§4); `next/font` setup (§4.6); shadcn/ui init + theme; Lucide; `next-themes`; Serwist scaffold; a `<StatusIcon>`/`<StatusPill>` stub; the axe + colour-pairing CI check (§13.1); this file linked from `README`/`CONTRIBUTING` |
| **M1** | Enrol screen (§11.2); QR scanner component; tap glyph; Vaul sheet pattern |
| **M2** | Admin app shell (§5.2); sidebar; `⌘K` palette; session config form (RHF+Zod); rate table UI; KokonutUI/Tremor/Origin shortlist frozen (DQ-5) |
| **M3** | Weigh flow sheet (§11.1); material chips + placeholder icons; numeric keypad; camera + in-frame guide; sync status bar (§11.3); anime.js checkmark |
| **M4** | Queue / needs-attention list; ledger-entry row style; the circular-arrow sync spinner (§9.4) |
| **M5** | Payout-confirm count-up (anime.js); treasury stat cards (§11.6); two-sign-off flow UI |
| **M6** | Admin live session view (§11.4); reconciliation charts (§11.5); anomaly review queue; data tables + virtualisation |
| **M7** | Public site (§5.3, §11.7); number tickers; ledger explorer; partner dashboard + branded report PDF renderer; Leaflet map |
| **M8** | Sunlight/high-contrast pass; material icon set lands (DQ-1); pseudo-locale layout pass; reduced-motion test; a11y audit |

---

*This document is subordinate to `Taka_Sats_Brand_Guidelines.md`. It is maintained alongside the code: a new component, dependency, or pattern lands here in the same PR.*
