# Handoff: Upway Drop-off Portal (check-in + Einlieferungsbeleg)

## Overview

Operator-facing tool used at the counter of an Upway UpCenter when a customer drops off an e-bike for purchase.

The operator:
1. Finds the customer in the day's schedule.
2. Verifies seller, bike data and handover accessories — **all on one screen, at the same time**, because that is how the conversation with the customer actually goes.
3. Generates the **Einlieferungsbeleg** (drop-off receipt), which is saved to Google Drive and printed for the customer.

Target runtime: a **Google Sheets–backed AppSheet app** (or an Apps Script web app). The HTML in this bundle is the visual and behavioural spec.

## About the design files

The files in this bundle are **design references created in HTML** — prototypes showing the intended look and behaviour, not production code to copy directly. The task is to **recreate these designs in the target environment** (AppSheet views + Apps Script HTML service, React, or whatever the project already uses), following that environment's established patterns.

`Drop-off Portal v2.dc.html` is written for an internal component runtime and will not run standalone; read it as markup + logic reference. All styling is inline; all colors come from the Upway design tokens listed below.

## Fidelity

**High-fidelity.** Colors, type, spacing, radii and interaction states are final. Recreate pixel-close using the codebase's own component library where equivalents exist (buttons, inputs, cards). The document (beleg) layout in particular should be reproduced faithfully — it is a printed customer-facing artefact.

Sample data (appointments, quotes, customer names) is fake. Wire it to the real Sheet.

---

## Screens

### 1. Header (persistent, all screens)

Sticky, height 64px, `rgba(255,255,255,.94)` + `backdrop-filter: blur(10px)`, 1px bottom border `--ink-200`, horizontal padding 24px.

Left → right:
- Upway logo, height 16px (`assets/upway-logo.webp`).
- 1px × 20px divider, `--ink-200`.
- "Drop-off desk", 14px / weight 500 / letter-spacing −0.01em / `--ink-700`. Sentence case, not uppercase — it sits on the logo's baseline.
- Right: **warehouse selector**. A 38px-tall button, 1px `--ink-300` border, radius 10px, white, 14px/500 label, map-pin icon 15px left and chevron-down 14px right. Hover: border `--ink-500`.

**Warehouse dropdown** (opens on click): absolutely positioned 46px below the trigger, right-aligned, width 268px, `box-sizing: border-box`, white, 1px `--ink-200`, radius 14px, shadow `0 12px 32px rgba(14,14,20,.14)`, padding 6px, `max-height: 340px; overflow-y: auto; overflow-x: hidden`, z-index 60.
Each row: padding 10px 12px, radius 9px, hover `--ink-100`. Two lines — warehouse name (14.5px/500; `--blue-600` when active, else `--ink-900`) and address (12.5px, `--ink-500`). Active row shows a 16px blue check on the right.

Closing rules (all required): click on the item, click anywhere outside the trigger or panel, `Escape`, and any screen change (opening a check-in, generating a beleg, going back to the schedule).

Warehouse list and addresses:

| Warehouse | Address |
|---|---|
| Berlin | Alexander-Meißner-Straße 77D · 12526 Berlin |
| Düsseldorf | Höherweg 271 · 40231 Düsseldorf |
| Stuttgart | Hauptstätter Straße 149 · 70178 Stuttgart |
| Amsterdam | Contactweg 47 · 1014 AN Amsterdam |
| Antwerp | Noorderlaan 133 · 2030 Antwerpen |
| Gennevilliers | 12 Rue des Chardons · 92230 Gennevilliers |
| Los Angeles | 1933 S Broadway · Los Angeles, CA 90007 |
| New York | 37-24 24th St · Long Island City, NY 11101 |

> Confirm this list and the addresses against the real warehouse master data before shipping.

### 2. Today's schedule (queue)

Container max-width 1180px, centred, padding 40px 24px 80px. Page background `--ink-100`.

**Page head** — flex row, space-between, wraps:
- Eyebrow "Today's schedule", 12px/700, uppercase, letter-spacing 0.06em, `--blue-500`.
- H1 = today's date, e.g. "Monday, 10 August", 36px/700, line-height 1.08, letter-spacing −0.02em.
- Address line: 14px `--ink-600` with a 14px map-pin icon in `--ink-400`.
- Right: three counters, gap 36px. Value 30px/700, letter-spacing −0.02em; label 12px/700 uppercase 0.06em `--ink-500`.
  - Scheduled (`--ink-900`) · Awaiting check (`--blue-500`) · Filed (`--green-500`).

**Toolbar** (margin-top 32px, flex, gap 10px):
- Search field: height 44px, white, 1px `--ink-300`, radius 12px, 16px search icon, placeholder "Search bike ID, customer or model", max-width 400px. Filters rows client-side across bike ID + customer + brand/model.
- Segmented control: white container, 1px `--ink-300`, radius 12px, padding 4px, gap 4px. Segments height 36px, padding 0 14px, radius 9px, 14px/500. Active: solid `--blue-500` background, white text. Inactive: `--ink-600`, hover `--ink-100`. Options: **Today** (default) · **Next 10 days** · **Past 10 days**.

**Table** — white, 1px `--ink-200`, radius 20px, `overflow: hidden`, margin-top 20px.

Grid (header and rows share it): `108px  minmax(160px,1.5fr)  minmax(130px,1fr)  96px  168px`, gap 14px, padding 16px 22px (header 13px 22px), 1px `--ink-200` row separators.

Columns: Bike ID · Bike · Customer · Quote · (actions). Header cells 12px/700 uppercase 0.06em `--ink-500`.

There is **no time-slot column** — Upway does not book slots.

Row, **pending** state:
- Bike ID as a chip: `--blue-50` background, `--blue-600` text, 13px/700, letter-spacing 0.03em, padding 4px 9px, radius 7px.
- Bike: model name 15px/500 over a 12.5px `--ink-500` sub-line ("2022 · 1.240 km", German thousands separator).
- Customer 14.5px `--ink-700`; Quote 14.5px/500.
- Right: primary button, size sm — **"Check in"**.
- Row hover: background `--ink-50`.

Row, **filed** state — the entire row reads as done:
- Row background `--ink-50`, no hover change.
- Bike ID chip goes `--ink-200` / `--ink-500`.
- Bike name `--ink-500`, sub-line `--ink-400`, customer and quote `--ink-500` (quote loses its weight).
- Right: a muted "✓ Filed" label (13px, `--ink-400`) and a **ghost "Reopen"** button — the only coloured, actionable element in the row.

### 3. Check-in (single page — not a wizard)

Container max-width 1180px, padding 26px 24px 60px.

Top: "Back to schedule" text link, 14px `--ink-600` with a 15px chevron-left; hover `--blue-500`.

Layout: CSS grid `minmax(0,1fr) 320px`, gap 28px, `align-items: start`.

**Left column** — three cards stacked, gap 16px. Every card: white, 1px `--ink-200`, radius 20px, padding 26px 28px 28px.

Card header pattern: a 24px rounded-square (radius 7px, `--blue-50` bg, `--blue-600` text, 12px/700) holding the step number, then the title at 17px/700, letter-spacing −0.01em. Optional right-aligned meta at 13px `--ink-500`.

**Card 1 — Seller & appointment**
Grid `150px minmax(0,1fr)`, gap 16px.
- **Bike ID** — height 46px input, 1px `--ink-300`, radius 10px, 16px/700, letter-spacing 0.03em, `--blue-600`, `text-transform: uppercase`.
- **Name Verkäufer\*in** — 46px input, 15.5px, placeholder "Full name". Prefilled from the booking but **editable**: the person at the counter is often not the person who booked. When the value differs from the booking, show below it, 12.5px `--ink-500` with a 13px blue info icon: "Booked under {original name}".

**Card 2 — Bike data**
Grid `repeat(2, minmax(0,1fr))`, gap 16px. All inputs 46px / 15.5px / radius 10px / 1px `--ink-300`.
- Marke, Modell, Kilometerstand (placeholder "1240 km"; value is digit-stripped and re-formatted with German separators for the receipt).
- **Rahmennummer** — new field, **entered by hand**, not in the system. Its label carries a small `MANUAL` tag (padding 2px 6px, radius 5px, `--ink-100` bg, `--ink-600`, 10.5px, letter-spacing 0.04em). Uppercase the **value** on input; do not put `text-transform: uppercase` on the element or the placeholder shouts.
- **Jahr** and **Batteriekapazität** — rendered **only when the warehouse is not Berlin**. Berlin's receipt does not carry them. Toggling the warehouse selector adds/removes both from the form and from the document.

**Card 3 — Handover**
Header meta: "{n} of 4 handed over".
4-up grid, gap 10px, of toggle tiles. Tile: min-height 92px, padding 14px, radius 14px, `box-sizing: border-box`, 1.5px border. Inside, a top row (space-between) with a 20px line icon on the left and the checkbox on the right, then the German label 15px/500.
- Off: white, border `--ink-300`, icon `--ink-400`, label `--ink-600`, empty 22px checkbox (radius 6px, 1.5px `--ink-300`); hover border `--ink-500`.
- On: `--blue-50`, border `--blue-500`, icon `--blue-600`, label `--blue-800`, checkbox filled `--blue-500` with a white 13px check.

Items and icons (Lucide-equivalent, 24×24 grid, 1.8px stroke, round caps): **Akku** battery · **Ladegerät** plug · **Schlüssel** key · **Display** monitor.

Below: **Notizen** textarea, min-height 96px, radius 10px, 15px/1.5, `resize: vertical`, placeholder "Zustand, Kratzer, fehlende Teile …".

**Right column — summary panel** (`position: sticky; top: 88px`), white, 1px `--ink-200`, radius 20px, `overflow: hidden`. Three stacked sections separated by 1px `--ink-200`:
1. Eyebrow "Drop-off" (12px/700 uppercase `--ink-500`), bike name 22px/700 −0.02em, then quote 26px/700 with a 13px `--ink-500` "quoted" on the baseline.
2. Live key/value list: label 12.5px `--ink-500` on the left (fixed 108px), value 13.5px right-aligned. Values render `--ink-900` when filled and `--ink-400` when missing; Rahmennummer shows the word "Missing" while empty. Rows: Bike ID, Verkäufer\*in, Rahmennummer, Kilometerstand, [Jahr, Batterie — non-Berlin only], Zubehör.
3. Full-width primary button **"Generate beleg"** (size lg), and below it 12.5px `--ink-500` "Saved to Drive · {year} › {warehouse}".

This panel replaces the old review step. Real verification happens when the operator reads the printed sheet.

### 4. Document view (beleg)

Full-screen after generating. Page background `--ink-200`.

**Action bar** — sticky under the header, white, 1px bottom `--ink-200`, padding 12px 24px, max-width 1180px:
- "Back to schedule" link.
- A green pill: `--green-100` bg, `#0B7A48` text, 13px/500, radius 999px, 13px check icon, label "Beleg {BIKE-ID}.pdf".
- Right: secondary **Edit details** · secondary **Print** · primary **Save to Drive & close**.

**Pages** — two A4 sheets, centred, gap 24px, each 794 × 1123px (`box-sizing: border-box`), white, shadow `0 1px 3px rgba(0,0,0,.08), 0 16px 36px rgba(14,14,20,.10)`, padding 60px 64px 52px, `position: relative`, with a 5px `--blue-500` bar across the top.

Both pages start with the logo (20px) on the left and a right-aligned block: "UPCENTER {WAREHOUSE}" (11px/700, letter-spacing 0.06em, `--ink-900`) over the address (11px `--ink-500`). Both end with a footer pinned 36px from the bottom: "Upway · Einlieferungsbeleg {BIKE-ID}" left, "Seite n / 2" right, 10px `--ink-500`.

Section header pattern: a two-digit blue number (12px/700, letter-spacing 0.08em, `--blue-500`), the title in the same size in `--ink-900`, then a 1px `--ink-200` rule filling the remaining width.

Field pattern: 10px/700 uppercase 0.08em `--ink-500` label over a 16px value, 10px bottom padding, 1px `--ink-200` underline.

**Page 1**
- H1 "Einlieferungsbeleg" 28px/700 −0.02em, subline 13px `--ink-600`: "Nachweis über die physische Abgabe eines E-Bikes zum Ankauf".
- `01 VERKÄUFER*IN` — Bike-ID (16px/700, `--blue-600`) and Name Verkäufer\*in, two columns.
- `02 FAHRZEUGDATEN` — Marke & Modell, Kilometerstand, **Rahmennummer**, plus **Jahr** and **Batteriekapazität** when the warehouse is not Berlin.
- `03 ÜBERGABE-CHECKLISTE` — "ZUBEHÖR" label, then the four items in a row with 15px checkboxes (filled `--blue-500` with white check when handed over, else 1px `--ink-400` outline) and 13.5px labels. Then "NOTIZEN" and a bordered box, min-height 120px, radius 8px, `white-space: pre-wrap`.

**Page 2**
- `04 RECHTLICHE HINWEISE` — intro line "Mit der Abgabe im UpCenter {warehouse} erkennt der/die Verkäufer\*in folgende Bedingungen an:" then three numbered clauses (blue numeral, 13px/1.6 body): Technische Tiefenprüfung (§ III AGB), Eigentumsvorbehalt (§ VIII), Akku-Sicherheit (§ IX). Copy is carried over verbatim from the legacy receipt — **have Legal confirm before rollout**.
- `05 BESTÄTIGUNG DER EINLIEFERUNG` — Datum and Uhrzeit, two columns, auto-filled at check-in and editable.
- Signature rule: 300px wide, 1px `--ink-700`, caption "Unterschrift Upway (Annahme)" 10.5px `--ink-500`.
- Thank-you block: "Danke für Ihr Vertrauen!" 17px/700 with a 13px `--ink-600` paragraph, and on the right the Google review badge and QR code.

---

## ⚠️ Not in this demo — must be built

**1. The QR code and Google review badge are placeholders.** On page 2 they are two dashed rectangles labelled "Google review badge" (120 × 72) and "QR" (88 × 88). In production:
- Drop in the real **Google review badge** image asset.
- Render a real **QR code** pointing at the review link **for the warehouse the beleg was issued at** (each UpCenter has its own Google Business listing — the link must not be hardcoded to Berlin). Generate it server-side or with a QR library and embed it as PNG/SVG; keep it ≥ 88px at print size with a quiet zone, error-correction level M or higher.
- If the review destination differs per country/language, resolve it from the same warehouse record as the address.

**2. PDF generation is not implemented.** "Print" only calls `window.print()`; "Save to Drive & close" just returns to the schedule. Production needs:
- A real PDF built from the two A4 pages — either `@page { size: A4; margin: 0 }` print CSS with the on-screen sheets as the print target, or server-side rendering (the legacy Python app used jsPDF). Whichever route, the two pages must break exactly at the sheet boundary and the images (logo, badge, QR) must be embedded, not linked.
- Upload to Google Drive in a deterministic folder, e.g. `Drop-offs / {year} / {warehouse} / {BIKE-ID}.pdf`, and write the resulting file ID/URL back to the row in the Sheet.
- Mark the appointment row as filed so the schedule renders it in the grey/Reopen state.
- Send it to the printer at the counter.

**3. Data is fake.** The six appointments, quotes, and customer names are sample rows. Bind the schedule to the real Sheet/Metabase feed; `Check in` must load the real record and `Reopen` must load the previously saved values, not the booking defaults.

**4. Not yet handled:** offline/spotty-wifi behaviour at the counter, duplicate check-in of the same Bike ID, who the operator is (the header no longer shows an operator; if the receipt or audit log needs one, capture it from the session), and any customer signature capture (the sheet only has an Upway signature line).

---

## Interactions & behaviour

| Trigger | Result |
|---|---|
| Row "Check in" / "Reopen" | Load that appointment into the check-in screen; prefill seller, brand, model, mileage, year; default Akku + Ladegerät ticked; stamp Datum/Uhrzeit with the current time. |
| "Back to schedule" | Return to queue. Unsaved edits are currently dropped — add a confirm if the real app should warn. |
| Warehouse change | Swap header address, receipt address/UpCenter line, and show/hide Jahr + Batteriekapazität everywhere. |
| Search input | Live client-side filter. |
| Accessory tile | Toggle; updates the "{n} of 4" meta and the summary panel. |
| "Generate beleg" | Switch to the document view and mark the row filed. |
| "Edit details" | Back to the check-in screen with values intact. |

Motion: 120–320ms, `cubic-bezier(0.2,0,0,1)`. No bounce. Buttons scale to ~0.97 on press. Focus ring: 3px `rgba(71,51,255,.15)` plus a `--blue-500` border on inputs.

Touch targets: the tool runs full-screen in a browser and on a counter tablet — inputs are 46px, buttons ≥ 34px (sm) / 50px (lg), accessory tiles 92px. Do not go below 44px for anything the operator taps repeatedly.

## State

```
screen        'queue' | 'form' | 'doc'
sel           index of the selected appointment
query         search string
period        'today' | 'next' | 'past'
warehouse     selected warehouse name
whOpen        warehouse dropdown open
f             { bikeId, seller, brand, model, mileage, frame, year, battery, notes, datum, uhrzeit }
acc           { akku, lade, schl, disp }  booleans
filed         map of bikeId → true
```

## Design tokens

Upway Design System. Use the token variables, not raw hex, if the codebase has them.

| Token | Value | Use |
|---|---|---|
| `--blue-500` | `#4733FF` | primary actions, active states, section numerals, receipt top bar |
| `--blue-600` | darker step | primary hover, Bike-ID text |
| `--blue-800` | | label text on selected tiles |
| `--blue-50` | | tinted chip/tile backgrounds |
| `--green-500` / `--green-100` | | filed counter, success pill (`#0B7A48` text) |
| `--ink-900` | near-black | body and headings |
| `--ink-700` / `--ink-600` | | secondary text |
| `--ink-500` / `--ink-400` | | labels, muted/missing values |
| `--ink-300` | | input and tile borders |
| `--ink-200` | | hairlines, card borders, page background of the doc view |
| `--ink-100` / `--ink-50` | | app background, row hover |

Type: **Maison Neue** (Book 400 / Medium 500 / Bold 700). One scale, used consistently:

| Role | Size / weight |
|---|---|
| Page title | 36 / 700 / −0.02em |
| Counters, doc H1 | 30–28 / 700 / −0.02em |
| Panel title | 22 / 700 / −0.02em |
| Card title | 17 / 700 / −0.01em |
| Input value | 15.5–16 / 400–500 |
| Row text | 14.5–15 |
| Meta / sub-line | 12.5–13.5 |
| Uppercase label | 12 / 700 / 0.06em (10 / 0.08em on the receipt) |

`font-variant-numeric: lining-nums tabular-nums` is set globally — without it Maison Neue's digits sit shorter than the caps and IDs like `RK2EP9` look broken. Keep it.

Radii: inputs 10 · chips/tags 7 · tiles 14 · cards and table 20 · pills 999.
Spacing: 8px rhythm with a 4px half-step. Content max-width 1180px.
Shadows: dropdown `0 12px 32px rgba(14,14,20,.14)`; paper `0 1px 3px rgba(0,0,0,.08), 0 16px 36px rgba(14,14,20,.10)`. Cards use hairline borders, not shadows.

## Assets

- `assets/upway-logo.webp` — electric-blue wordmark, used in the header (16px) and on both receipt pages (20px). Included in this bundle. Never redraw it.
- Icons: Lucide-equivalent line icons, 24×24, 1.8–2px stroke, round caps, `currentColor`. Used: map-pin, chevron-down, chevron-left, search, check, info, battery, plug, key, monitor.
- **Missing:** Google review badge image and the per-warehouse review QR code (see the section above).

## Files

- `Drop-off Portal v2.dc.html` — the full design: queue, check-in, and both receipt pages.
- `assets/upway-logo.webp` — logo.
- `legacy_upway_einlieferungsbeleg_berlin.html` — the original Berlin receipt this redesign replaces; use it to cross-check the German legal copy.
