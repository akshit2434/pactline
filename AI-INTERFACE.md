# Pactline AI layer (`src/ai/`) — stable interface v1

Import from `src/ai/index.js` only. Every function is `async`, **never throws** for model/network/key problems (it falls back to the deterministic rule-based path and says so in `source` / `by`), and only throws `AiInputError` (code `AI_BAD_INPUT`) for clearly invalid input (e.g. empty text).

```js
import { draftContract, checkProof, explainEvent, aiStatus } from './ai/index.js';
```

Shapes match `API.md` (integer cents, USD). Extra fields are additive.

## `draftContract(text, opts?) -> Promise<DraftResult>`
`opts`: `{ model?, forceFallback?, repairErrors?: [{code,message,path}], previous?: Contract, timeoutMs? }`
- `repairErrors` + `previous`: the backend verifier's errors go back to the model for one repair pass (the API.md repair loop). The backend owns the loop; this function does one compile per call.

```js
{ ok: true,                        // false only if even the fallback could not build a valid contract
  source: 'claude' | 'fallback',
  model: 'claude-sonnet-5-5' | null,
  contract: {                      // the API.md Contract shape
    title, currency: 'USD',
    client: { name, email|null }, freelancer: { name, email|null },
    hold: { amount_cents, window_days },          // amount_cents = deal total
    deadline: { day, on_timeout: 'void_remainder'|'refund_released' },
    dispute_window_days,                          // extra: days the client has to dispute a release (default 3)
    milestones: [ { id:'m1', title, share_pct, amount_cents, depends_on:[ids],
                    oracle: { type:'url'|'github_pr'|'evidence'|'deadline'|'manual', ... },
                    criteria,                     // acceptance criteria, one or two sentences
                    proof_type: 'url'|'github_pr'|'photo'|'screenshot'|'document'|'time'|'client_approval',
                    due_day: number|null } ] },   // extra: days from funding
  errors:   [ { code, message, path } ],   // schema/arithmetic errors found by validateContract (empty when ok)
  warnings: [ { code, message } ],          // AI_FALLBACK, REPAIRED, URL_AT_SUBMIT, HOLD_TOO_LONG, REFUND_RELEASED
  input_issues: [ 'plain-English problem in the deal text itself' ],   // e.g. "shares add up to 110%"; show to the user
  attempts: 1 | 2,                          // 2 = the model slipped and self-repaired once
  usage: { input_tokens, output_tokens } | null }
```
Local validation (always run, also on model output): `SCHEMA`, `TOTAL_MISMATCH` (milestone amounts must sum exactly to `hold.amount_cents`), `SHARES_SUM` (shares must sum to 100), `ZERO_AMOUNT`, `DUP_ID`, `UNKNOWN_DEP`, `DUE_AFTER_DEADLINE`. If the model's totals do not sum, it is asked once more with the error; if still wrong the result is `ok:false` with the errors (never silently "fixed").

## `checkProof({ milestone, text?, url?, files? }, opts?) -> Promise<Verdict>`
`files`: `[{ name?, media_type: 'image/png'|'image/jpeg'|'image/webp'|'image/gif'|'application/pdf'|'text/plain', data_base64 }]` or `[{ data_url: 'data:image/png;base64,...' }]` (the API's `image_data_url` works as `files:[{data_url}]`).
`opts`: `{ model?, forceFallback?, escalate?: true (re-check 'unclear' or confidence<0.7 with claude-opus-5-5), timeoutMs? }`

```js
{ verdict: 'pass' | 'fail' | 'unclear',
  confidence: 0..1,
  reason: 'One short sentence.',
  reasons: ['One short sentence.', ...],   // API.md compatibility: reasons[0] === reason
  evidence: [ { source: 'image:1'|'note'|'url', observation: '...' } ],
  checks: [ { requirement, met: 'yes'|'no'|'cannot_tell' } ],   // per-requirement breakdown (empty offline)
  injection_detected: boolean,              // text in an image/note tried to instruct the judge
  escalated?: true, fallback_reason?: string,
  by: 'claude-vision' | 'heuristic',
  model: 'claude-sonnet-5-5' | 'claude-opus-5-5' | null }
```
Rules the backend can rely on (enforced in code, not only in the prompt): if injection is detected a `pass` is downgraded to `unclear` (confidence ≤ 0.5); the offline heuristic **never** returns `pass` (it has not looked at the files) and its confidence is ≤ 0.6, so it can never cross the release bar. No evidence at all → `unclear` 0.2 without a model call. Suggested backend mapping: `pass && confidence >= 0.8` → release; `fail && confidence >= 0.8` → rejected; else `NEEDS_REVIEW`.

## `explainEvent(event, opts?) -> Promise<string>`
`event`: an API.md SSE event or ledger row (`{type|kind, summary?, milestone_id?, amount_cents?, ...}`). Returns one plain-English line (≤ 140 chars). Deterministic templates by default (fast, offline); `opts.useModel: true` asks Claude for a nicer line and falls back to the template.

## `aiStatus() -> { compiler: 'claude'|'fallback', judge: 'claude-vision'|'heuristic', model }`
For `GET /api/status`.

## Also exported
`validateContract(contract) -> { ok, errors, warnings }`, `toContract`, `CONTRACT_SCHEMA`, `VERDICT_SCHEMA`, `fallbackDraft(text, {now, repair})`, `fallbackCheck(input)`, `scanInjection(text)`, `shapeVerdict`, `explainTemplate(event)`, `AiInputError`.

## Eval and tests
- `node --test test/ai.test.js test/ai-failover.test.js` (offline, no key, ~1.5 s).
- `KEYS_FILE=/path/keys.env node scripts/ai-eval.mjs` runs 12 deals + 11 proof cases (incl. adversarial images) against Claude and prints the pass rate. `PACTLINE_AI_OFFLINE=1` runs it against the fallbacks.
- Proof fixtures: `test/ai-fixtures/*.png`, regenerate with `python3 -I test/ai-fixtures/make.py`.

## Calls Claude how
`client.beta.messages.create` with `output_config.format` = JSON schema (structured outputs), `output_config.effort` medium, server-side refusal fallbacks (`fallbacks: "default"`). Vision: base64 `image` blocks, PDFs as `document` blocks, text files inlined. The submission is wrapped as untrusted data after the milestone block; the trust rules live in the system prompt.

Env: `ANTHROPIC_API_KEY` (absent → fallbacks), `PACTLINE_AI_MODEL` (default `claude-sonnet-5-5`), `PACTLINE_AI_ESCALATE_MODEL` (default `claude-opus-5-5`), `PACTLINE_AI_OFFLINE=1` forces fallbacks (tests).
