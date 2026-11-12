// Tests for the pre-video polish: flexible milestone counts end to end, webhook replay, double capture.
import test from 'node:test';
import assert from 'node:assert/strict';
process.env.PACTLINE_AI_OFFLINE = '1';
const { compileText } = await import('../src/compile.js');
const { createEngine } = await import('../src/engine.js');
const { MockEscrow } = await import('../src/paypal/escrow.js');

const TEXTS = {
  2: 'Logo and brand kit, $800: 50% when the first concepts are shared, 50% when the final files are approved; void the rest if not delivered by 21 Nov.',
  4: 'Mobile app MVP, $4,500: 20% when the wireframes are approved, 25% when the pull request northwind/app#42 is merged, 35% when the beta build screenshot matches the designs, 20% after 14 days with no open bugs.',
  5: 'Content retainer, $2,000: 20% when post 1 is published, 20% when post 2 is published, 20% when post 3 is published, 20% when post 4 is published, 20% when post 5 is published.',
};
const pass = async () => ({ verdict: 'pass', confidence: 0.95, reasons: ['ok'], by: 'heuristic' });
async function funded(contract, checkProof = pass) {
  const e = createEngine({ escrow: new MockEscrow(), baseUrl: 'http://x', ai: { checkProof } });
  const d = e.createDeal(contract); const f = await e.startFunding(d.id); await e.completeFunding(d.id, f.order_id);
  return { e, id: d.id };
}
async function releaseAll(e, id, contract) {
  for (const m of contract.milestones) {
    if (m.oracle.type === 'deadline') await e.advanceClock(id, m.oracle.after_days + 1);
    else if (m.oracle.type === 'manual') await e.review(id, m.id, 'release');
    else { const r = await e.submit(id, m.id, { text: 'done' }); if (r.result.outcome !== 'released') await e.review(id, m.id, 'release'); }
  }
  return e.toApi(e.get(id));
}

for (const n of [2, 4, 5]) {
  test(`${n}-milestone deal compiles, verifies and releases everything`, async () => {
    const r = await compileText(TEXTS[n]);
    assert.equal(r.contract.milestones.length, n);
    assert.equal(r.verification.ok, true);
    assert.equal(r.contract.milestones.reduce((a, m) => a + m.amount_cents, 0), r.contract.hold.amount_cents);
    const { e, id } = await funded(r.contract);
    const done = await releaseAll(e, id, r.contract);
    assert.equal(done.status, 'COMPLETED');
    assert.equal(done.money.captured_cents, r.contract.hold.amount_cents);
    assert.equal(e.ledger(id).filter((x) => x.kind === 'capture').length, n);
  });
}

test('2-milestone deal: release the first, cancel voids exactly the second', async () => {
  const r = await compileText(TEXTS[2]);
  const { e, id } = await funded(r.contract);
  await e.submit(id, 'm1', { text: 'concepts' });
  const after = await e.cancel(id);
  assert.equal(after.status, 'CANCELLED');
  assert.equal(after.money.captured_cents, 40000);
  assert.equal(after.money.voided_cents, 40000);
  assert.equal(after.money.captured_cents + after.money.voided_cents, after.money.held_cents);
});

test('4-milestone deal: dependencies are enforced and a rejected milestone can be resubmitted', async () => {
  const r = await compileText(TEXTS[4]);
  let n = 0;
  const { e, id } = await funded(r.contract, async () => (n++ === 0 ? { verdict: 'fail', confidence: 0.9, reasons: ['missing'], by: 'heuristic' } : { verdict: 'pass', confidence: 0.95, reasons: ['ok'], by: 'heuristic' }));
  await assert.rejects(e.submit(id, 'm3', { text: 'x' }), /DEPENDENCY|only be submitted/);
  const rej = await e.submit(id, 'm1', { text: 'x' });
  assert.equal(rej.result.outcome, 'rejected');
  const ok = await e.submit(id, 'm1', { text: 'x' });
  assert.equal(ok.result.outcome, 'released');
  assert.equal(ok.deal.money.captured_cents, 90000);
});

test('webhook replay: the same PayPal event id is recorded once and does not bump the deal', async () => {
  const r = await compileText(TEXTS[2]);
  const { e, id } = await funded(r.contract);
  const auth = e.get(id).funding.authorization_id;
  const evt = { id: 'WH-1', event_type: 'PAYMENT.AUTHORIZATION.CREATED', resource: { id: auth } };
  assert.equal(e.handleWebhook(evt, { verified: false }).duplicate, undefined);
  const v = e.get(id).version;
  const again = e.handleWebhook(evt, { verified: false });
  assert.equal(again.duplicate, true);
  assert.equal(e.get(id).version, v);
  assert.equal(e.ledger(id).filter((x) => x.kind === 'webhook').length, 1);
});

test('double capture: releasing a released milestone again is refused and captures nothing', async () => {
  const r = await compileText(TEXTS[2]);
  const { e, id } = await funded(r.contract);
  await e.submit(id, 'm1', { text: 'x' });
  await assert.rejects(e.review(id, 'm1', 'release'), /already|MILESTONE_CLOSED/i);
  assert.equal(e.toApi(e.get(id)).money.captured_cents, 40000);
  assert.equal(e.ledger(id).filter((x) => x.kind === 'capture').length, 1);
});
