import test from 'node:test';
import assert from 'node:assert/strict';
import { autoRepair } from '../src/compile.js';
import { verifyContract } from '../src/core/verify.js';
import { demoContract } from './fixtures.js';

test('autoRepair fixes shares that do not sum to 100 and reallocates cents exactly', () => {
  const c = demoContract(); c.milestones[2].share_pct = 30; const bad = verifyContract(c);
  assert.ok(bad.errors.some((e) => e.code === 'SHARES_SUM'));
  const fixed = autoRepair(c, bad.errors); const v = verifyContract(fixed); assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.equal(fixed.milestones.reduce((a, m) => a + m.amount_cents, 0), 120000);
});
test('autoRepair downgrades an oracle with no checkable target to evidence review', () => {
  const c = demoContract(); c.milestones[0].oracle = { type: 'url' }; const bad = verifyContract(c);
  const fixed = autoRepair(c, bad.errors); assert.equal(fixed.milestones[0].oracle.type, 'evidence'); assert.equal(verifyContract(fixed).ok, true);
});
test('autoRepair pulls a too-long hold back to PayPal\'s 29 days', () => {
  const c = demoContract(); c.hold.window_days = 60; const fixed = autoRepair(c, verifyContract(c).errors); assert.equal(verifyContract(fixed).ok, true); assert.equal(fixed.hold.window_days, 29);
});
