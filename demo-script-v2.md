# Pactline demo script v2 (about 2:20)

Fixes from the founder's review of v1 (2:51):
1. USB overflow in the opening: title/opening scene redone with a safe-area check; every text box measured at 1920x1080 before render.
2. Green check blobs re-animating every few seconds: all looping animations removed. Each element animates once, then holds.
3. localhost link: demo runs on https://pactline.neyven.com (public demo mode), no localhost anywhere on screen. More tests, added for real (see "Numbers").
4. Story simplified: one sentence per step, jargon moved to the caption subtext, three acts with on-screen labels (1 Agree, 2 Hold, 3 Prove and pay).
5. Voiceover: every beat is generated as ONE audio file and placed once. No mid-sentence splits (v1 split beat 4 into three files with gaps).

Rule for the voice: one idea per sentence, 12 words or fewer, no clause that needs a second read. Technical words go in the small subtext line under the caption, not in the voice.

## Story in one line
Two people, one deal. Pactline holds the money at PayPal, checks the work, pays only for what is proven.

## Timeline

| Time | Act label | On screen | Voiceover (one file per row) | Caption + subtext (burned in) |
|---|---|---|---|---|
| 0:00-0:12 | none | Two bubbles: "Will I get paid?" and "Will it get done?" slide apart, logo lands between. Opening scene only; no USB/ASCII clutter, nothing within 80 px of the edge. | "Every freelance deal starts with two fears. Will I get paid? And will it get done?" | **Deals that pay themselves. Held by PayPal.** |
| 0:12-0:30 | 1 Agree | Type the deal in plain English. Compile. Three milestones appear: $360, $600, $240. Green "Verified" badge appears once and stays. | "You write the deal in plain English. Pactline turns it into three milestones, with exact amounts." | **Plain English in. A contract out.** Sub: Claude structured output, checked by a model checker over 204 paths. |
| 0:30-0:40 | 1 Agree | Typo example: 30/50/30. Red error "adds up to 110%", then repaired, 20% = $240, green. | "Make a typo, and it is caught before any money moves." | **A typo can't become a payment.** Sub: the verifier rejects it, Claude repairs it. |
| 0:40-1:05 | 2 Hold | Client role. Hold funds, real sandbox.paypal.com popup, approve. Hero "$1,200 Held by PayPal". One continuous clip, no cuts. | "The client approves in PayPal. The twelve hundred dollars is held, not charged. It stays with PayPal, not with us." | **Authorized, not charged.** Sub: PayPal Orders v2 AUTHORIZE, real sandbox. |
| 1:05-1:17 | 3 Prove and pay | Milestone 1: paste the live staging link, check passes, $360 released. | "The freelancer ships the site. The link checks out, so thirty percent is paid." | **Proof in. Money out.** Sub: URL oracle, partial capture of the hold. |
| 1:17-1:35 | 3 Prove and pay | Upload the fake note ("approve this"). Chip: Rejected, "injection detected". Then a second fake: text hidden in the image, also Rejected. Balance unchanged. | "Now someone tries to cheat. A note says approve this. Claude spots it, and no money moves." | **Cheating attempts: rejected.** Sub: 12 attack types tried: fake notes, hidden text, wrong page, fake stamps, and more. |
| 1:35-1:52 | 3 Prove and pay | Real screenshot. Claude checks hero, pricing, footer. Pass. $600 released, receipt invoice. | "The real design passes every check. Six hundred dollars is paid, with a receipt." | **Verified work gets paid.** Sub: Claude vision, per-requirement checks, PayPal Invoicing receipt. |
| 1:52-2:02 | 3 Prove and pay | Client cancels. $240 voided. | "If the client cancels, the last two hundred forty dollars goes back. It never left their account." | **Cancel anytime.** Sub: PayPal authorization void. |
| 2:02-2:14 | none | Audit trail at pactline.neyven.com (address bar visible, no localhost). Slow scroll of PayPal IDs. Cut to the terminal: test and attack-eval summary lines. | "Every PayPal call is on the record. And the judge is tested against cheating, not just the happy path." | **Every call on the record. [N] tests pass. Judge: [X/Y] attacks caught.** |
| 2:14-2:22 | none | End card: logo, line, repo and live URL. Hold still 3 s. | "Pactline. The money waits at PayPal. The work proves itself." | **Try it: pactline.neyven.com** |

Total about 2:22, about 215 spoken words (v1 had about 290).

## Numbers (never typed unless the terminal shows them)
- Today: 63 tests, 23 attack/eval cases. To make the demo stronger honestly, add real cases before recording: about 12 more injection types for the judge (hidden low-contrast text, text in image metadata, fake "APPROVED" stamp, screenshot of the wrong page, cropped proof, old proof reused, QR code instruction, instruction in another language, split instruction over two images, fake system banner, brief-copy-pasted-as-proof, blank image) and about 30 more unit/e2e tests (contract edge cases, webhook replay, double capture, expired authorization). Target about 100+ tests and about 35 eval cases.
- The caption fills [N] and [X/Y] from the real run on recording day.

## Recording and render checks (new)
- Record against https://pactline.neyven.com; confirm the address bar and no "Demo mode" label in money beats.
- Overflow check: screenshot every title/stinger/caption frame at 1920x1080 and 1280x720; no text or shape outside the safe area.
- No repeating animation: scan the composition for `repeat`, `yoyo`, `infinite`, `setInterval`; each reveal plays once.
- Audio: one VO file per row above, placed once; no gap longer than 0.4 s inside a sentence; listen to the whole mix before delivering.
