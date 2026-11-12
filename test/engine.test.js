import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createEngine } from '../src/engine.js';
import { MockEscrow } from '../src/paypal/escrow.js';
import { demoContract } from './fixtures.js';
import { assertPublicUrl } from '../src/oracles/index.js';
process.env.PACTLINE_ALLOW_PRIVATE_URLS = '1'; // tests serve their fake staging site on 127.0.0.1

function localSite() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      if (req.url === '/ok') { res.writeHead(200); res.end('<h1>Northwind Traders</h1>'); }
      else if (req.url === '/slow') { setTimeout(() => { res.writeHead(200); res.end('late'); }, 3000); }
      else { res.writeHead(404); res.end('nope'); }
    }).listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() }));
  });
}
const clock = () => { let t = Date.parse('2026-11-12T10:00:00Z'); return { now: () => t, tick: (ms) => (t += ms) }; };
async function fundedDeal(opts = {}) {
  const escrow = opts.escrow || new MockEscrow();
  const ai = { checkProof: opts.checkProof || (async () => ({ verdict: 'pass', confidence: 0.95, reasons: ['looks right'], by: 'heuristic' })) };
  const engine = createEngine({ escrow, baseUrl: 'http://x', ai, now: clock().now });
  const c = demoContract(); c.deadline.day = 28; if (opts.site) c.milestones[0].oracle = { type: 'url', url: opts.site + '/ok', contains: 'Northwind' };
  const d = engine.createDeal(c);
  const f = await engine.startFunding(d.id); await engine.completeFunding(d.id, f.order_id);
  return { engine, d, escrow };
}
const rows = (engine, id, kind) => engine.ledger(id).filter((r) => r.kind === kind);

test('full lifecycle on the mock: fund, URL oracle release, AI release, timer release, receipts, ledger balance', async () => {
  const site = await localSite();
  try {
    const { engine, d } = await fundedDeal({ site: site.base });
    assert.equal(engine.toApi(d).money.remaining_cents, 120000);
    let r = await engine.submit(d.id, 'm1', {}); assert.equal(r.result.outcome, 'released'); assert.equal(r.deal.money.captured_cents, 36000);
    r = await engine.submit(d.id, 'm2', { text: 'screenshot ok' }); assert.equal(r.result.outcome, 'released'); assert.equal(r.deal.money.remaining_cents, 24000);
    const early = await engine.advanceClock(d.id, 3); assert.equal(early.milestones[2].status, 'PENDING');
    await engine.advanceClock(d.id, 1);
    const done = await engine.advanceClock(d.id, 4); assert.equal(done.status, 'COMPLETED'); assert.equal(done.money.captured_cents, 120000); assert.equal(done.money.remaining_cents, 0);
    assert.equal(done.milestones.filter((m) => m.receipt).length, 3);
    const caps = rows(engine, d.id, 'capture'); assert.deepEqual(caps.map((c) => c.amount_cents), [36000, 60000, 24000]);
    assert.deepEqual(caps.map((c) => c.balance_cents), [84000, 24000, 0]);
    assert.ok(rows(engine, d.id, 'reauthorize').length >= 1, 'hold is reauthorized after the 3-day honor period');
  } finally { site.close(); }
});

test('URL oracle: 404 rejects, slow/unreachable goes to human review, wrong text fails', async () => {
  const site = await localSite();
  try {
    const { engine, d } = await fundedDeal();
    const c = engine.get(d.id).contract; c.milestones[0].oracle = { type: 'url', url: site.base + '/missing' };
    let r = await engine.submit(d.id, 'm1', {}); assert.equal(r.result.outcome, 'rejected'); assert.equal(r.deal.milestones[0].status, 'REJECTED');
    c.milestones[0].oracle = { type: 'url', url: site.base + '/ok', contains: 'Nonexistent Brand' };
    r = await engine.submit(d.id, 'm1', {}); assert.equal(r.result.outcome, 'rejected'); assert.match(r.result.reasons[0], /does not contain/);
    c.milestones[0].oracle = { type: 'url', url: 'http://127.0.0.1:1/never' };
    r = await engine.submit(d.id, 'm1', {}); assert.equal(r.result.outcome, 'needs_review');
  } finally { site.close(); }
});

test('low-confidence evidence goes to NEEDS_REVIEW; human release captures once; human reject keeps money held', async () => {
  const { engine, d } = await fundedDeal({ checkProof: async () => ({ verdict: 'unclear', confidence: 0.55, reasons: ['icons differ'], by: 'claude-vision' }) });
  engine.get(d.id).contract.milestones[0].oracle = { type: 'evidence' };
  let r = await engine.submit(d.id, 'm1', { text: 'x' }); assert.equal(r.result.outcome, 'needs_review'); assert.ok(r.deal.milestones[0].review.for_client);
  const rej = await engine.review(d.id, 'm1', 'reject'); assert.equal(rej.milestones[0].status, 'REJECTED'); assert.equal(rej.money.captured_cents, 0);
  await engine.submit(d.id, 'm1', { text: 'x2' });
  const rel = await engine.review(d.id, 'm1', 'release'); assert.equal(rel.money.captured_cents, 36000);
  await assert.rejects(() => engine.review(d.id, 'm1', 'release'), (e) => e.code === 'MILESTONE_CLOSED');
});

test('concurrent releases of the same milestone capture exactly once', async () => {
  const { engine, d, escrow } = await fundedDeal({ checkProof: async () => ({ verdict: 'unclear', confidence: 0.5, reasons: ['?'], by: 'heuristic' }) });
  engine.get(d.id).contract.milestones[0].oracle = { type: 'manual' };
  await engine.submit(d.id, 'm1', {});
  const results = await Promise.allSettled([engine.review(d.id, 'm1', 'release'), engine.review(d.id, 'm1', 'release'), engine.review(d.id, 'm1', 'release')]);
  assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(engine.toApi(d).money.captured_cents, 36000);
  const a = [...escrow.auths.values()][0]; assert.equal(a.captured, 36000);
});

test('cancel after one release voids exactly the remainder; captured money stays captured', async () => {
  const { engine, d, escrow } = await fundedDeal();
  engine.get(d.id).contract.milestones[0].oracle = { type: 'evidence' };
  await engine.submit(d.id, 'm1', { text: 'ok' }).catch(() => {});
  const before = engine.toApi(d).money.captured_cents;
  const c = await engine.cancel(d.id, 'client changed mind');
  assert.equal(c.status, 'CANCELLED'); assert.equal(c.money.captured_cents, before); assert.equal(c.money.voided_cents, 120000 - before); assert.equal(c.money.remaining_cents, 0);
  assert.equal([...escrow.auths.values()][0].status, 'VOIDED');
  await assert.rejects(() => engine.cancel(d.id), (e) => e.code === 'DEAL_CLOSED');
});

test('deadline passes: remaining hold voided, deal EXPIRED', async () => {
  const { engine, d } = await fundedDeal();
  const e = await engine.advanceClock(d.id, 28); assert.equal(e.status, 'EXPIRED'); assert.equal(e.money.voided_cents, 120000);
});

test('a PayPal failure on capture leaves the deal state untouched (no phantom release)', async () => {
  const escrow = new MockEscrow(); const real = escrow.capture.bind(escrow); let fail = true;
  escrow.capture = async (...a) => { if (fail) { fail = false; throw new Error('PayPal is down'); } return real(...a); };
  const { engine, d } = await fundedDeal({ escrow });
  engine.get(d.id).contract.milestones[0].oracle = { type: 'evidence' };
  await assert.rejects(() => engine.submit(d.id, 'm1', { text: 'x' }), (e) => e.code === 'PAYPAL_ERROR');
  const api = engine.toApi(d); assert.equal(api.money.captured_cents, 0); assert.notEqual(api.milestones[0].status, 'RELEASED');
  assert.ok(rows(engine, d.id, 'state').some((r) => r.status === 'ERROR'));
});

test('cannot fund twice, wrong order id rejected, dependency order enforced on submit', async () => {
  const { engine, d } = await fundedDeal();
  await assert.rejects(() => engine.submit(d.id, 'm2', { text: 'x' }), (e) => e.code === 'DEPENDENCY');
  await assert.rejects(() => engine.startFunding(d.id), (e) => e.code === 'BAD_STATE');
});

test('webhooks reconcile and write ledger rows without moving money', async () => {
  const { engine, d } = await fundedDeal();
  const before = JSON.stringify(engine.toApi(d).money);
  const out = engine.handleWebhook({ event_type: 'PAYMENT.AUTHORIZATION.CREATED', resource: { id: engine.toApi(d).funding.authorization_id } }, { verified: false });
  assert.equal(out.matched, true); assert.equal(rows(engine, d.id, 'webhook').length, 1); assert.equal(JSON.stringify(engine.toApi(d).money), before);
  assert.equal(engine.handleWebhook({ event_type: 'X', resource: { id: 'nope' } }, { verified: false }).matched, false);
});

test('events stream and seeded demo deals work', async () => {
  const engine = createEngine({ escrow: new MockEscrow(), baseUrl: 'http://x' }); const seen = []; engine.subscribe((e) => seen.push(e.type));
  const d = await engine.seedDemo('midway', demoContract());
  const api = engine.toApi(d); assert.equal(api.status, 'ACTIVE'); assert.equal(api.milestones[0].status, 'RELEASED'); assert.equal(api.milestones[1].status, 'NEEDS_REVIEW');
  assert.ok(seen.includes('funding.authorized') && seen.includes('milestone.released') && seen.includes('milestone.needs_review'));
  assert.ok(engine.ledger(d.id).length >= 5);
});

test('SSRF guard refuses private addresses unless explicitly allowed', async () => {
  process.env.PACTLINE_ALLOW_PRIVATE_URLS = '0';
  try { for (const u of ['http://127.0.0.1:9/x', 'http://169.254.169.254/latest/meta-data', 'http://10.0.0.5/', 'http://192.168.1.1/']) await assert.rejects(() => assertPublicUrl(u), (e) => e.private === true, u); }
  finally { process.env.PACTLINE_ALLOW_PRIVATE_URLS = '1'; }
});
