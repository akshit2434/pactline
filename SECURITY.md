# Security

Pactline runs against the **PayPal sandbox** only; no real money is handled. It is still built as if it did.

## Reporting

Please report a vulnerability privately through GitHub's **Security → Report a vulnerability** on this repository rather than in a public issue. We aim to reply within a few days.

## What is in place

- The server binds to `127.0.0.1`; only `POST /webhooks/paypal` is meant to be exposed, and webhook signatures are verified with PayPal's `verify-webhook-signature` when `PAYPAL_WEBHOOK_ID` is set. Webhooks reconcile state; they never move money.
- Every money movement is an effect of the pure state machine, under a per-deal lock; a failed PayPal call leaves the deal unchanged.
- AI output never releases funds by itself: release needs a pass with confidence of at least 0.8, and detected prompt injection downgrades a pass to human review in code.
- URL oracles refuse private and loopback addresses (SSRF guard) unless `PACTLINE_ALLOW_PRIVATE_URLS=1`.
- Keys are read from `.env`, `.env.local` or the environment; both files are git-ignored.
