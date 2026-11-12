// Thin wrapper over @anthropic-ai/sdk: one structured-output call, typed errors, no throwing past here
// except AiUnavailable (caller falls back).
import Anthropic from '@anthropic-ai/sdk';

export const DEFAULT_MODEL = process.env.PACTLINE_AI_MODEL || 'claude-sonnet-5-5';
export const ESCALATE_MODEL = process.env.PACTLINE_AI_ESCALATE_MODEL || 'claude-opus-5-5';

export class AiUnavailable extends Error {
  constructor(message, cause) { super(message); this.name = 'AiUnavailable'; this.cause = cause; }
}

export class AiInputError extends Error {
  constructor(message) { super(message); this.name = 'AiInputError'; this.code = 'AI_BAD_INPUT'; }
}

// Optional gate run before every Claude call (public demo budgets). It throws AiUnavailable to force the offline fallback.
let callGate = null;
export function setCallGate(fn) { callGate = typeof fn === 'function' ? fn : null; }

let client = null;
export function hasKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY) && process.env.PACTLINE_AI_OFFLINE !== '1';
}
function getClient() {
  if (!hasKey()) throw new AiUnavailable('ANTHROPIC_API_KEY not set (or PACTLINE_AI_OFFLINE=1)');
  if (!client) client = new Anthropic({ maxRetries: 1, timeout: 60_000 });
  return client;
}

/**
 * One Messages API call constrained to a JSON schema. Returns { data, model, usage }.
 * Uses server-side refusal fallbacks ("default" routing) so a safety decline is retried on a suitable model.
 */
export async function callJSON({ model = DEFAULT_MODEL, system, content, schema, effort = 'medium', maxTokens = 8000, timeoutMs = 60_000 }) {
  const c = getClient();
  if (callGate) callGate({ model });
  let res;
  try {
    res = await c.beta.messages.create({
      model,
      max_tokens: maxTokens,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      messages: [{ role: 'user', content }],
      output_config: { effort, format: { type: 'json_schema', schema } },
    }, { timeout: timeoutMs });
  } catch (e) {
    // Anthropic.APIError covers 4xx/5xx; connection/timeouts are subclasses too.
    if (e instanceof Anthropic.APIError) throw new AiUnavailable(`Claude API error ${e.status ?? ''}: ${e.message}`.trim(), e);
    throw new AiUnavailable(`Claude call failed: ${e.message}`, e);
  }
  if (res.stop_reason === 'refusal') throw new AiUnavailable('Claude declined the request');
  if (res.stop_reason === 'max_tokens') throw new AiUnavailable('Claude output was cut off (max_tokens)');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new AiUnavailable('Claude returned invalid JSON', e); }
  return { data, model: res.model || model, usage: { input_tokens: res.usage?.input_tokens ?? 0, output_tokens: res.usage?.output_tokens ?? 0 } };
}
