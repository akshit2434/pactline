import test from 'node:test';
import assert from 'node:assert/strict';
import { initState, apply, violations, remaining, TERMINAL, EscrowError } from '../src/core/machine.js';
import { enabledEvents } from '../src/core/modelcheck.js';
import { normalizeContract } from '../src/core/contract.js';
import { demoContract, parallelContract, rng } from './fixtures.js';

const run = (s, ...evs) => evs.reduce((st, e) => apply(st.state || st, e), s);
const funded = (c = demoContract()) => apply(initState(normalizeContract(c)), { type: 'FUND', amount_cents: c.hold.amount_cents }).state;

test('happy path captures in order and completes with nothing left held', () => {
  let s = funded(); const fx = [];
  for (const id of ['m1', 'm2', 'm3']) { const r = apply(s, { type: 'RELEASE', id }); s = r.state; fx.push(...r.effects); }
  assert.equal(s.status, 'COMPLETED'); assert.equal(s.captured_cents, 120000); assert.equal(remaining(s), 0);
  assert.deepEqual(fx.filter((e) => e.type === 'capture').map((e) => e.amount_cents), [36000, 60000, 24000]);
  assert.equal(fx.find((e) => e.milestone_id === 'm3').final, true);
  assert.equal(fx.some((e) => e.type === 'void'), false);
});
test('no double release', () => { const s = apply(funded(), { type: 'RELEASE', id: 'm1' }).state; assert.throws(() => apply(s, { type: 'RELEASE', id: 'm1' }), (e) => e.code === 'MILESTONE_CLOSED'); });
test('dependencies are enforced', () => assert.throws(() => apply(funded(), { type: 'RELEASE', id: 'm2' }), (e) => e.code === 'DEPENDENCY'));
test('cannot fund twice or with the wrong amount', () => { assert.throws(() => apply(funded(), { type: 'FUND', amount_cents: 120000 }), (e) => e.code === 'ALREADY_FUNDED'); assert.throws(() => apply(initState(normalizeContract(demoContract())), { type: 'FUND', amount_cents: 5 }), (e) => e.code === 'WRONG_AMOUNT'); });
test('cancel voids exactly the unreleased remainder and keeps captured money captured', () => {
  let s = apply(funded(), { type: 'RELEASE', id: 'm1' }).state; const r = apply(s, { type: 'CANCEL' });
  assert.equal(r.state.status, 'CANCELLED'); assert.deepEqual(r.effects, [{ type: 'void', amount_cents: 84000 }]);
  assert.equal(r.state.captured_cents, 36000); assert.equal(r.state.voided_cents, 84000); assert.deepEqual(violations(r.state), []);
});
test('timeout expires the deal and voids the remainder', () => {
  const r = apply(funded(), { type: 'TICK', day: 28 }); assert.equal(r.state.status, 'EXPIRED'); assert.equal(r.state.voided_cents, 120000);
});
test('closed deals reject every event', () => { const s = apply(funded(), { type: 'CANCEL' }).state; for (const e of [{ type: 'RELEASE', id: 'm1' }, { type: 'CANCEL' }, { type: 'TICK', day: 3 }]) assert.throws(() => apply(s, e), (x) => x.code === 'DEAL_CLOSED'); });
test('refund_released on timeout refunds captured milestones', () => {
  const c = demoContract(); c.deadline.on_timeout = 'refund_released';
  let s = apply(funded(c), { type: 'RELEASE', id: 'm1' }).state; const r = apply(s, { type: 'TICK', day: 28 });
  assert.deepEqual(r.effects.filter((e) => e.type === 'refund'), [{ type: 'refund', milestone_id: 'm1', amount_cents: 36000 }]);
});
test('rejected milestones can be resubmitted and then released', () => {
  let s = funded(); s = apply(s, { type: 'SUBMIT', id: 'm1' }).state; s = apply(s, { type: 'REJECT', id: 'm1' }).state; assert.equal(s.milestones[0].status, 'REJECTED');
  s = apply(s, { type: 'SUBMIT', id: 'm1' }).state; s = apply(s, { type: 'RELEASE', id: 'm1' }).state; assert.equal(s.milestones[0].status, 'RELEASED');
});

// ---- property tests: random event sequences, invariants checked after EVERY step ----
function randomEvent(rand, s) {
  const ids = s.milestones.map((m) => m.id); const id = ids[Math.floor(rand() * ids.length)];
  const pick = rand();
  if (pick < 0.40) return { type: 'RELEASE', id };
  if (pick < 0.55) return { type: 'SUBMIT', id };
  if (pick < 0.65) return { type: 'REJECT', id };
  if (pick < 0.72) return { type: 'REVIEW', id };
  if (pick < 0.78) return { type: 'CANCEL' };
  if (pick < 0.86) return { type: 'TICK', day: s.day + Math.floor(rand() * 12) };
  if (pick < 0.90) return { type: 'FUND', amount_cents: rand() < 0.5 ? s.hold_cents : 7 };
  if (pick < 0.95) return { type: 'TICK', day: Math.max(0, s.day - 1) };
  return { type: 'RELEASE', id: 'nope' };
}
for (const [name, mk] of [['sequential', demoContract], ['parallel+odd cents', parallelContract]]) {
  test(`property: 10,000 random event sequences keep money conserved (${name})`, () => {
    const rand = rng(name.length * 7919); const contract = normalizeContract(mk());
    let terminated = 0, releasedAmounts = 0;
    for (let n = 0; n < 10000; n++) {
      let s = initState(contract); const released = new Set();
      for (let step = 0; step < 40; step++) {
        const ev = randomEvent(rand, s); let r;
        try { r = apply(s, ev); } catch (e) { assert.ok(e instanceof EscrowError, `non-escrow error: ${e.stack}`); continue; }
        for (const f of r.effects) if (f.type === 'capture') { assert.ok(!released.has(f.milestone_id), 'double release'); released.add(f.milestone_id); }
        s = r.state;
        assert.deepEqual(violations(s), [], `after ${JSON.stringify(ev)}`);
        assert.ok(s.captured_cents <= s.held_cents);
        if (TERMINAL.has(s.status)) break;
      }
      if (TERMINAL.has(s.status)) { terminated++; if (s.held_cents) assert.equal(s.captured_cents + s.voided_cents, s.held_cents); releasedAmounts += s.captured_cents; }
    }
    assert.ok(terminated > 1000, 'a healthy share of runs should reach a terminal state');
  });
}
test('property: every legal path from the start terminates (model-checker events only)', () => {
  const rand = rng(42); const contract = normalizeContract(parallelContract());
  for (let n = 0; n < 3000; n++) {
    let s = initState(contract); let steps = 0;
    while (!TERMINAL.has(s.status)) { const evs = enabledEvents(s); assert.ok(evs.length, 'stuck'); const ev = evs[Math.floor(rand() * evs.length)]; try { s = apply(s, ev).state; } catch (e) { if (!(e instanceof EscrowError)) throw e; } assert.ok(++steps < 200, 'did not terminate'); }
    assert.deepEqual(violations(s), []);
  }
});
