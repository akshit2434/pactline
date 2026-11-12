// HTTP-level test of PACTLINE_PUBLIC=1: real server, mock PayPal, Claude gated by a zero daily cap (no network calls).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 3198; const B = `http://127.0.0.1:${PORT}`; let child; let dir;
const call = async (m, p, b, h = {}) => { const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', ...h }, body: b ? JSON.stringify(b) : undefined, redirect: 'manual' }); const text = await r.text(); let body = {}; try { body = JSON.parse(text); } catch { body = text; } return { status: r.status, headers: r.headers, body }; };
const cookieOf = (r) => (r.headers.get('set-cookie') || '').split(';')[0];

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-pub-'));
  child = spawn(process.execPath, ['src/server.js'], { env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(PORT), PAYPAL_MODE: 'mock', KEYS_FILE: '', PACTLINE_PUBLIC: '1', PACTLINE_DATA_DIR: dir, ANTHROPIC_API_KEY: 'sk-ant-test-not-a-key', PACTLINE_CLAUDE_PER_DAY: '0', PACTLINE_DEALS_PER_HOUR: '2', PAYPAL_US_SANDBOX_BUYER_EMAIL: 'buyer@example.test', PAYPAL_US_SANDBOX_BUYER_PASSWORD: 'throwaway-1', PAYPAL_US_SANDBOX_CLIENT_ID: '', PAYPAL_SANDBOX_CLIENT_SECRET: 'merchant-secret-should-not-leak' }, stdio: ['ignore', 'pipe', 'inherit'] });
  child.stdout.setEncoding('utf8');
  await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('server did not start')), 15000); child.stdout.on('data', (d) => { if (String(d).includes('Pactline on')) { clearTimeout(t); resolve(); } }); });
});
after(() => { child?.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

test('index has the sandbox banner and security headers', async () => {
  const r = await call('GET', '/');
  assert.equal(r.status, 200); assert.match(r.body, /PayPal Sandbox: no real money/);
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(r.headers.get('content-security-policy'), /script-src 'self' 'sha256-/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('x-powered-by'), null);
  assert.match(r.headers.get('set-cookie'), /pl_sid=[a-f0-9]{32}; Path=\/; HttpOnly; SameSite=Lax/);
});

test('status leaks no key names or emails; public config shows only the sandbox buyer', async () => {
  const s = await call('GET', '/api/status'); const txt = JSON.stringify(s.body);
  assert.equal(s.body.public_demo.sandbox_only, true);
  assert.doesNotMatch(txt, /@|ANTHROPIC|PAYPAL_|CLIENT_ID|SECRET|public_url/i);
  const c = await call('GET', '/api/public/config'); const ctxt = JSON.stringify(c.body);
  assert.deepEqual(c.body.sandbox_buyer, { email: 'buyer@example.test', password: 'throwaway-1' });
  assert.doesNotMatch(ctxt, /merchant-secret|client_id|secret/i);
});

test('debug routes are off; unsigned webhooks refused; cross-origin writes refused', async () => {
  assert.equal((await call('POST', '/api/demo/reset', {})).status, 404);
  assert.equal((await call('POST', '/api/webhooks/simulate', { deal_id: 'x' })).status, 404);
  assert.equal((await call('POST', '/webhooks/paypal', { event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: {} })).status, 401);
  assert.equal((await call('POST', '/api/contracts/verify', { contract: {} }, { origin: 'https://evil.example' })).status, 403);
});

test('body limits and errors carry no stack traces', async () => {
  const big = await call('POST', '/api/contracts/verify', { contract: { x: 'y'.repeat(100_000) } });
  assert.equal(big.status, 413); assert.equal(big.body.code, 'TOO_LARGE'); assert.doesNotMatch(JSON.stringify(big.body), /at |node_modules|\.js:/);
  const r = await fetch(B + '/api/contracts/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad json' });
  const body = await r.text(); assert.equal(r.status, 400); assert.doesNotMatch(body, /at |node_modules|SyntaxError/);
  assert.equal((await call('POST', '/api/contracts/compile', { text: 'x'.repeat(3000) })).status, 413);
});

test('daily Claude cap reached: compile still works on the offline fallback with a visible notice', async () => {
  const demo = (await call('GET', '/api/demo/contract')).body;
  const r = await call('POST', '/api/contracts/compile', { text: demo.text });
  assert.equal(r.status, 200); assert.equal(r.body.source, 'fallback'); assert.equal(r.body.verification.ok, true);
  assert.match(r.headers.get('x-pactline-notice'), /Claude budget/); assert.match(r.body.notice, /offline fallback/);
});

test('deals: per-visitor ownership, per-IP deal limit returns 429 with Retry-After, uploads checked', async () => {
  const demo = (await call('GET', '/api/demo/contract')).body.contract; demo.milestones[0].oracle = { type: 'manual' };
  const first = await call('GET', '/api/status'); const me = cookieOf(first); const other = cookieOf(await call('GET', '/api/status'));
  const d = await call('POST', '/api/deals', { contract: demo }, { cookie: me }); assert.equal(d.status, 201);
  assert.equal((await call('GET', `/api/deals/${d.body.id}`, null, { cookie: me })).status, 200);
  assert.equal((await call('GET', `/api/deals/${d.body.id}`, null, { cookie: other })).status, 404, 'other visitors cannot see it');
  assert.equal((await call('POST', `/api/deals/${d.body.id}/cancel`, {}, { cookie: other })).status, 404, 'or act on it');
  assert.equal((await call('GET', '/api/deals', null, { cookie: other })).body.deals.length, 0);
  assert.equal((await call('GET', '/api/deals', null, { cookie: me })).body.deals.length, 1);
  const f = (await call('POST', `/api/deals/${d.body.id}/fund`, {}, { cookie: me })).body;
  assert.equal((await call('POST', `/api/deals/${d.body.id}/fund/complete`, { order_id: f.order_id }, { cookie: me })).status, 200);
  const svg = await call('POST', `/api/deals/${d.body.id}/milestones/m1/submit`, { image_data_url: 'data:image/svg+xml;base64,PHN2Zy8+' }, { cookie: me });
  assert.equal(svg.status, 415);
  assert.equal((await call('POST', '/api/deals', { contract: demo }, { cookie: me })).status, 201);
  const third = await call('POST', '/api/deals', { contract: demo }, { cookie: other });
  assert.equal(third.status, 429); assert.equal(third.body.code, 'DEAL_LIMIT'); assert.ok(Number(third.headers.get('retry-after')) > 0);
});
