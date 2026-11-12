// HTTP-level tests: spawn the real server in mock mode with the AI forced offline (deterministic fallbacks).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 3199; const B = `http://127.0.0.1:${PORT}`; let child;
const j = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };

before(async () => {
  child = spawn(process.execPath, ['src/server.js'], { env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(PORT), PAYPAL_MODE: 'mock', PACTLINE_AI_OFFLINE: '1', KEYS_FILE: '', PACTLINE_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'pl-api-')) }, stdio: ['ignore', 'pipe', 'inherit'] });
  child.stdout.setEncoding('utf8');
  await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('server did not start')), 15000); child.stdout.on('data', (d) => { if (String(d).includes('Pactline on')) { clearTimeout(t); resolve(); } }); });
});
after(() => child?.kill());

test('status reports mock PayPal and offline AI', async () => { const { body } = await j('GET', '/api/status'); assert.equal(body.paypal, 'mock'); assert.equal(body.currency, 'USD'); assert.ok(body.ai.compiler); });

test('compile -> typo repair loop -> verification with paths', async () => {
  const demo = (await j('GET', '/api/demo/contract')).body;
  const c = await j('POST', '/api/contracts/compile', { text: demo.text }); assert.equal(c.status, 200); assert.equal(c.body.verification.ok, true); assert.ok(c.body.verification.paths > 10);
  const t = await j('POST', '/api/contracts/typo', { text: demo.text }); assert.equal(t.status, 200); assert.ok(t.body.attempts.length >= 1, 'typo must be caught'); assert.ok(t.body.attempts[0].errors.some((e) => e.code === 'SHARES_SUM')); assert.equal(t.body.verification.ok, true);
});

test('verify endpoint flags a broken contract; deal creation refuses it with 422', async () => {
  const demo = (await j('GET', '/api/demo/contract')).body.contract; demo.milestones[0].share_pct = 60;
  const v = await j('POST', '/api/contracts/verify', { contract: demo }); assert.equal(v.body.ok, false); assert.ok(v.body.errors.some((e) => e.code === 'SHARES_SUM'));
  const d = await j('POST', '/api/deals', { contract: demo }); assert.equal(d.status, 422); assert.equal(d.body.code, 'VERIFY_FAILED');
});

test('mock deal lifecycle over HTTP: fund -> submit -> review -> clock -> ledger -> events', async () => {
  const demo = (await j('GET', '/api/demo/contract')).body.contract; demo.milestones[0].oracle = { type: 'manual' };
  const d = (await j('POST', '/api/deals', { contract: demo })).body; assert.equal(d.status, 'AWAITING_FUNDING');
  const f = (await j('POST', `/api/deals/${d.id}/fund`)).body; assert.match(f.approve_url, /^\/mock\/approve/); assert.equal(f.mock, true);
  const funded = (await j('POST', `/api/deals/${d.id}/fund/complete`, { order_id: f.order_id })).body; assert.equal(funded.status, 'ACTIVE'); assert.equal(funded.money.held_cents, 120000);
  const s = (await j('POST', `/api/deals/${d.id}/milestones/m1/submit`, { text: 'done' })).body; assert.equal(s.result.outcome, 'needs_review');
  const r = (await j('POST', `/api/deals/${d.id}/milestones/m1/review`, { decision: 'release' })).body; assert.equal(r.money.captured_cents, 36000); assert.ok(r.milestones[0].receipt);
  const twice = await j('POST', `/api/deals/${d.id}/milestones/m1/review`, { decision: 'release' }); assert.equal(twice.status, 409);
  const cancelled = (await j('POST', `/api/deals/${d.id}/cancel`, {})).body; assert.equal(cancelled.money.voided_cents, 84000);
  const led = (await j('GET', `/api/deals/${d.id}/ledger`)).body.rows; assert.ok(led.some((x) => x.kind === 'capture') && led.some((x) => x.kind === 'void'));
  assert.equal(led.at(-1).balance_cents, 0);
  const poll = (await j('GET', `/api/events/poll?deal=${d.id}&since=0`)).body; assert.ok(poll.events.length >= 5 && poll.last_id > 0);
  const wh = (await j('POST', '/api/webhooks/simulate', { deal_id: d.id, type: 'PAYMENT.AUTHORIZATION.VOIDED' })).body; assert.equal(wh.ok, true);
});

test('demo seed returns believable deals at every stage', async () => {
  for (const stage of ['draft', 'awaiting', 'funded', 'midway', 'done', 'cancelled']) {
    const { status, body } = await j('POST', '/api/demo/seed', { stage }); assert.equal(status, 200, stage); assert.equal(body.mock, true);
    const m = body.money; assert.ok(m.captured_cents + m.voided_cents <= m.held_cents + 0);
  }
  const mid = (await j('POST', '/api/demo/seed', { stage: 'midway' })).body; assert.equal(mid.milestones[0].status, 'RELEASED'); assert.equal(mid.milestones[1].status, 'NEEDS_REVIEW');
});

test('SSE stream delivers events', async () => {
  const res = await fetch(B + '/api/events'); const reader = res.body.getReader(); const dec = new TextDecoder();
  await j('POST', '/api/demo/seed', { stage: 'funded' });
  let buf = ''; const t0 = Date.now();
  while (Date.now() - t0 < 4000 && !buf.includes('"type":"funding.authorized"')) { const { value } = await reader.read(); buf += dec.decode(value); }
  reader.cancel(); assert.ok(buf.includes('funding.authorized'));
});

test('bad input yields JSON errors, never HTML', async () => {
  const r = await j('POST', '/api/contracts/compile', { text: '' }); assert.ok(r.status >= 400 && r.body.error);
  const n = await j('GET', '/api/deals/nope'); assert.equal(n.status, 404); assert.equal(n.body.code, 'NOT_FOUND');
  const x = await j('GET', '/api/nothing'); assert.equal(x.status, 404);
});
