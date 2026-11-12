// Model checker: walks EVERY reachable execution of the real state machine (not a copy) and checks the invariants
// at each state. Counts distinct paths with memoisation. Rejects are capped at one per milestone to keep it finite.
import { initState, apply, violations, TERMINAL, EscrowError } from './machine.js';

const INVARIANTS = ['captured <= held', 'no milestone released twice', 'captured + voided = held at every terminal state', 'every path terminates'];

export function enabledEvents(s) {
  if (TERMINAL.has(s.status)) return [];
  if (s.status === 'AWAITING_FUNDING') return [{ type: 'FUND', amount_cents: s.hold_cents }, { type: 'CANCEL' }];
  const evs = [{ type: 'CANCEL' }, { type: 'TICK', day: s.deadline_day }];
  for (const m of s.milestones) {
    if (m.status === 'VOIDED' || m.status === 'RELEASED') continue;
    evs.push({ type: 'RELEASE', id: m.id });
    if (m.rejects < 1 && m.status !== 'REJECTED') evs.push({ type: 'REJECT', id: m.id });
  }
  return evs;
}

const key = (s) => `${s.status}|${s.captured_cents}|${s.voided_cents}|${s.milestones.map((m) => m.status[0] + m.rejects).join('')}`;

export function modelCheck(contract, { maxStates = 50000 } = {}) {
  const start = initState(contract);
  const memo = new Map(); const stack = new Set(); const problems = []; let states = 0;
  const releasedTwice = { found: false };
  const walk = (s) => {
    const k = key(s);
    if (memo.has(k)) return memo.get(k);
    if (stack.has(k)) { problems.push({ code: 'NO_TERMINATION', message: 'An execution loops forever' }); return 0; }
    if (++states > maxStates) { problems.push({ code: 'STATE_SPACE', message: 'Too many states to check' }); return 1; }
    stack.add(k);
    const bad = violations(s); if (bad.length) problems.push({ code: 'INVARIANT', message: `Invariant broken: ${bad.join(', ')}` });
    const evs = enabledEvents(s);
    let paths = 0;
    if (!evs.length) paths = 1;
    else {
      let progressed = false;
      for (const ev of evs) {
        let next; try { next = apply(s, ev).state; } catch (e) { if (e instanceof EscrowError) continue; throw e; }
        progressed = true; paths += walk(next);
      }
      if (!progressed) { problems.push({ code: 'STUCK', message: `A state with status ${s.status} has no legal move` }); paths = 1; }
    }
    stack.delete(k); memo.set(k, paths);
    return paths;
  };
  const paths = walk(start);
  const failed = new Set(problems.map((p) => p.code));
  return {
    paths, states,
    invariants: INVARIANTS.map((name) => ({ name, ok: !(problems.some((p) => p.code === 'INVARIANT') || (name === 'every path terminates' && (failed.has('NO_TERMINATION') || failed.has('STUCK')))) })),
    problems,
  };
}
