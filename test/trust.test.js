// Criteria-locked judging output and proof fingerprints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../src/engine.js';
import { MockEscrow } from '../src/paypal/escrow.js';
import { shapeVerdict } from '../src/ai/index.js';
import { demoContract } from './fixtures.js';

const IMG = 'data:image/png;base64,' + Buffer.from('fake-png-bytes-for-test').toString('base64');
const passAi = { checkProof: async () => ({ verdict: 'pass', confidence: 0.95, reasons: ['all visible'], by: 'claude-vision', checks: [{ requirement: 'hero', clause: 'hero with headline', seen: 'hero with Northwind headline', met: 'yes' }] }) };

async function funded(engine) {
  const c = demoContract(); c.deadline.day = 28;
  c.milestones[0].oracle = { type: 'evidence' }; c.milestones[1].depends_on = [];
  const d = engine.createDeal(c); const f = await engine.startFunding(d.id); await engine.completeFunding(d.id, f.order_id);
  return d.id;
}

test('judge output keeps clause, seen and result per requirement', () => {
  const v = shapeVerdict({ verdict: 'pass', confidence: 0.9, reason: 'ok', observations: [], criteria_check: [{ requirement: 'pricing', clause: 'pricing table with three plans', seen: 'three plans shown', met: 'yes' }] }, { by: 'claude-vision', model: 'm', preInjection: false });
  assert.deepEqual(v.checks[0], { requirement: 'pricing', clause: 'pricing table with three plans', seen: 'three plans shown', met: 'yes' });
});

test('engine stores checks and a sha256 fingerprint of the proof', async () => {
  const engine = createEngine({ escrow: new MockEscrow(), baseUrl: 'http://x', ai: passAi });
  const id = await funded(engine);
  const r = await engine.submit(id, 'm1', { image_data_url: IMG });
  const m = r.deal.milestones.find((x) => x.id === 'm1');
  assert.match(m.evidence.sha256, /^[0-9a-f]{64}$/);
  assert.equal(m.verdict.checks[0].clause, 'hero with headline');
  assert.equal(r.result.outcome, 'released');
});

test('the same file reused on another milestone or another deal is never auto-released', async () => {
  const engine = createEngine({ escrow: new MockEscrow(), baseUrl: 'http://x', ai: passAi });
  const id = await funded(engine);
  await engine.submit(id, 'm1', { image_data_url: IMG });
  const r2 = await engine.submit(id, 'm2', { image_data_url: IMG });
  assert.equal(r2.result.outcome, 'needs_review');
  const m2 = r2.deal.milestones.find((x) => x.id === 'm2');
  assert.equal(m2.evidence.reused_from.milestone_id, 'm1');
  assert.match(m2.verdict.reasons[0], /already submitted for milestone m1/);
  const id2 = await funded(engine);
  const r3 = await engine.submit(id2, 'm1', { image_data_url: IMG });
  assert.equal(r3.result.outcome, 'needs_review');
  assert.match(r3.deal.milestones[0].verdict.reasons[0], /another deal/);
});
