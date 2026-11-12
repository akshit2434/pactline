# Pactline roadmap

## Built on `trust-v2` (13 Nov 2026)

| Area | What changed |
|---|---|
| Runtime model | Every Claude call (compiler, repair, judge, explain, SOW/PDF reading) uses `claude-haiku-5-5` at effort `max` (probed live: max, xhigh, high all accepted). Override: `PACTLINE_AI_MODEL`, `PACTLINE_AI_EFFORT`. Live eval: 22/23 (see README). |
| Client confirmation window | A passed proof waits `PACTLINE_CONFIRM_DAYS` (3) days: Confirm now, Dispute (reason + unmet criterion required) or silence (auto-release at expiry). Disputes pause release, add a `dispute` ledger row and a deterministic summary shown to both sides. Proof routed to review never auto-releases. |
| SOW upload | Describe takes PDF, .docx, .txt, .md (2 MB, extension + magic-byte check, no remote fetch). Text goes through the normal compile + verifier + terms check; preview shows a source quote per milestone and the terms land in the editable box before any hold. PDFs need AI; text files work offline. |
| Criteria-locked judging | Judge returns clause (verbatim from the brief), seen, result per requirement; the verdict popover shows them. Proof files get a sha256 fingerprint; reuse on another milestone or deal forces human review. |
| Popover | Text wraps (the badge's `nowrap` leaked in, which clipped the video popover); width capped and position clamped to viewport and container at every width. |

Not built / deferred: confirmation window in the in-browser mock (Demo mode still releases immediately); public-mode rate limits on `/api/contracts/extract`; Claude-written source quotes (quotes are matched deterministically); dispute evidence uploads; screenshot of the clause popover with a live Haiku verdict.

## Done on `polish-pre-video` (12 Nov 2026, before the demo video)

| Area | What changed |
|---|---|
| Typing in "Describe the deal" | The compiler (Claude + verifier) runs once typing pauses for 550 ms. Any older request is aborted (`AbortController`) and late replies are ignored. While you type, the preview updates text in place: no rebuild, no flicker, no re-animation, no layout jump. Rows animate only when they first appear. |
| Re-animating green checkmarks | Every server event (SSE ledger rows, webhooks, receipts) rebuilt the milestone rail, which replayed the "released" pop every few seconds. The rail now repaints only when something it shows has changed, and plays an animation only on a real status change. The verdict chip, proof panel and Verified badge follow the same rule. |
| Webhook replays | A PayPal event id is recorded once per deal. A redelivery returns `duplicate: true`, adds no ledger row and does not bump the deal version. |
| Flexible milestone counts | 2-, 3-, 4- and 5-milestone deals compile, verify and run end to end (hold, prove, capture, void). Live Claude: 2 milestones → 32 paths verified; 4 milestones → 1,697 paths. Offline: 5 milestones → 17,434 paths. The example chips now cover 2 (Logo kit), 3 (Landing page) and 4 (App MVP) milestones. |
| Overflow | `scripts/ui-shots.mjs` captures every screen at 1920, 1280 and 390 wide and flags elements that leave the viewport. No page-level overflow was found. The only flag was the decorative hero glow, which is clipped inside its card. |
| PayPal logo | The official logo, fetched unaltered from paypalobjects.com, appears on the hold screen, in the deal hero ("Held by PayPal") and in a new footer ("Payments held by PayPal", plus a not-affiliated line). It sits on a white tile with clear space. See `assets/paypal/README.md`. |
| Terms check (new) | After typing pauses, the composer flags wording nobody can verify ("when it is done", "client is happy", "looks good", "asap", unnamed mockup parts, no end date) and offers an exact rewrite, applied with one click. It is deterministic (`public/js/lint.js`), so it is free, instant and safe on the public demo. A Claude-written version is roadmap item 1. |
| Tests | `test/polish.test.js` (7 tests) and `test/lint.test.js` (3 tests): 2-, 4- and 5-milestone deals end to end, 2-milestone cancel/void arithmetic, 4-milestone dependencies and resubmit after reject, webhook replay, and double capture. Full suite: 89/89 pass (was 79). In headless Chrome, typing a 150-character deal at 25 ms per key sent one compile request. |

## Honest current limits

- **PayPal logo rules unverified.** PayPal's logo-centre pages returned 403 to automated fetches. Clear space and minimum size follow common brand practice, not a rule we read.
- **AI-judge cheating set not expanded.** The original plan named 12 extra cases (hidden text, metadata text, fake stamp, wrong page, crop, reused proof, QR, other language, split instruction, fake banner, brief-as-proof, blank). These were cut for the deadline. The eval is still 12 deals + 11 proofs.
- **No live demo of the PayPal popup in Demo mode.** The guided demo runs on the in-browser engine and is labelled as simulated.
- **Single reviewer.** A "needs a look" verdict goes to the client alone. There is no neutral third party and no partial payment.
- **The hold window is PayPal's.** An authorization is honoured for 3 days and lasts at most 29. Reauthorization is attempted once after day 3. A deal longer than 29 days needs a new hold.
- **Seeded `?seed=awaiting` hold screen redirects to compose.** This is a dev helper only, not a user path. It was pre-existing and is left as is.
- **URL oracle checks status and one text string.** It does not check page quality.

## Future plan (prioritised)

Effort: S = under a day, M = 2 to 4 days, L = a week or more.

| # | Feature | Effort | Why it matters |
|---|---|---|---|
| 1 | **Claude-written terms check** (the rule-based version shipped). Claude flags acceptance criteria nobody can check ("looks good", "when done", no deadline, no URL) and suggests exact wording, applied in one click. It can ride on the compile call, so it costs no extra request. | S | Most freelance disputes start with a vague brief. Fixing it before money is held is the cheapest point. |
| 2 | **"What's missing" on rejection, plus proof history.** Show the judge's per-requirement checks (met / not met) to the freelancer, and keep every submission round. | S | It turns a rejection into a to-do list and gives both sides a record. The data already exists in `checks`. |
| 3 | **Neutral dispute summary with a one-click proposal.** Claude reads the criteria, the evidence and both notes, then proposes release, reject or a partial split that either side can accept. This needs a `PARTIAL_RELEASE` event in the state machine (capture part, void the rest of that milestone) and model-checker coverage. | M | It resolves "needs a look" without email ping-pong. Partial payment is how real disputes end. |
| 4 | **Expanded AI-judge red-team set** (the 12 cases above) with fixtures, run in CI against the live judge. Harden the prompt where it fails, without overfitting. | M | The judge moves money, so its resistance to cheating has to be measured, not claimed. |
| 5 | **Plain-language "what you get / what you risk" per side** on the Review screen, generated from the contract (deterministic, so no hallucination). | S | Both parties understand the deal before the hold. |
| 6 | **Shareable read-only deal link** (signed token, no evidence images) for the other party. | S | The client and the freelancer each see the same truth. Today it is single-browser. |
| 7 | **Templates** for common deals (landing page, logo, retainer, content, app MVP) with tested acceptance criteria. | S | Faster start and better-written criteria by default. |
| 8 | **Evidence agents.** Live-site check beyond status 200 (title, HTTPS, viewport, no placeholder text, basic performance); PDF and document reading of deliverables; commit and repo link checks. | M | More milestones verified automatically, so fewer go to human review. |
| 9 | **Milestone change requests.** Either side proposes an edit, the verifier re-checks the money, and the other side approves. Holds adjust by void plus a new authorization. | M | Scope changes are normal. Today the only option is to cancel. |
| 10 | **Deadline rules per milestone.** Reminders before a due day, then auto-void or refund when it passes. Scheduled reauthorization before the honour window lapses. | M | Money is not left in limbo and the guarantee stays alive. |
| 11 | **Notifications and activity timeline** (email or webhook) on each step, plus `pactline:step` UI events for sound and video hooks. | S | People act when they are told. |
| 12 | **Export: PDF contract plus receipt bundle.** | S | Accountants and tax filings need documents. |
| 13 | **PayPal Payouts / multi-party deals.** Split one hold across several freelancers or subcontractors. | L | Agencies and teams are the larger market. |
| 14 | **Recurring retainers.** A monthly hold that renews and releases on monthly proof. | L | Retainers are the most common long freelance relationship. |
| 15 | **Reputation.** Verified completion history (on-time rate, disputes) shareable as a profile. | L | Trust carries across deals and lowers the next hold's friction. |
| 16 | **Milestone negotiation by Claude.** It drafts a counter-proposal (amounts, dates, criteria) from both sides' constraints, and the verifier checks it. | M | It speeds up the first agreement, which is where many deals stall. |
