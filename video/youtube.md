# YouTube upload: Pactline demo

File: `video/pactline-demo.mp4` (1920×1080, 30 fps, 2:51, −16 LUFS). Thumbnail: `video/thumbnail.png` (1280×720). Captions: `video/captions.srt` (English, from the narration script).

## Title

Pactline: plain-English deals that pay themselves, held by PayPal (PayPal AI Hackathon)

## Description

Every freelance deal starts with two fears: will I get paid, and will it get done? Pactline turns a deal written in plain English into a verified contract, and PayPal holds the money until each milestone is proven.

What you see in this video runs for real on the PayPal sandbox:
• Claude turns the deal text into a typed contract (three milestones, exact amounts, how each one is proven).
• A model checker walks every path through the deal (204 paths in this run) and proves the money always adds up. A deliberate typo (30 + 50 + 30 = 110%) is rejected and repaired before any money moves.
• The client approves a PayPal Orders v2 AUTHORIZE order in the real sandbox checkout: $1,200 is held, not charged.
• Milestone 1: a URL check passes and Pactline captures 30% of the authorization (partial capture).
• Milestone 2: a fake "approve this" sticky note is rejected by the Claude vision judge; the real screenshot passes, $600 is captured and a paid receipt invoice is issued (PayPal Invoicing v2).
• The client cancels: the remaining $240 is voided and never leaves their account.
• The audit trail shows every PayPal call with PayPal's own IDs and debug IDs, plus signature-verified PayPal webhooks.
• 63/63 automated tests pass; the AI judge scores 23/23 on its eval, including prompt-injection attacks.

Tech: Node.js, PayPal Orders v2 (authorize, partial captures, void), PayPal Invoicing v2, PayPal webhooks with signature verification, Claude Sonnet 5.5 (structured outputs and vision), an explicit-state model checker.

Code (MIT): https://github.com/akshit2434/pactline

Built for the PayPal AI Hackathon. Voiceover generated with ElevenLabs; music composed in code.

Chapters
0:00 Two fears: will I get paid, will it get done?
0:12 Plain English → a verified contract
0:32 A typo can't become a payment
0:41 The client funds it: real PayPal sandbox authorization
1:09 URL check passes → partial capture
1:22 A fake "approve this" note is rejected
1:36 Claude vision verdict → capture and receipt invoice
1:58 Cancel → the remainder is voided
2:13 Audit trail: PayPal IDs, debug IDs, signed webhooks
2:41 Pactline

## Tags

Pactline, PayPal, PayPal AI Hackathon, PayPal sandbox, PayPal Orders API, payment authorization, partial capture, escrow, freelance payments, milestone payments, smart contracts without crypto, Claude, Anthropic, AI agents, model checking, prompt injection, fintech, hackathon demo

## Settings

Category: Science & Technology. Language: English. Not made for kids. Visibility: the founder decides (unlisted first, then public).
