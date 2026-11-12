// Client confirmation window: confirm, auto-release on silence, dispute pauses release, double actions rejected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../src/engine.js';
import { MockEscrow } from '../src/paypal/escrow.js';
import { demoContract } from './fixtures.js';

async function setup(verdict = 'pass') {
  const ai = { checkProof: async () => ({ verdict, confidence: 0.95, reasons: ['hero and pricing match the mockup'], by: 'claude-vision' }) };
  const engine = createEngine({ escrow: new MockEscrow(), baseUrl: 'http://x', ai, confirmDays: 3 });
  const c = demoContract(); c.deadline.day = 28;
  c.milestones[0].oracle = { type: 'evidence' }; // judge-based milestone for the test
  const d = engine.createDeal(c);
  const f = await engine.startFunding(d.id); await engine.completeFunding(d.id, f.order_id);
  const r = await engine.submit(d.id, 'm1', { text: 'staging is live' });
  return { engine, id: d.id, r };
}
const m1 = (deal) => deal.milestones.find((m) => m.id === 'm1');

test('passed proof waits for client confirmation instead of releasing', async () => {
  const { engine, id, r } = await setup();
  assert.equal(r.result.outcome, 'awaiting_confirmation');
  const m = m1(r.deal);
  assert.equal(m.status, 'AWAITING_CONFIRMATION');
  assert.equal(m.confirmation.until_day, 3);
  assert.equal(r.deal.money.captured_cents, 0);
  assert.ok(engine.ledger(id).some((x) => x.status === 'AWAITING_CONFIRMATION'));
});

test('confirm now releases once; a second confirm or a later dispute is refused', async () => {
  const { engine, id } = await setup();
  const d = await engine.confirm(id, 'm1');
  assert.equal(m1(d).status, 'RELEASED');
  assert.equal(m1(d).confirmation.status, 'confirmed');
  assert.ok(d.money.captured_cents > 0);
  await assert.rejects(engine.confirm(id, 'm1'), /already confirmed/);
  await assert.rejects(engine.dispute(id, 'm1', { reason: 'not what we agreed', criterion: 'staging live' }), /already confirmed/);
  assert.equal(engine.ledger(id).filter((x) => x.kind === 'capture').length, 1);
});

test('silence auto-releases at expiry, not before', async () => {
  const { engine, id } = await setup();
  let d = await engine.advanceClock(id, 2);
  assert.equal(m1(d).status, 'AWAITING_CONFIRMATION');
  d = await engine.advanceClock(id, 1);
  assert.equal(m1(d).status, 'RELEASED');
  assert.equal(m1(d).confirmation.status, 'auto_released');
  assert.ok(engine.ledger(id).some((x) => x.status === 'AUTO_RELEASED'));
});

test('dispute needs a reason and a criterion, pauses release, and survives the clock', async () => {
  const { engine, id } = await setup();
  await assert.rejects(engine.dispute(id, 'm1', { reason: 'bad', criterion: 'x' }), /at least 10/);
  await assert.rejects(engine.dispute(id, 'm1', { reason: 'the page is not live', criterion: '' }), /criterion/);
  let d = await engine.dispute(id, 'm1', { reason: 'The staging URL returns a 404 page', criterion: 'Staging URL is live' });
  const m = m1(d);
  assert.equal(m.status, 'NEEDS_REVIEW');
  assert.equal(m.dispute.criterion, 'Staging URL is live');
  assert.match(m.review.summary, /Staging URL is live/);
  assert.match(m.review.for_freelancer, /Staging URL is live/);
  assert.ok(engine.ledger(id).some((x) => x.kind === 'dispute' && x.status === 'DISPUTED'));
  await assert.rejects(engine.dispute(id, 'm1', { reason: 'again and again', criterion: 'x' }), /already disputed/);
  await assert.rejects(engine.confirm(id, 'm1'), /already disputed/);
  d = await engine.advanceClock(id, 5);
  assert.equal(m1(d).status, 'NEEDS_REVIEW');
  assert.equal(d.money.captured_cents, 0);
  d = await engine.review(id, 'm1', 'reject', 'Staging URL still 404');
  assert.equal(m1(d).status, 'REJECTED');
});

test('confirmDays 0 keeps the old immediate release', async () => {
  const ai = { checkProof: async () => ({ verdict: 'pass', confidence: 0.95, reasons: ['ok'], by: 'claude-vision' }) };
  const engine = createEngine({ escrow: new MockEscrow(), baseUrl: 'http://x', ai });
  const c = demoContract(); c.deadline.day = 28; c.milestones[0].oracle = { type: 'evidence' };
  const d = engine.createDeal(c); const f = await engine.startFunding(d.id); await engine.completeFunding(d.id, f.order_id);
  const r = await engine.submit(d.id, 'm1', { text: 'done' });
  assert.equal(r.result.outcome, 'released');
});
