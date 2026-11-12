# Pactline video plan (HyperFrames)

Goal: a 2:30 YouTube video (public, under 3:00) that follows `demo-script.md` beat for beat. Built as a HyperFrames composition: HTML scenes for the title/end cards and captions, with the real screen recordings placed as video clips. Render 1920×1080, 30 fps, MP4 (H.264 + AAC).

Order of work: record footage → generate voiceover → assemble in HyperFrames (scenes as sub-compositions, one caption track) → render → watch once in full → upload to YouTube as unlisted, then public once the founder approves (publishing is his call).

## Composition layout

| Track | Contents |
|---|---|
| 1 Scenes | `title` (0:00–0:10), `app` inserts (0:10–2:18), `end` (2:18–2:30). Each scene a sub-composition. |
| 2 Screen recordings | the footage clips below, trimmed to the beats, speed-ramped where marked |
| 3 Callouts | zoom/punch-ins and highlight boxes on PayPal IDs, verdict chips, the sandbox address bar |
| 4 Captions | one caption per beat from `demo-script.md` (burned in, lower third, max 2 lines, 44 px, high contrast) |
| 5 Voiceover | the narration from `demo-script.md` |
| 6 Music | quiet bed, ducked under the voice (−18 dB under VO), off for the last 2 s |

## Scenes to build in HTML

1. **Title (0:00–0:10):** off-white background (`#F3F6FA`), two speech bubbles: left "Will I get paid?" (freelancer, navy `#003087`), right "Will it get done?" (client, PayPal blue `#0070E0`). The bubbles slide apart and the Pactline wordmark lands between them; tagline "Plain-English deals that pay themselves. Held by PayPal." Use the palette and type from `design-spec.md`. No stock imagery.
2. **Section stingers (optional, 0.5 s each):** small labels "Compile", "Fund", "Prove", "Settle", "Audit" in the corner as each beat starts.
3. **End card (2:18–2:30):** wordmark, the line "The money waits at PayPal. The work proves itself.", a small stack line "PayPal Orders v2 authorizations · partial captures · void · Invoicing · webhooks · Claude Sonnet 5.5", and the repo URL. Hold still for the last 3 s.
4. **Stat overlay (2:10–2:18):** the two terminal summary lines (`npm test` count, AI eval score) set as large type over a dimmed terminal recording. Values typed from the actual terminal output on recording day.

## Footage the UI must provide (screen recordings)

Record each as a separate clip, 1920×1080, 30 fps, cursor visible, no system notifications. File names as listed, into `video/footage/`.

| File | Length | What it shows | Must be visible |
|---|---|---|---|
| `01-compose.mp4` | ~25 s | typing the deal text in "Describe the deal", compiling, the contract preview typing in, tapping the Verified badge | 3 milestones with $360 / $600 / $240, oracle chips, Verified badge with the real paths count, the invariants popover |
| `02-typo.mp4` | ~12 s | the 30 / 50 / 30 typo example, "Contract failed verification", then the repaired contract | the error text ("shares add up to 110%"), the repaired 20% = $240 |
| `03-fund.mp4` | ~25 s | Client role → Hold funds with PayPal → Continue to PayPal → the **real sandbox.paypal.com popup** → buyer login → approve → back in the app | the `sandbox.paypal.com` address bar, "Buyer approved. PayPal now holds the funds.", hero "$1,200 Held by PayPal". Password never readable. |
| `04-m1-url.mp4` | ~15 s | Freelancer role → milestone 1 → paste the staging URL → Checking → released | "Capture confirmed by PayPal", capture ID, "$840" still held |
| `05-m2-attack.mp4` | ~15 s | drop `note-approve-this.png` → verdict chip fail + injection flag → tap the chip | the one-sentence reason, balance unchanged |
| `06-m2-pass.mp4` | ~18 s | drop `landing-full.png` → Claude vision verdict pass with reasons and per-requirement checks → released → receipt invoice | confidence, reasons, receipt invoice number, "$240" still held |
| `07-cancel.mp4` | ~14 s | Client role → Cancel and void the rest → confirm → Hold voided | the void row, held = captured + voided |
| `08-audit.mp4` | ~12 s | Audit trail, slow scroll through all rows, expand one raw request | PayPal IDs, debug IDs, HTTP status, held / captured / balance columns, `mock: false` |
| `09-terminal.mp4` | ~6 s | terminal with `npm test` and `node scripts/ai-eval.mjs` summary lines | the two summary lines, readable |

Also needed from the UI team: the Pactline wordmark as SVG (or the exact CSS for it), and confirmation that the live run has no "Demo mode · simulated" label on screen in clips 03–08.

Callouts to add in post (track 3): zoom on the sandbox address bar (03), on the capture ID (04), on the verdict chip and "injection detected" (05), on the per-requirement checks (06), on the void row (07), and a slow punch-in on the PayPal ID and debug ID columns (08).

## Voiceover options (keys by name only, read from `keys.env`)

1. **ElevenLabs** (`ELEVENLABS_API_KEY`): first choice for a calm, natural narrator; generate per beat so each line can be retimed to its clip.
2. **Cartesia** (`CARTESIA_API_KEY`): fallback, fast generation; same per-beat approach.
3. **The founder's own voice:** recorded on a phone in a quiet room, then cleaned; the most authentic option if there is time.

Whichever is used, name it in the Devpost "AI tools used" section. Generate a word-level transcript of the final VO (`DEEPGRAM_API_KEY` is available) so captions can be timed to the words; the captions themselves come from `demo-script.md`, not from the transcript.

## Timing rules

- The narration in `demo-script.md` is about 290 words. Leave about 0.3 s of silence between beats. If the VO runs long, speed up the footage (typing 2×, PayPal login 1.5×), never the voice.
- Every money beat (03–08) keeps the real PayPal ID on screen for at least 1.5 s.
- Final length 2:25–2:35. Check that the rendered file is under 3:00 before uploading.

## Deliverables

- `video/pactline-demo.mp4` (render), `video/captions.srt` (for YouTube's caption upload), a 1280×720 thumbnail taken from the title card.
- YouTube title: "Pactline: plain-English deals that pay themselves, held by PayPal (PayPal AI Hackathon)". Description: the tagline, the repo link, "Built with PayPal Orders v2 authorizations and Claude".
