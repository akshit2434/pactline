# Pactline backend API (v1, stable)

Base: `http://127.0.0.1:3100`. JSON in / JSON out. Money is always **integer cents** (`*_cents`) plus a display string where noted. Currency is USD. All times ISO-8601 UTC. The server serves `public/` statically at `/`. Every error is `{ "error": "message", "code": "SOME_CODE" }` with a 4xx/5xx status.

The backend runs fully with no PayPal keys (mock adapter) and with no LLM key (deterministic fallbacks). `GET /api/status` says which parts are live.

## Quick start for the UI

1. `POST /api/demo/seed` `{ "stage": "midway" }` returns a full sample deal (nothing touches PayPal). Render that.
2. Subscribe to `GET /api/events` (SSE) and re-fetch `GET /api/deals/:id` on every event for that deal.

## Status

`GET /api/status`
```json
{ "paypal": "live|mock", "currency": "USD",
  "ai": { "compiler": "claude|claude-cli|fallback", "judge": "claude-vision|claude-cli|heuristic", "model": "claude-sonnet-5-5" },
  "clock": { "now": "2026-11-12T18:00:00.000Z", "offset_days": 0 },
  "webhooks": { "verify": "paypal|simulated-only", "public_url": null } }
```

## Contract compile + verify

`POST /api/contracts/compile` `{ "text": "Landing page, $1,200: 30% when the staging URL is live, 50% when the design matches the mockup, 20% after 7 days with no open bugs; refund if not delivered by 30 Nov." }`
```json
{ "source": "claude|claude-cli|fallback|cache",
  "contract": { /* Contract, see below */ },
  "verification": { /* Verification, see below */ },
  "attempts": [ { "n": 1, "errors": [ { "code": "SHARES_SUM", "message": "Shares add up to 110%, not 100%", "path": "milestones" } ], "repaired": true } ] }
```
`attempts` lists every compile attempt that failed verification before the final one (empty when the first try is valid). The UI shows these as "verifier flagged X, model repaired it".

`POST /api/contracts/verify` `{ "contract": {...} }` returns a `Verification`:
```json
{ "ok": true,
  "paths": 214,                         // distinct execution paths explored by the model checker
  "states": 57,                         // distinct states
  "invariants": [ { "name": "captured <= held", "ok": true }, { "name": "no milestone released twice", "ok": true },
                  { "name": "captured + voided = held at every terminal state", "ok": true }, { "name": "every path terminates", "ok": true } ],
  "errors":   [ { "code": "SHARES_SUM|NO_ORACLE|CYCLE|DEADLINE_AFTER_HOLD|BAD_ORACLE|DUP_ID|ZERO_AMOUNT|HOLD_TOO_LONG|UNKNOWN_DEP", "message": "...", "path": "milestones[1]" } ],
  "warnings": [ { "code": "...", "message": "..." } ] }
```

`POST /api/contracts/typo` `{ "text": "..." }` is for the demo: returns the same shape as compile but forces one deliberately broken first attempt (shares 30/50/30) that the repair loop fixes. Use it for the "verifier catches the typo" beat.

### Contract

```json
{ "title": "Landing page", "currency": "USD",
  "client": { "name": "Northwind Traders", "email": "ap@northwind.example" },
  "freelancer": { "name": "Ava Designer", "email": "ava@studio.example" },
  "hold": { "amount_cents": 120000, "window_days": 29 },
  "deadline": { "day": 30, "on_timeout": "void_remainder" },
  "milestones": [
    { "id": "m1", "title": "Staging URL is live", "share_pct": 30, "amount_cents": 36000, "depends_on": [],
      "oracle": { "type": "url", "url": "https://staging.example.com", "contains": "Northwind" },
      "criteria": "Staging site returns 200 and shows the Northwind headline." },
    { "id": "m2", "title": "Design matches mockup", "share_pct": 50, "amount_cents": 60000, "depends_on": ["m1"],
      "oracle": { "type": "evidence" }, "criteria": "Screenshot shows the hero, pricing table and footer from the approved mockup." },
    { "id": "m3", "title": "7 days with no open bugs", "share_pct": 20, "amount_cents": 24000, "depends_on": ["m2"],
      "oracle": { "type": "deadline", "after_days": 7, "after": "m2" }, "criteria": "Seven days pass after m2 with no bug filed." } ] }
```
Oracle types: `url` (`url`, `contains?`), `github_pr` (`repo` "owner/name", `number`), `evidence` (AI judge on text and optional image), `deadline` (`after_days`, `after` milestone id or null for deal start), `manual` (client clicks release). `deadline.day` is days from funding. `on_timeout`: `void_remainder` (default) or `refund_released` (also refunds captures; verifier flags it as a warning).

## Deals

`POST /api/deals` `{ "contract": {...} }` creates a deal (re-verifies; 422 `VERIFY_FAILED` with `verification` if invalid). Returns a `Deal`.
`GET /api/deals` returns `{ "deals": [Deal] }` newest first. `GET /api/deals/:id` returns a `Deal`.

### Deal

```json
{ "id": "d_8f3k2a", "status": "DRAFT|AWAITING_FUNDING|ACTIVE|COMPLETED|CANCELLED|EXPIRED",
  "created_at": "...", "funded_at": null, "ends_at": null,
  "contract": { /* Contract */ },
  "verification": { "ok": true, "paths": 214, "states": 57 },
  "money": { "currency": "USD", "hold_cents": 120000, "held_cents": 120000, "captured_cents": 36000,
             "voided_cents": 0, "remaining_cents": 84000 },   // remaining = held - captured - voided
  "funding": { "status": "none|pending_approval|authorized|voided|expired", "order_id": "5O190127TN364715T",
               "authorization_id": "2G1234567A8901234", "approve_url": "https://www.sandbox.paypal.com/checkoutnow?token=...",
               "authorized_at": null, "expires_at": null, "reauthorized": 0 },
  "milestones": [
    { "id": "m1", "title": "...", "share_pct": 30, "amount_cents": 36000, "depends_on": [], "oracle": {...}, "criteria": "...",
      "status": "PENDING|CHECKING|NEEDS_REVIEW|RELEASED|REJECTED|VOIDED",
      "evidence": { "text": "...", "url": "...", "has_image": true, "submitted_at": "..." } ,
      "verdict": { "verdict": "pass|fail|unclear", "confidence": 0.93, "reasons": ["..."], "by": "url-oracle|claude-vision|heuristic|human" },
      "capture_id": "6XY...", "released_at": "...", "receipt": { "invoice_id": "INV2-...", "number": "0012", "status": "MARKED_AS_PAID" } } ],
  "clock": { "now": "...", "day": 12 },
  "version": 9 }
```
`NEEDS_REVIEW` carries `review: { "summary": "neutral summary for both sides", "for_freelancer": "...", "for_client": "..." }`.

## Funding (client side, PayPal AUTHORIZE order)

`POST /api/deals/:id/fund` returns `{ "order_id", "approve_url", "mock": false }`. Open `approve_url` (popup or redirect). PayPal returns the buyer to `GET /api/deals/:id/fund/return?token=<ORDER_ID>`, which authorizes the order, updates the deal and redirects to `/?deal=<id>&funded=1`. In mock mode `approve_url` is `/mock/approve?...` and behaves the same. Poll or listen to SSE for `funding.authorized`.
The UI can also call `POST /api/deals/:id/fund/complete` `{ "order_id": "..." }` directly (used after a JS SDK `onApprove`), same effect, returns the `Deal`.

## Delivery and release

`POST /api/deals/:id/milestones/:mid/submit` `{ "text"?: "...", "url"?: "...", "image_data_url"?: "data:image/png;base64,..." }`
Runs the milestone's oracle. Returns `{ "deal": Deal, "result": { "verdict", "confidence", "reasons", "by", "outcome": "released|needs_review|rejected" } }`. A confident pass captures that milestone's share of the PayPal authorization and writes a paid receipt invoice. Low confidence goes to `NEEDS_REVIEW`.
`POST /api/deals/:id/milestones/:mid/review` `{ "decision": "release|reject", "note"?: "..." }` is the human decision for `NEEDS_REVIEW` (or `manual` oracles).
`POST /api/deals/:id/cancel` `{ "reason"?: "..." }` voids the unreleased remainder of the authorization. Money already captured stays with the freelancer.
`POST /api/deals/:id/clock` `{ "advance_days": 8 }` advances the demo clock and processes `deadline` oracles and the overall timeout (void remainder). Returns the `Deal`.

## Ledger

`GET /api/deals/:id/ledger` returns `{ "rows": [LedgerRow] }` oldest first (also `GET /api/ledger` for all deals).
```json
{ "id": 14, "ts": "...", "deal_id": "d_8f3k2a", "milestone_id": "m1",
  "kind": "order.create|order.authorize|capture|void|reauthorize|refund|invoice.create|invoice.send|invoice.payment|webhook|oracle|judge|state",
  "call": "POST /v2/payments/authorizations/{id}/capture", "paypal_id": "6XY...", "debug_id": "a1b2c3", "http_status": 201,
  "status": "COMPLETED", "amount_cents": 36000, "held_cents": 120000, "captured_cents": 36000, "voided_cents": 0, "balance_cents": 84000,
  "note": "m1 released: staging URL returned 200", "mock": false }
```
`balance_cents` is what PayPal still holds for the buyer after this row. Ledger rows suit AG Grid directly.

## Events (live updates)

`GET /api/events` is Server-Sent Events. Each message is `data: {json}\n\n` with an increasing `id`:
```json
{ "id": 41, "ts": "...", "type": "deal.created|funding.pending|funding.authorized|milestone.checking|milestone.released|milestone.needs_review|milestone.rejected|deal.cancelled|deal.completed|deal.expired|clock.advanced|webhook.received|ledger.row", "deal_id": "d_8f3k2a", "milestone_id": "m1", "summary": "m1 released: $360.00 captured", "data": { } }
```
Polling fallback: `GET /api/events/poll?since=40` returns `{ "events": [...], "last_id": 41 }`. `?deal=<id>` filters either one.

## Webhooks

`POST /webhooks/paypal` is the PayPal receiver (verified with `/v1/notifications/verify-webhook-signature` when `PAYPAL_WEBHOOK_ID` is set). Handled: `PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.AUTHORIZATION.VOIDED`, `INVOICING.INVOICE.PAID`. Each produces a `webhook.received` event and a ledger row; webhooks reconcile state but never move money.
`POST /api/webhooks/simulate` `{ "deal_id": "...", "type": "PAYMENT.CAPTURE.COMPLETED" }` pushes a synthetic event through the same handler (demo and tests).

## Demo helpers

`POST /api/demo/seed` `{ "stage": "draft|awaiting|funded|midway|done|cancelled" }` creates a sample deal in memory (mock money, no PayPal calls) and returns the `Deal`. `midway` = funded, m1 released, m2 in `NEEDS_REVIEW`, m3 pending, with matching ledger rows. `POST /api/demo/reset` clears all in-memory deals (mock mode only).
`GET /api/demo/contract` returns the canonical demo `Contract` and the canonical demo sentence: `{ "text": "...", "contract": {...} }`.

## Additions in v1.1 (additive, nothing above changed)

- `Deal.mock` (boolean): true for seeded demo deals, whose money is simulated even when the server is live.
- `GET /demo/staging` serves a tiny "Northwind Traders" staging page (200) so the demo's URL oracle has something real to check. The canonical demo contract's `m1` URL oracle points at it.
- Milestone `evidence.url` submitted for a URL-ish milestone (title/criteria mention url, staging, site, live; or `proof_type: "url"`) is checked by the URL oracle even when the contract carried no URL.
- Ledger rows with `kind: "webhook"` have `status: "VERIFIED"` for a real PayPal-signed event, `"SIMULATED"` for `/api/webhooks/simulate`.
- Ledger `call` strings use PayPal path templates (`POST /v2/payments/authorizations/{id}/capture`); `debug_id` is PayPal's `paypal-debug-id` header for live calls.
- Errors from PayPal during a release/cancel come back as 502 `PAYPAL_ERROR` and leave the deal state unchanged.
