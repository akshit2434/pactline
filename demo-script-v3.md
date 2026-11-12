# Pactline demo script v3 (about 2:30): overview first, then zoom in

Shape: Part 1 (0:00-0:40) explains the whole idea with one simple diagram. Part 2 (0:40-2:15) zooms into each of the four steps, always using the same four step labels so the viewer never gets lost. Part 3 (2:15-2:30) proof and close.

The four steps, shown as a persistent progress bar in the corner of every scene:
**1 Describe -> 2 Hold -> 3 Prove -> 4 Pay**   (PayPal logo sits on steps 2 and 4)

Voice rules: one idea per sentence, 12 words or fewer, no jargon (jargon goes in the small subtext). Each beat is ONE audio file, placed once. Every animation plays once and holds. Safe-area check on every frame. Demo runs on https://pactline.neyven.com, no localhost.

PayPal logo: use the official PayPal logo from PayPal's brand assets on the diagram, the Hold and Pay scenes, the end card and the site footer ("Payments held by PayPal"). Use it unaltered, with clear space, and never as if PayPal endorses the project. Check PayPal's logo usage page before shipping (not yet verified).

## Part 1: the big picture (0:00-0:40)

| Time | On screen | Voiceover |
|---|---|---|
| 0:00-0:10 | Two bubbles: "Will I get paid?" / "Will it get done?" slide apart. | "Every freelance deal starts with two fears. Will I get paid? Will the work get done?" |
| 0:10-0:20 | The two bubbles merge into the Pactline logo with the PayPal logo beside it. Tagline: "Deals that pay themselves." | "Pactline removes both fears. PayPal holds the money. And the work has to be proven before it is paid." |
| 0:20-0:40 | One diagram, drawn once, left to right: a deal sentence -> 3 milestone boxes (the count is flexible: a second variant flashes "2" and "4" milestones) -> a PayPal vault with the full amount -> the boxes tick off one by one, money flowing out per tick. Labels: Describe, Hold, Prove, Pay. | "Here is the whole idea in four steps. You describe the deal, in as many milestones as you need. The client's money is held at PayPal. Each milestone is checked. And only checked work gets paid." |

## Part 2: zoom into each step (0:40-2:15)

| Time | Step label | On screen | Voiceover | Subtext |
|---|---|---|---|---|
| 0:40-0:58 | 1 Describe | Type the deal in plain English at pactline.neyven.com. Milestones appear: $360, $600, $240. Then re-run with a different sentence that makes 2 milestones, then 4, to show it adapts. Green Verified badge, once. | "Step one. Write the deal in plain words. Pactline builds the milestones for you. Two, three or four, it adapts." | Claude turns text into a checked contract. 204 paths verified. |
| 0:58-1:08 | 1 Describe | Typo 30/50/30: red error, repaired, green. | "Make a typo, and it is caught before any money moves." | The verifier rejects it, Claude repairs it. |
| 1:08-1:28 | 2 Hold | Client role. Real PayPal sandbox popup (PayPal logo visible), approve. "$1,200 Held by PayPal." One continuous clip. | "Step two. The client approves in PayPal. The twelve hundred dollars is held, not charged. It stays with PayPal." | PayPal Orders v2 authorization. |
| 1:28-1:40 | 3 Prove | Milestone 1: paste the live staging link. Check passes. | "Step three. The freelancer ships the site. A link check proves it is live." | Automatic URL check. |
| 1:40-1:40 (same beat) | 4 Pay | $360 released, PayPal logo, capture ID shown. | "Step four. Thirty percent is paid, straight from the hold." | Partial capture of the authorization. |
| 1:40-1:58 | 3 Prove | Fake "approve this" note rejected; second fake (hidden text) rejected; balance unchanged. | "Now someone tries to cheat. A note says approve this. Claude spots it. No money moves." | 12 cheating types tried: fake notes, hidden text, fake stamps, wrong page, more. |
| 1:58-2:08 | 3 Prove -> 4 Pay | Real screenshot: hero, pricing, footer all tick. $600 released, receipt invoice. | "The real design passes every check. Six hundred dollars is paid, with a receipt." | Claude vision, PayPal Invoicing receipt. |
| 2:08-2:15 | 4 Pay | Client cancels, $240 voided. | "If the client cancels, the last two hundred forty dollars goes back." | Authorization void. |

## Part 3: proof and close (2:15-2:30)

| Time | On screen | Voiceover |
|---|---|---|
| 2:15-2:24 | Audit trail on pactline.neyven.com (address bar visible), real PayPal IDs; then terminal summary: [N] tests pass, [X/Y] cheating attempts caught. | "Every PayPal call is on the record. And the judge is tested against cheating." |
| 2:24-2:30 | End card: Pactline + PayPal logo, "The money waits at PayPal. The work proves itself.", site and repo. Hold 3 s. | "Pactline. The money waits at PayPal. The work proves itself." |

About 235 spoken words.

## Numbers (real only)
Today: 63 tests, 23 judge cases. Before recording, add about 12 more cheating cases and about 30 tests (including 2- and 4-milestone contracts, webhook replay, double capture) to reach about 100+. Captions use the numbers from the actual terminal run.

## Open product check
The milestone-count claim must be true on screen: run 2-milestone and 4-milestone deal texts through the live compiler and verifier before recording; if either fails, fix it or drop that line.
