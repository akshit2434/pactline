// Deterministic escrow state machine. Pure: apply(state, event) -> { state, effects } or throws EscrowError.
// "Effects" are instructions for the PayPal adapter (capture N cents, void M cents, ...). The machine never
// does I/O, so it can be property-tested with thousands of random event sequences.
export class EscrowError extends Error { constructor(code, message) { super(message); this.code = code; } }

export const TERMINAL = new Set(['COMPLETED', 'CANCELLED', 'EXPIRED']);
export const RESOLVED = new Set(['RELEASED', 'VOIDED']);

export function initState(contract) {
  return {
    status: 'AWAITING_FUNDING',
    hold_cents: contract.hold.amount_cents, held_cents: 0, captured_cents: 0, voided_cents: 0,
    day: 0, deadline_day: contract.deadline.day, on_timeout: contract.deadline.on_timeout || 'void_remainder',
    refunded_cents: 0,
    milestones: contract.milestones.map((m) => ({ id: m.id, amount_cents: m.amount_cents, depends_on: m.depends_on || [], status: 'PENDING', rejects: 0, released_day: null })),
  };
}

export const remaining = (s) => s.held_cents - s.captured_cents - s.voided_cents;
const clone = (s) => JSON.parse(JSON.stringify(s));
const ms = (s, id) => { const m = s.milestones.find((x) => x.id === id); if (!m) throw new EscrowError('NO_SUCH_MILESTONE', `No milestone ${id}`); return m; };

function finishIfDone(s, effects) {
  if (s.milestones.every((m) => RESOLVED.has(m.status))) {
    const left = remaining(s);
    if (left > 0) { effects.push({ type: 'void', amount_cents: left }); s.voided_cents += left; }
    s.status = 'COMPLETED';
  }
}

function endDeal(s, effects, status) {
  const left = remaining(s);
  if (left > 0) { effects.push({ type: 'void', amount_cents: left }); s.voided_cents += left; }
  s.milestones.forEach((m) => { if (!RESOLVED.has(m.status)) m.status = 'VOIDED'; });
  s.status = status;
  if (status === 'EXPIRED' && s.on_timeout === 'refund_released') {
    for (const m of s.milestones) if (m.status === 'RELEASED') { effects.push({ type: 'refund', milestone_id: m.id, amount_cents: m.amount_cents }); s.refunded_cents += m.amount_cents; }
  }
}

/** Events: FUND{amount_cents}, SUBMIT{id}, REVIEW{id}, REJECT{id}, RELEASE{id}, CANCEL, TICK{day} */
export function apply(prev, ev) {
  const s = clone(prev); const effects = [];
  const t = ev.type;
  if (TERMINAL.has(s.status)) throw new EscrowError('DEAL_CLOSED', `Deal is ${s.status}; nothing more can happen`);
  if (t === 'FUND') {
    if (s.status !== 'AWAITING_FUNDING') throw new EscrowError('ALREADY_FUNDED', 'Already funded');
    if (ev.amount_cents !== s.hold_cents) throw new EscrowError('WRONG_AMOUNT', `Hold must be exactly ${s.hold_cents} cents`);
    s.held_cents = ev.amount_cents; s.status = 'ACTIVE';
    return { state: s, effects };
  }
  if (t === 'CANCEL') {
    if (s.status === 'AWAITING_FUNDING') { s.status = 'CANCELLED'; s.milestones.forEach((m) => (m.status = 'VOIDED')); return { state: s, effects }; }
    endDeal(s, effects, 'CANCELLED'); return { state: s, effects };
  }
  if (s.status !== 'ACTIVE') throw new EscrowError('NOT_FUNDED', 'The deal is not funded yet');
  if (t === 'TICK') {
    if (!(ev.day >= s.day)) throw new EscrowError('CLOCK_BACKWARDS', 'Time only moves forward');
    s.day = ev.day;
    if (s.day >= s.deadline_day) endDeal(s, effects, 'EXPIRED');
    return { state: s, effects };
  }
  const m = ms(s, ev.id);
  if (RESOLVED.has(m.status)) throw new EscrowError('MILESTONE_CLOSED', `${m.id} is already ${m.status}`);
  if (t === 'SUBMIT') { if (m.status === 'NEEDS_REVIEW') throw new EscrowError('IN_REVIEW', `${m.id} is waiting for review`); m.status = 'CHECKING'; return { state: s, effects }; }
  if (t === 'REVIEW') { m.status = 'NEEDS_REVIEW'; return { state: s, effects }; }
  if (t === 'REJECT') { m.status = 'REJECTED'; m.rejects += 1; return { state: s, effects }; }
  if (t === 'RELEASE') {
    for (const d of m.depends_on) if (ms(s, d).status !== 'RELEASED') throw new EscrowError('DEPENDENCY', `${m.id} cannot be released before ${d}`);
    if (m.amount_cents > remaining(s)) throw new EscrowError('EXCEEDS_HOLD', `Releasing ${m.id} would exceed what is still held`);
    const last = s.milestones.filter((x) => x.id !== m.id && !RESOLVED.has(x.status)).length === 0;
    effects.push({ type: 'capture', milestone_id: m.id, amount_cents: m.amount_cents, final: last });
    s.captured_cents += m.amount_cents; m.status = 'RELEASED'; m.released_day = s.day;
    finishIfDone(s, effects);
    return { state: s, effects };
  }
  throw new EscrowError('UNKNOWN_EVENT', `Unknown event ${t}`);
}

/** Invariants that must hold after every step. Returns a list of violated invariant names. */
export function violations(s) {
  const v = [];
  if (s.captured_cents < 0 || s.voided_cents < 0) v.push('non-negative');
  if (s.captured_cents > s.held_cents) v.push('captured <= held');
  if (s.captured_cents + s.voided_cents > s.held_cents) v.push('captured + voided <= held');
  const released = s.milestones.filter((m) => m.status === 'RELEASED').reduce((a, m) => a + m.amount_cents, 0);
  if (released !== s.captured_cents) v.push('captured equals the sum of released milestones');
  if (TERMINAL.has(s.status) && s.held_cents > 0 && s.captured_cents + s.voided_cents !== s.held_cents) v.push('captured + voided = held at every terminal state');
  if (s.status === 'COMPLETED' && s.milestones.some((m) => m.status !== 'RELEASED' && m.status !== 'VOIDED')) v.push('completed means all milestones resolved');
  return v;
}
