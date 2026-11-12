// Public demo mode: limiter, daily cap, Claude budget, upload checks, CSP/banner helpers, SSRF address checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RateLimiter, DailyCap, createClaudeBudget, clientIp } from '../src/public/limiter.js';
import { checkEvidence } from '../src/public/evidence.js';
import { buildCsp, inlineScriptHashes, injectBanner } from '../src/public/mode.js';
import { isPrivateAddress } from '../src/oracles/index.js';

const clock = (t0 = Date.UTC(2026, 11, 1, 10)) => { let t = t0; const f = () => t; f.add = (ms) => (t += ms); return f; };

test('rate limiter allows N per window per key, then 429-style refusal with retry time', () => {
  const now = clock(); const rl = new RateLimiter({ limit: 5, windowMs: 3_600_000, now });
  for (let i = 0; i < 5; i++) assert.equal(rl.hit('1.2.3.4').ok, true, `hit ${i}`);
  const r = rl.hit('1.2.3.4'); assert.equal(r.ok, false); assert.equal(r.remaining, 0); assert.ok(r.retryAfterMs > 0 && r.retryAfterMs <= 3_600_000);
  assert.equal(rl.hit('5.6.7.8').ok, true, 'other IPs are independent');
});

test('rate limiter window slides: old hits expire, refused hits are not counted', () => {
  const now = clock(); const rl = new RateLimiter({ limit: 2, windowMs: 1000, now });
  rl.hit('a'); now.add(600); rl.hit('a');
  assert.equal(rl.hit('a').ok, false); assert.equal(rl.hit('a').ok, false);
  now.add(401); assert.equal(rl.hit('a').ok, true, 'first hit expired');
  assert.equal(rl.hit('a').ok, false);
  now.add(5000); rl.sweep(); assert.equal(rl.hits.size, 0, 'sweep drops idle keys');
  assert.equal(rl.peek('a').ok, true); assert.equal(rl.hits.size, 0, 'peek does not record');
});

test('daily cap stops at N, persists across restarts and resets at the UTC day boundary', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-cap-')); const file = path.join(dir, 'cap.json');
  const now = clock(Date.UTC(2026, 11, 1, 23, 0));
  const cap = new DailyCap({ cap: 3, file, now });
  assert.deepEqual([cap.tryConsume(), cap.tryConsume(), cap.tryConsume(), cap.tryConsume()], [true, true, true, false]);
  const again = new DailyCap({ cap: 3, file, now }); assert.equal(again.tryConsume(), false, 'restart keeps the count'); assert.equal(again.remaining(), 0);
  now.add(2 * 3_600_000); assert.equal(again.tryConsume(), true, 'new UTC day'); assert.equal(again.used(), 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('claude budget: per-IP hourly limit and global daily cap, IP hit only counted when the call goes ahead', () => {
  const now = clock(); const b = createClaudeBudget({ perHour: 2, perDay: 3, file: null, now });
  assert.equal(b.check('ip1').ok, true); assert.equal(b.check('ip1').ok, true);
  assert.deepEqual(b.check('ip1'), { ok: false, reason: 'ip' });
  assert.equal(b.status().daily_used, 2, 'refused per-IP call does not spend the daily budget');
  assert.equal(b.check('ip2').ok, true);
  assert.deepEqual(b.check('ip3'), { ok: false, reason: 'daily' });
  now.add(3_600_001); assert.deepEqual(b.check('ip1'), { ok: false, reason: 'daily' }, 'daily cap still holds after the hour');
});

test('client IP: Cloudflare header only trusted from the local connector', () => {
  assert.equal(clientIp({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'cf-connecting-ip': '203.0.113.9' } }), '203.0.113.9');
  assert.equal(clientIp({ socket: { remoteAddress: '198.51.100.2' }, headers: { 'cf-connecting-ip': '203.0.113.9' } }), '198.51.100.2');
  assert.equal(clientIp({ socket: { remoteAddress: '::1' }, headers: {} }), '::1');
});

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
test('evidence: allow-listed types with matching bytes pass; others are refused with 415/413/400', () => {
  const ok = checkEvidence({ text: 'done', url: 'https://example.com/x', image_data_url: 'data:image/png;base64,' + PNG.toString('base64') });
  assert.equal(ok.text, 'done'); assert.ok(ok.image_data_url);
  assert.ok(checkEvidence({ image_data_url: 'data:application/pdf;base64,' + Buffer.from('%PDF-1.7 test').toString('base64') }).image_data_url);
  const code = (b, o) => { try { checkEvidence(b, o); return 'ok'; } catch (e) { return `${e.status} ${e.code}`; } };
  assert.equal(code({ image_data_url: 'data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64') }), '415 UNSUPPORTED_FILE');
  assert.equal(code({ image_data_url: 'data:text/html;base64,PGgxPg==' }), '415 UNSUPPORTED_FILE');
  assert.equal(code({ image_data_url: 'data:image/png;base64,' + Buffer.from('GIF89a-not-a-png').toString('base64') }), '415 UNSUPPORTED_FILE', 'magic bytes must match');
  assert.equal(code({ image_data_url: 'data:image/png;base64,' + Buffer.concat([PNG, Buffer.alloc(3000)]).toString('base64') }, { maxBytes: 1024 }), '413 FILE_TOO_LARGE');
  assert.equal(code({ image_data_url: 'not a data url' }), '400 BAD_EVIDENCE');
  assert.equal(code({ url: 'file:///etc/passwd' }), '400 BAD_EVIDENCE');
  assert.equal(code({ url: 'https://user:pw@example.com/' }), '400 BAD_EVIDENCE');
  assert.equal(code({ text: 'x'.repeat(5000) }), '413 EVIDENCE_TOO_LARGE');
  assert.equal(code({ text: { $ne: 1 } }), '400 BAD_EVIDENCE');
});

test('CSP allows only self plus the hashed inline script, and forbids framing', () => {
  const html = '<html><head><script>var a=1</script><script src="x.js"></script></head><body class="b"><p>x</p></body></html>';
  const hashes = inlineScriptHashes(html); assert.equal(hashes.length, 1);
  const csp = buildCsp(hashes);
  assert.match(csp, /frame-ancestors 'none'/); assert.match(csp, /script-src 'self' 'sha256-/); assert.doesNotMatch(csp, /unsafe-eval/); assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
  const out = injectBanner(html);
  assert.match(out, /<body class="b">\s*<div class="pl-public-banner"[^>]*><strong>PayPal Sandbox: no real money\.<\/strong>/);
  assert.match(out, /href="\/\?demo=1"/); assert.match(out, /\/_public\/public\.js/); assert.match(out, /\/_public\/public\.css/);
});

test('SSRF guard recognises private, mapped and CGNAT addresses', () => {
  for (const a of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', '::ffff:127.0.0.1', 'fd00::1', 'fe80::1', '224.0.0.1']) assert.equal(isPrivateAddress(a), true, a);
  for (const a of ['8.8.8.8', '104.16.1.1', '2606:4700::1111', '100.128.0.1']) assert.equal(isPrivateAddress(a), false, a);
});
