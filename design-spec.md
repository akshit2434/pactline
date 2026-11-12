# Pactline design spec (one page)

**Inspiration read (12 Nov; screenshots kept outside the repo in `desk/screenshots/pactline/refs/`):** PayPal sign-in and developer dashboard (pill buttons, 1px hairline cards, deep PayPal blue `#0551B5`, black secondary pill, big confident headings, almost no chrome); Stripe Link (one white card, one big action, soft shadow, generous space); Wise (one huge fact, friendly weight); Mercury (calm, tinted, soft type); Linear (restraint, dense-but-quiet). Takeaway: one card, one number, one pill button per screen.

## Principles
One decision per screen. One primary pill action. The one fact that matters is huge (held amount / next release). Details hide behind a tap (verdict reasons, oracle, raw PayPal request). Optimistic UI with skeletons. No confetti: completion = ring draw, count-up, soft green glow. Money is always visible moving (hold fills the vessel, release slides to the payee).

## Palette (light primary, dark optional via `data-theme`)
| Role | Light | Dark | Use |
|---|---|---|---|
| bg | `#F3F6FA` | `#0A1224` | page |
| surface | `#FFFFFF` | `#111C33` | cards |
| line | `#E1E7EF` | `#22314F` | hairlines |
| ink / ink-2 / ink-3 | `#0B1B3A` `#3B4B66` `#5B6B82` | `#EEF3FB` `#B7C3D9` `#93A2BD` | text (all ≥4.5:1 on surface) |
| PayPal blue (primary, HOLD) | `#0070E0` hover `#0059B8` | `#4C9AFF` | primary pill, held money |
| Navy | `#003087` | `#8DB8FF` | brand, headings accent |
| Released (green) | `#0B7A3E` on `#E7F6EC` | `#4ADE80` | released, success |
| Proof / checking (amber) | `#8A4B00` on `#FEF4DC` | `#FBBF24` | checking, needs review |
| Rejected / danger (red) | `#B42318` on `#FDECEA` | `#F87171` | rejected, cancel |
| Pending / voided (slate) | `#5B6B82` on `#EEF2F7`, hatched when voided | | pending, voided |
State is never colour alone: each state also has an icon and a word. Charts (balance step line, hold bar) use dataviz roles: single series `#2A78D6`/`#3987E5`, direct labels, table view as the alternative.

## Type
System stack (offline): `"PayPal Sans Big","Helvetica Neue",Inter,ui-sans-serif,system-ui,sans-serif`; mono `ui-monospace`. Scale: 12 / 14 / 16 / 20 / 28 / 44 / 72. Hero amounts 72 (44 mobile), weight 700, tracking -0.03em, tabular numerals. Body 16, labels 12 caps +0.06em. Max measure 62ch.

## Space, shape, elevation
4px grid: 4 8 12 16 24 32 48 72. Cards radius 24, inner radius 16, chips and buttons fully pill. Shadow `0 1px 2px rgba(11,27,58,.06), 0 12px 32px rgba(11,27,58,.07)`. Page max 1120, gutter 32 (16 mobile). Min touch target 44.

## Motion
Ease-out `cubic-bezier(.2,.8,.2,1)`; spring `cubic-bezier(.34,1.56,.64,1)` for pop-ins. Durations 120 (hover) / 240 (UI) / 480 (reveal) / 900 (money). Typed-in contract lines 18ms/char. Vessel level 900ms; release token slides vessel → payee 900ms then the payee total counts up 700ms. `prefers-reduced-motion`: everything snaps, no typing, no wave, no cursor glide.

## Components
Top bar (logo, 4 progress dots, status pill, Ledger, Demo [D], theme) · Composer (textarea, example chips, live preview that types in) · Verified badge (tap: invariants) · Milestone card (share ring, title, amount, oracle chip, expand) · Money-flow strip (client → PayPal vessel → payee, token) · Hero amount (count-up) · Milestone rail (vertical; pending / checking / needs review / released / rejected / voided) · Proof panel (drop zone, URL, text) · Verdict chip (tap: reasons) · Release button (auto-fires on pass) · Role switch (client / freelancer) · PayPal approval sheet (simulated) · Ledger timeline + table, expandable raw request · Cancel sheet · Toasts · Demo caption bar, progress line, ghost cursor.

## Running it
`npm start` serves `public/` at http://127.0.0.1:3100 (real PayPal sandbox + Claude when keys exist). Any static server also works (`python3 -m http.server 3200 --bind 127.0.0.1 --directory public`): the UI falls back to an in-browser engine (`js/mock.js`) when `/api/status` is unreachable, or when `?mock=1`.

**Demo mode** (button in the top bar, or press `D`; `Esc` exits; `?demo=1` starts on load; `&speed=2` for a quick test): plays the happy path on the in-browser engine in about 110 seconds, with large captions, a ghost cursor and a progress line. It is clearly labelled "Demo mode · simulated" because a PayPal popup cannot be auto-played; record the real PayPal approval separately and cut it in.

Dev helpers: `?seed=draft|awaiting|funded|midway|done|cancelled` opens a sample deal, `?screen=filled|review|hold` jumps into the flow, `&role=freelancer`, `&typo=1` forces the verifier-catches-a-typo beat, `&still=1` freezes motion for screenshots.
