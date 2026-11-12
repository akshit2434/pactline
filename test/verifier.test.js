import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyContract } from '../src/core/verify.js';
import { allocate, hasCycle } from '../src/core/contract.js';
import { demoContract, parallelContract } from './fixtures.js';

const codes = (c) => verifyContract(c).errors.map((e) => e.code);

test('good contracts verify and report explored paths', () => {
  for (const c of [demoContract(), parallelContract()]) {
    const v = verifyContract(c);
    assert.equal(v.ok, true, JSON.stringify(v.errors));
    assert.ok(v.paths > 10 && v.states > 10);
    assert.ok(v.invariants.length === 4 && v.invariants.every((i) => i.ok));
  }
});
test('shares adding up to 110% fail with SHARES_SUM', () => { const c = demoContract(); c.milestones[0].share_pct = 40; assert.ok(codes(c).includes('SHARES_SUM')); });
test('milestone amounts that do not match the hold fail with TOTAL_MISMATCH', () => { const c = demoContract(); c.milestones[2].amount_cents = 30000; assert.ok(codes(c).includes('TOTAL_MISMATCH')); });
test('milestone without an oracle fails with NO_ORACLE', () => { const c = demoContract(); delete c.milestones[1].oracle; assert.ok(codes(c).includes('NO_ORACLE')); });
test('bad oracle parameters fail with BAD_ORACLE', () => { const c = demoContract(); c.milestones[0].oracle = { type: 'url', url: 'ftp://x' }; assert.ok(codes(c).includes('BAD_ORACLE')); });
test('dependency cycle fails with CYCLE', () => { const c = demoContract(); c.milestones[0].depends_on = ['m3']; assert.ok(codes(c).includes('CYCLE')); assert.equal(hasCycle(c.milestones), true); });
test('unknown dependency and duplicate ids are caught', () => { const c = demoContract(); c.milestones[1].depends_on = ['zzz']; assert.ok(codes(c).includes('UNKNOWN_DEP')); const d = demoContract(); d.milestones[1].id = 'm1'; assert.ok(codes(d).includes('DUP_ID')); });
test('deadline after the hold expires fails with DEADLINE_AFTER_HOLD', () => { const c = demoContract(); c.hold.window_days = 10; c.deadline.day = 20; assert.ok(codes(c).includes('DEADLINE_AFTER_HOLD')); });
test('hold longer than PayPal allows fails with HOLD_TOO_LONG', () => { const c = demoContract(); c.hold.window_days = 45; assert.ok(codes(c).includes('HOLD_TOO_LONG')); });
test('zero amount fails with ZERO_AMOUNT', () => { const c = demoContract(); c.milestones[0].amount_cents = 0; c.milestones[1].amount_cents += 36000; assert.ok(codes(c).includes('ZERO_AMOUNT')); });
test('allocate always sums exactly', () => { for (const t of [1, 99, 100, 100001, 123457]) for (const p of [[30, 50, 20], [33, 33, 34], [1, 99]]) assert.equal(allocate(t, p).reduce((a, b) => a + b, 0), t); });
test('refund_released on timeout is a warning, not an error', () => { const c = demoContract(); c.deadline.on_timeout = 'refund_released'; const v = verifyContract(c); assert.equal(v.ok, true); assert.ok(v.warnings.some((w) => w.code === 'REFUNDS_RELEASED')); });
