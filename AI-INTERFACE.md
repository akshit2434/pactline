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
  warnings: [ { code, message } ],
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
  injection_detected: boolean,              // text in an image/note tried to instruct the judge
  by: 'claude-vision' | 'heuristic',
  model: 'claude-sonnet-5-5' | 'claude-opus-5-5' | null }
```
Rules the backend can rely on: injected instructions never yield `pass` by themselves; a heuristic (no key) never returns `pass` for `evidence` milestones with only an image — it returns `unclear` so a human reviews. Suggested backend mapping: `pass && confidence >= 0.8` → release; `fail && confidence >= 0.8` → rejected; else `NEEDS_REVIEW`.

## `explainEvent(event, opts?) -> Promise<string>`
`event`: an API.md SSE event or ledger row (`{type|kind, summary?, milestone_id?, amount_cents?, ...}`). Returns one plain-English line (≤ 140 chars). Deterministic templates by default (fast, offline); `opts.useModel: true` asks Claude for a nicer line and falls back to the template.

## `aiStatus() -> { compiler: 'claude'|'fallback', judge: 'claude-vision'|'heuristic', model }`
For `GET /api/status`.

## Also exported
`validateContract(contract) -> { ok, errors, warnings }`, `CONTRACT_SCHEMA`, `VERDICT_SCHEMA`, `fallbackDraft(text)`, `fallbackCheck(input)`, `AiInputError`.

Env: `ANTHROPIC_API_KEY` (absent → fallbacks), `PACTLINE_AI_MODEL` (default `claude-sonnet-5-5`), `PACTLINE_AI_ESCALATE_MODEL` (default `claude-opus-5-5`), `PACTLINE_AI_OFFLINE=1` forces fallbacks (tests).
