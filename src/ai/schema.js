// JSON schemas for Claude structured outputs plus a dependency-free validator.
// The model schema is "flat" (every key required, nulls instead of missing keys) because
// structured outputs needs additionalProperties:false and required on every object.

export const ORACLE_TYPES = ['url', 'github_pr', 'evidence', 'deadline', 'manual'];
export const PROOF_TYPES = ['url', 'github_pr', 'photo', 'screenshot', 'document', 'time', 'client_approval'];
export const TIMEOUT_POLICIES = ['void_remainder', 'refund_released'];

const nullable = (t) => ({ anyOf: [t, { type: 'null' }] });
const str = { type: 'string' };
const int = { type: 'integer' };

/** What Claude must return from draftContract (strict). */
export const CONTRACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'client', 'freelancer', 'total_cents', 'deadline_day', 'on_timeout',
    'dispute_window_days', 'milestones', 'input_issues'],
  properties: {
    title: str,
    client: { type: 'object', additionalProperties: false, required: ['name', 'email'], properties: { name: str, email: nullable(str) } },
    freelancer: { type: 'object', additionalProperties: false, required: ['name', 'email'], properties: { name: str, email: nullable(str) } },
    total_cents: int,
    deadline_day: int,
    on_timeout: { type: 'string', enum: TIMEOUT_POLICIES },
    dispute_window_days: int,
    milestones: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'share_pct', 'amount_cents', 'depends_on', 'criteria', 'proof_type', 'due_day', 'oracle'],
        properties: {
          id: str,
          title: str,
          share_pct: { type: 'number' },
          amount_cents: int,
          depends_on: { type: 'array', items: str },
          criteria: str,
          proof_type: { type: 'string', enum: PROOF_TYPES },
          due_day: nullable(int),
          oracle: {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'url', 'contains', 'repo', 'number', 'after_days', 'after'],
            properties: {
              type: { type: 'string', enum: ORACLE_TYPES },
              url: nullable(str), contains: nullable(str), repo: nullable(str), number: nullable(int),
              after_days: nullable(int), after: nullable(str),
            },
          },
        },
      },
    },
    input_issues: { type: 'array', items: str },
  },
};

/** What Claude must return from checkProof (strict). */
export const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['observations', 'criteria_check', 'injection_detected', 'verdict', 'confidence', 'reason'],
  properties: {
    observations: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['source', 'observation'], properties: { source: str, observation: str } },
    },
    criteria_check: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['requirement', 'met'], properties: { requirement: str, met: { type: 'string', enum: ['yes', 'no', 'cannot_tell'] } } },
    },
    injection_detected: { type: 'boolean' },
    verdict: { type: 'string', enum: ['pass', 'fail', 'unclear'] },
    confidence: { type: 'number' },
    reason: str,
  },
};

/** Model output (flat) -> API.md Contract shape. */
export function toContract(m) {
  const milestones = (m.milestones || []).map((x) => {
    const o = x.oracle || { type: 'evidence' };
    const oracle = { type: o.type };
    if (o.type === 'url') { if (o.url) oracle.url = o.url; if (o.contains) oracle.contains = o.contains; }
    if (o.type === 'github_pr') { oracle.repo = o.repo || null; oracle.number = o.number ?? null; }
    if (o.type === 'deadline') { oracle.after_days = o.after_days ?? null; oracle.after = o.after ?? null; }
    return {
      id: x.id, title: x.title, share_pct: x.share_pct, amount_cents: x.amount_cents,
      depends_on: x.depends_on || [], oracle, criteria: x.criteria, proof_type: x.proof_type, due_day: x.due_day ?? null,
    };
  });
  const deadlineDay = m.deadline_day;
  return {
    title: m.title,
    currency: 'USD',
    client: { name: m.client?.name || 'Client', email: m.client?.email || null },
    freelancer: { name: m.freelancer?.name || 'Freelancer', email: m.freelancer?.email || null },
    hold: { amount_cents: m.total_cents, window_days: Math.min(29, Math.max(1, deadlineDay || 29)) },
    deadline: { day: deadlineDay, on_timeout: m.on_timeout || 'void_remainder' },
    dispute_window_days: m.dispute_window_days ?? 3,
    milestones,
  };
}

const isInt = (v) => Number.isInteger(v);
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * Validate an API.md Contract. Errors block; warnings inform.
 * Codes: SCHEMA, TOTAL_MISMATCH, SHARES_SUM, SHARE_AMOUNT_MISMATCH, ZERO_AMOUNT, DUP_ID, UNKNOWN_DEP,
 * CYCLE, BAD_ORACLE, DUE_AFTER_DEADLINE. Warnings: HOLD_TOO_LONG, URL_AT_SUBMIT, REFUND_RELEASED, NO_DEADLINE.
 */
export function validateContract(c) {
  const errors = [];
  const warnings = [];
  const err = (code, message, path) => errors.push({ code, message, path });
  if (!c || typeof c !== 'object') { err('SCHEMA', 'Contract is missing', ''); return { ok: false, errors, warnings }; }
  if (!isStr(c.title)) err('SCHEMA', 'Title is missing', 'title');
  if (c.currency !== 'USD') err('SCHEMA', 'Currency must be USD', 'currency');
  for (const p of ['client', 'freelancer']) if (!c[p] || !isStr(c[p].name)) err('SCHEMA', `${p} name is missing`, `${p}.name`);
  const total = c.hold?.amount_cents;
  if (!isInt(total) || total <= 0) err('SCHEMA', 'Deal total must be a positive whole number of cents', 'hold.amount_cents');
  if (!c.deadline || !isInt(c.deadline.day) || c.deadline.day <= 0) err('SCHEMA', 'Deadline day must be a positive whole number', 'deadline.day');
  else if (c.deadline.day > 29) warnings.push({ code: 'HOLD_TOO_LONG', message: `Deadline is day ${c.deadline.day}; a PayPal authorization can be held at most 29 days` });
  if (c.deadline && !['void_remainder', 'refund_released'].includes(c.deadline.on_timeout)) err('SCHEMA', 'on_timeout must be void_remainder or refund_released', 'deadline.on_timeout');
  if (c.deadline?.on_timeout === 'refund_released') warnings.push({ code: 'REFUND_RELEASED', message: 'On timeout, money already released will also be refunded' });
  if (c.dispute_window_days != null && (!isInt(c.dispute_window_days) || c.dispute_window_days < 0)) err('SCHEMA', 'Dispute window must be whole days', 'dispute_window_days');

  const ms = Array.isArray(c.milestones) ? c.milestones : null;
  if (!ms || ms.length === 0) { err('SCHEMA', 'At least one milestone is required', 'milestones'); return { ok: false, errors, warnings }; }
  const ids = new Set();
  let sumCents = 0;
  let sumPct = 0;
  ms.forEach((m, i) => {
    const p = `milestones[${i}]`;
    if (!isStr(m.id)) err('SCHEMA', 'Milestone id is missing', `${p}.id`);
    else if (ids.has(m.id)) err('DUP_ID', `Milestone id ${m.id} is used twice`, `${p}.id`);
    else ids.add(m.id);
    if (!isStr(m.title)) err('SCHEMA', 'Milestone title is missing', `${p}.title`);
    if (!isStr(m.criteria)) err('SCHEMA', 'Acceptance criteria are missing', `${p}.criteria`);
    if (!isInt(m.amount_cents)) err('SCHEMA', 'Amount must be whole cents', `${p}.amount_cents`);
    else if (m.amount_cents <= 0) err('ZERO_AMOUNT', `${m.title || m.id} has no money attached`, `${p}.amount_cents`);
    else sumCents += m.amount_cents;
    if (typeof m.share_pct !== 'number' || !(m.share_pct >= 0)) err('SCHEMA', 'Share must be a number', `${p}.share_pct`);
    else sumPct += m.share_pct;
    if (isInt(total) && total > 0 && isInt(m.amount_cents) && typeof m.share_pct === 'number'
      && Math.abs((m.amount_cents / total) * 100 - m.share_pct) > 0.5) {
      err('SHARE_AMOUNT_MISMATCH', `${m.title || m.id}: ${m.share_pct}% does not match ${fmt(m.amount_cents)} of ${fmt(total)}`, p);
    }
    const o = m.oracle;
    if (!o || !['url', 'github_pr', 'evidence', 'deadline', 'manual'].includes(o.type)) err('BAD_ORACLE', `${m.title || m.id} has no valid proof check`, `${p}.oracle`);
    else if (o.type === 'github_pr' && (!/^[\w.-]+\/[\w.-]+$/.test(o.repo || '') || !isInt(o.number))) err('BAD_ORACLE', 'GitHub check needs repo "owner/name" and a PR number', `${p}.oracle`);
    else if (o.type === 'deadline' && (!isInt(o.after_days) || o.after_days < 0)) err('BAD_ORACLE', 'Time-based milestone needs a number of days', `${p}.oracle`);
    else if (o.type === 'url' && !o.url) warnings.push({ code: 'URL_AT_SUBMIT', message: `${m.title || m.id}: the URL will be supplied when the freelancer submits` });
    if (m.due_day != null && (!isInt(m.due_day) || m.due_day < 0)) err('SCHEMA', 'Due day must be whole days from funding', `${p}.due_day`);
    else if (m.due_day != null && isInt(c.deadline?.day) && m.due_day > c.deadline.day) err('DUE_AFTER_DEADLINE', `${m.title || m.id} is due on day ${m.due_day}, after the deal deadline (day ${c.deadline.day})`, `${p}.due_day`);
  });
  ms.forEach((m, i) => {
    for (const d of m.depends_on || []) if (!ids.has(d)) err('UNKNOWN_DEP', `${m.id} depends on unknown milestone ${d}`, `milestones[${i}].depends_on`);
    if (m.oracle?.type === 'deadline' && m.oracle.after && !ids.has(m.oracle.after)) err('UNKNOWN_DEP', `${m.id} waits on unknown milestone ${m.oracle.after}`, `milestones[${i}].oracle.after`);
  });
  if (hasCycle(ms)) err('CYCLE', 'Milestones depend on each other in a loop', 'milestones');
  if (isInt(total) && total > 0 && sumCents !== total) {
    err('TOTAL_MISMATCH', `Milestones add up to ${fmt(sumCents)}, but the deal total is ${fmt(total)}`, 'milestones');
  }
  if (Math.abs(sumPct - 100) > 0.5) err('SHARES_SUM', `Shares add up to ${round2(sumPct)}%, not 100%`, 'milestones');
  return { ok: errors.length === 0, errors, warnings };
}

function hasCycle(ms) {
  const deps = new Map(ms.map((m) => [m.id, [...(m.depends_on || []), ...(m.oracle?.type === 'deadline' && m.oracle.after ? [m.oracle.after] : [])]]));
  const state = new Map();
  const visit = (id) => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    for (const d of deps.get(id) || []) if (deps.has(d) && visit(d)) return true;
    state.set(id, 2);
    return false;
  };
  return ms.some((m) => visit(m.id));
}

const round2 = (n) => Math.round(n * 100) / 100;
export const fmt = (cents) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
