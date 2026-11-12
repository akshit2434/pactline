// Contract helpers and the STATIC half of the verifier (the dynamic half is modelcheck.js).
// All money is integer cents.
export const ORACLES = ['url', 'github_pr', 'evidence', 'deadline', 'manual'];
export const MAX_HOLD_DAYS = 29; // PayPal: authorizations can be reauthorized within 29 days of the original

/** Split `total` cents by percentages; the last milestone absorbs rounding so the sum is exact. */
export function allocate(totalCents, pcts) {
  const out = pcts.map((p) => Math.floor((totalCents * p) / 100));
  const diff = totalCents - out.reduce((a, b) => a + b, 0);
  if (out.length) out[out.length - 1] += diff;
  return out;
}

export function hasCycle(milestones) {
  const deps = new Map(milestones.map((m) => [m.id, m.depends_on || []]));
  const state = new Map(); // 1 visiting, 2 done
  const visit = (id) => {
    if (state.get(id) === 2) return false;
    if (state.get(id) === 1) return true;
    state.set(id, 1);
    for (const d of deps.get(id) || []) if (deps.has(d) && visit(d)) return true;
    state.set(id, 2);
    return false;
  };
  return milestones.some((m) => visit(m.id));
}

/** Static checks. Returns { errors, warnings } with codes listed in API.md. */
export function staticVerify(c) {
  const errors = [], warnings = [];
  const err = (code, message, path) => errors.push({ code, message, path });
  const ms = Array.isArray(c?.milestones) ? c.milestones : [];
  if (!ms.length) err('NO_MILESTONES', 'A deal needs at least one milestone', 'milestones');
  const hold = c?.hold?.amount_cents;
  if (!Number.isInteger(hold) || hold <= 0) err('ZERO_AMOUNT', 'The hold amount must be a positive number of cents', 'hold.amount_cents');
  const ids = new Set();
  ms.forEach((m, i) => {
    const p = `milestones[${i}]`;
    if (ids.has(m.id)) err('DUP_ID', `Duplicate milestone id ${m.id}`, p); ids.add(m.id);
    if (!Number.isInteger(m.amount_cents) || m.amount_cents <= 0) err('ZERO_AMOUNT', `${m.id} has no positive amount`, p);
    if (!m.oracle || !ORACLES.includes(m.oracle.type)) err(m.oracle ? 'BAD_ORACLE' : 'NO_ORACLE', `${m.id} has no valid way to check it was done (oracle)`, `${p}.oracle`);
    else {
      const o = m.oracle;
      if (o.type === 'url' && !/^https?:\/\//i.test(o.url || '')) err('BAD_ORACLE', `${m.id}: url oracle needs an http(s) url`, `${p}.oracle.url`);
      if (o.type === 'github_pr' && (!/^[\w.-]+\/[\w.-]+$/.test(o.repo || '') || !Number.isInteger(o.number))) err('BAD_ORACLE', `${m.id}: github_pr oracle needs repo "owner/name" and a PR number`, `${p}.oracle`);
      if (o.type === 'deadline' && !(Number(o.after_days) >= 0)) err('BAD_ORACLE', `${m.id}: deadline oracle needs after_days`, `${p}.oracle.after_days`);
    }
  });
  ms.forEach((m, i) => (m.depends_on || []).forEach((d) => { if (!ids.has(d)) err('UNKNOWN_DEP', `${m.id} depends on unknown milestone ${d}`, `milestones[${i}].depends_on`); }));
  if (hasCycle(ms)) err('CYCLE', 'Milestones depend on each other in a loop, so none could ever be released', 'milestones');
  const pct = ms.reduce((a, m) => a + (Number(m.share_pct) || 0), 0);
  if (ms.length && Math.abs(pct - 100) > 1e-9) err('SHARES_SUM', `Shares add up to ${pct}%, not 100%`, 'milestones');
  const sum = ms.reduce((a, m) => a + (m.amount_cents || 0), 0);
  if (ms.length && Number.isInteger(hold) && sum !== hold) err('TOTAL_MISMATCH', `Milestone amounts add up to ${sum} cents but the hold is ${hold} cents`, 'milestones');
  const dl = c?.deadline?.day, win = c?.hold?.window_days ?? MAX_HOLD_DAYS;
  if (!(dl > 0)) err('DEADLINE_MISSING', 'The deal needs an overall deadline in days', 'deadline.day');
  if (win > MAX_HOLD_DAYS) err('HOLD_TOO_LONG', `PayPal holds can be kept for at most ${MAX_HOLD_DAYS} days; this asks for ${win}`, 'hold.window_days');
  if (dl > win) err('DEADLINE_AFTER_HOLD', `The deadline (day ${dl}) is after the hold expires (day ${win}), so the money would not be guaranteed`, 'deadline.day');
  ms.forEach((m, i) => { if (m.due_day != null && dl && m.due_day > dl) err('DEADLINE_AFTER_HOLD', `${m.id} is due after the deal deadline`, `milestones[${i}].due_day`); });
  if (c?.deadline?.on_timeout === 'refund_released') warnings.push({ code: 'REFUNDS_RELEASED', message: 'On timeout, already-released milestones are refunded too. That claws back earned money.' });
  ms.forEach((m) => { if (m.oracle?.type === 'manual') warnings.push({ code: 'MANUAL_ORACLE', message: `${m.id} relies on the client clicking release` }); });
  return { errors, warnings };
}

/** Fill derived fields (ids, amounts) without changing meaning. */
export function normalizeContract(c) {
  const out = JSON.parse(JSON.stringify(c || {}));
  out.currency = 'USD';
  out.milestones = (out.milestones || []).map((m, i) => ({ depends_on: [], ...m, id: m.id || `m${i + 1}` }));
  const hold = out.hold?.amount_cents;
  if (Number.isInteger(hold) && out.milestones.length && out.milestones.every((m) => !Number.isInteger(m.amount_cents) && Number.isFinite(m.share_pct))) {
    const a = allocate(hold, out.milestones.map((m) => m.share_pct));
    out.milestones.forEach((m, i) => (m.amount_cents = a[i]));
  }
  out.hold = { window_days: MAX_HOLD_DAYS, ...(out.hold || {}) };
  out.deadline = { on_timeout: 'void_remainder', ...(out.deadline || {}) };
  return out;
}
