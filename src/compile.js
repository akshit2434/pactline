// Contract compile pipeline: AI draft -> verifier -> (errors fed back to the model) -> repair, with a deterministic safety net.
import { draftContract } from './ai/index.js';
import { verifyContract } from './core/verify.js';
import { allocate, MAX_HOLD_DAYS } from './core/contract.js';

/** Last-resort deterministic fixes for the arithmetic mistakes an LLM (or a human) makes. */
export function autoRepair(contract, errors) {
  const c = JSON.parse(JSON.stringify(contract)); const codes = new Set(errors.map((e) => e.code));
  const ms = c.milestones || [];
  if (codes.has('SHARES_SUM') && ms.length) {
    const total = ms.reduce((a, m) => a + (Number(m.share_pct) || 0), 0) || 1;
    ms.forEach((m) => (m.share_pct = Math.round(((Number(m.share_pct) || 0) * 100) / total)));
    ms[ms.length - 1].share_pct += 100 - ms.reduce((a, m) => a + m.share_pct, 0);
    codes.add('TOTAL_MISMATCH');
  }
  if (codes.has('TOTAL_MISMATCH') && ms.length) { const a = allocate(c.hold.amount_cents, ms.map((m) => m.share_pct)); ms.forEach((m, i) => (m.amount_cents = a[i])); }
  if (codes.has('BAD_ORACLE')) ms.forEach((m) => { const o = m.oracle; if (o && ((o.type === 'url' && !/^https?:\/\//i.test(o.url || '')) || (o.type === 'github_pr' && (!/^[\w.-]+\/[\w.-]+$/.test(o.repo || '') || !Number.isInteger(o.number))))) m.oracle = { type: 'evidence' }; }); // no checkable target given: fall back to AI/human evidence review
  if (codes.has('HOLD_TOO_LONG')) c.hold.window_days = MAX_HOLD_DAYS;
  if (codes.has('DEADLINE_AFTER_HOLD')) { c.hold.window_days = Math.min(MAX_HOLD_DAYS, Math.max(c.hold.window_days || 0, c.deadline.day)); if (c.deadline.day > MAX_HOLD_DAYS) c.deadline.day = MAX_HOLD_DAYS; }
  return c;
}

export async function compileText(text, { forceTypo = false } = {}) {
  const attempts = []; let source = 'fallback';
  let r = await draftContract(text);
  if (!r.contract) throw Object.assign(new Error((r.errors?.[0]?.message) || 'Could not understand the deal'), { status: 422, code: 'COMPILE_FAILED', errors: r.errors });
  source = r.source || source;
  let contract = r.contract;
  if (forceTypo) { // demo beat: a human-style typo (30/50/30) that the verifier must catch
    contract = JSON.parse(JSON.stringify(contract));
    const last = contract.milestones[contract.milestones.length - 1]; last.share_pct = contract.milestones.length === 3 ? 30 : last.share_pct + 10;
  }
  let v = verifyContract(contract);
  for (let n = 1; !v.ok && n <= 3; n++) {
    attempts.push({ n, errors: v.errors, repaired: false });
    const rr = await draftContract(text, { repairErrors: v.errors, previous: contract });
    let next = rr.contract || contract;
    let nv = verifyContract(next);
    if (!nv.ok) { next = autoRepair(next, nv.errors); nv = verifyContract(next); }
    contract = next; v = nv;
    if (v.ok) attempts[attempts.length - 1].repaired = true;
  }
  return { source, contract: v.ok ? v.contract || contract : contract, verification: v, attempts };
}
