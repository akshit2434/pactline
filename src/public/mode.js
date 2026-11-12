// PACTLINE_PUBLIC=1: the hardening layer for the public judge demo.
// - per-IP rate limits (requests, writes, deals, Claude calls) and a global daily Claude cap (then offline fallback, with a visible note)
// - request size limits, proof-upload type/size checks
// - security headers (CSP, nosniff, frame-ancestors none), cross-origin writes refused, no stack traces
// - each visitor (cookie) sees and acts only on their own deals; reset/simulate/debug routes are off
// - a server-injected "PayPal Sandbox: no real money" banner, a "Try the demo" path and the sandbox test buyer on the hold screen
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AsyncLocalStorage } from 'node:async_hooks';
import express from 'express';
import { RateLimiter, createClaudeBudget, clientIp } from './limiter.js';
import { checkEvidence } from './evidence.js';
import { setCallGate, AiUnavailable } from '../ai/client.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const als = new AsyncLocalStorage();

const tooMany = (res, r, message, code = 'RATE_LIMITED') => {
  const s = Math.ceil(r.retryAfterMs / 1000);
  res.set('Retry-After', String(s));
  return res.status(429).json({ error: message, code, retry_after_s: s });
};

/** Pure helper (tested): the CSP for the app, allowing the given inline-script hashes. */
export function buildCsp(scriptHashes = []) {
  return [
    "default-src 'self'",
    `script-src 'self'${scriptHashes.map((h) => ` 'sha256-${h}'`).join('')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function inlineScriptHashes(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => crypto.createHash('sha256').update(m[1], 'utf8').digest('base64'));
}

/** Pure helper (tested): inject the banner, stylesheet and script into the app's index.html. */
export function injectBanner(html, { buyerShown = true } = {}) {
  const banner = '<div class="pl-public-banner" role="note"><strong>PayPal Sandbox: no real money.</strong> '
    + `<span>Public judge demo. Approve holds with ${buyerShown ? 'the sandbox test buyer shown on screen' : 'a PayPal sandbox personal account'}.</span> `
    + '<a class="pl-try" href="/?demo=1">Try the demo without a PayPal login (simulated)</a></div>';
  return html
    .replace('</head>', '  <link rel="stylesheet" href="/_public/public.css">\n</head>')
    .replace(/<body([^>]*)>/, (m) => `${m}\n  ${banner}`)
    .replace('</body>', '  <script type="module" src="/_public/public.js"></script>\n</body>');
}

/**
 * Install public-mode middleware on `app`. Call before the normal routes and the static handler.
 * Returns { finish(app) } to install the final error handler after all routes.
 */
export function applyPublicMode(app, { engine, config, live = false, now = () => Date.now() }) {
  const P = config.public;
  const dataDir = config.dataDir;
  const base = new URL(config.publicBaseUrl);
  const secure = base.protocol === 'https:';
  const allowedOrigins = new Set([base.origin, `http://127.0.0.1:${config.port}`]); // public origin + local operator checks

  // ---------- limiters ----------
  const reqLimiter = new RateLimiter({ limit: P.requestsPer10Min, windowMs: 600_000, now });
  const writeLimiter = new RateLimiter({ limit: P.writesPer10Min, windowMs: 600_000, now });
  const dealLimiter = new RateLimiter({ limit: P.dealsPerHour, windowMs: 3_600_000, now });
  const claude = createClaudeBudget({ perHour: P.claudePerHour, perDay: P.claudePerDay, file: path.join(dataDir, 'claude-budget.json'), now });
  setInterval(() => { reqLimiter.sweep(); writeLimiter.sweep(); dealLimiter.sweep(); claude.ipLimiter.sweep(); }, 600_000).unref();

  setCallGate(() => {
    const store = als.getStore();
    const r = claude.check(store?.ip || 'background');
    if (!r.ok) {
      if (store) store.aiNotice = r.reason === 'daily' ? 'daily' : 'ip';
      throw new AiUnavailable(r.reason === 'daily' ? 'Public demo: daily Claude budget used up' : 'Public demo: hourly Claude limit for this visitor reached');
    }
  });

  // ---------- deal ownership (per visitor cookie) ----------
  const ownersFile = path.join(dataDir, 'owners.json');
  let owners = {}; try { owners = JSON.parse(fs.readFileSync(ownersFile, 'utf8')); } catch { /* first run */ }
  const saveOwners = () => { try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(ownersFile, JSON.stringify(owners)); } catch { /* best effort */ } };
  const sidHash = (sid) => crypto.createHash('sha256').update(sid).digest('hex').slice(0, 32);
  const owns = (req, dealId) => Boolean(dealId) && owners[dealId] === req.plOwner;
  const ownedIds = (req) => new Set(Object.keys(owners).filter((k) => owners[k] === req.plOwner));

  // ---------- index.html with the banner ----------
  const indexFile = path.join(config.root, 'public', 'index.html');
  let indexCache = { mtime: 0, html: '', csp: '' };
  const index = () => {
    const st = fs.statSync(indexFile);
    if (st.mtimeMs !== indexCache.mtime) {
      const raw = fs.readFileSync(indexFile, 'utf8');
      indexCache = { mtime: st.mtimeMs, html: injectBanner(raw, { buyerShown: Boolean(P.showBuyer && P.buyer.email && P.buyer.password) }), csp: buildCsp(inlineScriptHashes(raw)) };
    }
    return indexCache;
  };
  const defaultCsp = buildCsp([]);

  // 1. headers, request id-free logging, IP + cookie, global request limit
  app.set('trust proxy', false);
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': defaultCsp,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'X-Pactline-Mode': 'public-sandbox',
    });
    if (secure) res.set('Strict-Transport-Security', 'max-age=15552000');
    req.plIp = clientIp(req);
    const m = /(?:^|;\s*)pl_sid=([a-f0-9]{32})(?:;|$)/.exec(req.headers.cookie || '');
    let sid = m && m[1];
    if (!sid) {
      sid = crypto.randomBytes(16).toString('hex');
      res.append('Set-Cookie', `pl_sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3456000${secure ? '; Secure' : ''}`);
    }
    req.plOwner = sidHash(sid);
    if (req.path.startsWith('/api/') || req.path.startsWith('/webhooks/')) {
      const r = reqLimiter.hit(req.plIp);
      res.set('RateLimit-Limit', String(r.limit)); res.set('RateLimit-Remaining', String(r.remaining));
      if (!r.ok) return tooMany(res, r, 'Too many requests from your address. Please wait a few minutes.');
    }
    next();
  });

  // 2. CORS locked: no cross-origin API access; cross-origin writes refused (CSRF). PayPal webhooks carry no Origin.
  app.use((req, res, next) => {
    if (req.method === 'OPTIONS') return res.status(204).set('Allow', 'GET, POST').end();
    const origin = req.headers.origin;
    if (origin && req.method !== 'GET' && req.method !== 'HEAD' && !allowedOrigins.has(origin) && !req.path.startsWith('/webhooks/')) {
      return res.status(403).json({ error: 'Cross-origin requests are not allowed', code: 'FORBIDDEN_ORIGIN' });
    }
    next();
  });

  // 3. request size limits: proof uploads up to the file cap (base64 + slack), everything else small
  const uploadLimit = Math.ceil(P.maxUploadBytes * 4 / 3) + 64 * 1024;
  app.use(/^\/api\/deals\/[^/]+\/milestones\/[^/]+\/submit$/, express.json({ limit: uploadLimit }));
  app.use(express.json({ limit: '64kb' }));

  // 4. per-request context for the Claude gate (installed after the body parser so the context survives)
  app.use((req, res, next) => {
    const store = { ip: req.plIp, aiNotice: null };
    const json = res.json.bind(res);
    res.json = (body) => {
      if (store.aiNotice && !res.headersSent) {
        const note = store.aiNotice === 'daily'
          ? 'The public demo used today\'s Claude budget, so this ran on the offline fallback.'
          : 'You reached this demo\'s hourly Claude limit, so this ran on the offline fallback.';
        res.set('X-Pactline-Notice', note);
        if (body && typeof body === 'object' && !Array.isArray(body)) body = { ...body, notice: note };
      }
      return json(body);
    };
    als.run(store, next);
  });

  // 5. writes limit, then route-specific rules
  app.use((req, res, next) => {
    if (req.method === 'POST' && req.path.startsWith('/api/')) {
      const r = writeLimiter.hit(req.plIp);
      if (!r.ok) return tooMany(res, r, 'Too many actions from your address. Please wait a few minutes.');
    }
    next();
  });

  const dealGuard = (req, res, next) => {
    const r = dealLimiter.hit(req.plIp);
    if (!r.ok) return tooMany(res, r, `The public demo allows ${P.dealsPerHour} new deals per hour per visitor. Try the simulated demo meanwhile.`, 'DEAL_LIMIT');
    const json = res.json.bind(res);
    res.json = (body) => { if (res.statusCode < 300 && body && body.id) { owners[body.id] = req.plOwner; saveOwners(); } return json(body); };
    next();
  };
  app.post('/api/deals', dealGuard);
  app.post('/api/demo/seed', dealGuard);

  // compile text: keep it to deal-sized input
  app.post(['/api/contracts/compile', '/api/contracts/typo'], (req, res, next) => {
    const t = req.body?.text;
    if (t != null && (typeof t !== 'string' || t.length > 2000)) return res.status(413).json({ error: 'Deals are limited to 2000 characters', code: 'TEXT_TOO_LARGE' });
    next();
  });

  // proof uploads: allow-list and size cap
  app.post('/api/deals/:id/milestones/:mid/submit', (req, res, next) => {
    try { req.body = checkEvidence(req.body || {}, { maxBytes: P.maxUploadBytes }); next(); }
    catch (e) { res.status(e.status || 400).json({ error: e.message, code: e.code || 'BAD_EVIDENCE' }); }
  });

  // every per-deal route: owner only (404 for others, so ids cannot be probed)
  app.use('/api/deals/:id', (req, res, next) => {
    if (!owns(req, req.params.id)) return res.status(404).json({ error: 'No such deal', code: 'NOT_FOUND' });
    next();
  });

  // lists and events: only the visitor's own deals
  app.get('/api/deals', (req, res) => { const mine = ownedIds(req); res.json({ deals: engine.list().filter((d) => mine.has(d.id)).map((d) => engine.toApi(d)) }); });
  app.get('/api/ledger', (req, res) => { const mine = ownedIds(req); res.json({ rows: engine.ledger().filter((r) => mine.has(r.deal_id)) }); });
  app.get('/api/events/poll', (req, res) => {
    const mine = ownedIds(req); const ev = engine.events(Number(req.query.since) || 0).filter((e) => mine.has(e.deal_id)).slice(-500);
    res.json({ events: ev, last_id: ev.length ? ev[ev.length - 1].id : engine.lastEventId() });
  });
  let streams = 0;
  app.get('/api/events', (req, res) => {
    if (streams >= 200) return res.status(503).json({ error: 'Busy, please retry', code: 'BUSY' });
    streams++;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const send = (ev) => { if (owners[ev.deal_id] === req.plOwner && (!req.query.deal || req.query.deal === ev.deal_id)) res.write(`id: ${ev.id}\ndata: ${JSON.stringify(ev)}\n\n`); };
    res.write(': connected\n\n');
    const since = Number(req.get('last-event-id') || req.query.since || 0); if (since) engine.events(since).slice(-500).forEach(send);
    const off = engine.subscribe(send); const hb = setInterval(() => res.write(': hb\n\n'), 20000);
    const life = setTimeout(() => res.end(), 30 * 60_000); // clients reconnect; bounds idle streams
    req.on('close', () => { streams--; off(); clearInterval(hb); clearTimeout(life); });
  });
  app.post('/api/explain', (req, res, next) => { if (JSON.stringify(req.body || {}).length > 8000) return res.status(413).json({ error: 'Event too large', code: 'TOO_LARGE' }); next(); });

  // admin / debug routes are not exposed (the mock approval page only exists without live PayPal)
  if (live) app.all('/mock/approve', (_req, res) => res.status(404).type('text/plain').send('Not found'));
  app.all(['/api/demo/reset', '/api/webhooks/simulate'], (_req, res) => res.status(404).json({ error: 'No such endpoint', code: 'NOT_FOUND' }));

  // status: no key names, no emails, plus the public-demo facts
  app.get('/api/status', (req, res, next) => {
    const json = res.json.bind(res);
    res.json = (body) => json({
      paypal: body.paypal, currency: body.currency, ai: body.ai, clock: body.clock,
      webhooks: { verify: body.webhooks?.verify === 'paypal' ? 'paypal' : 'off' },
      public_demo: { sandbox_only: true, limits: { deals_per_hour: P.dealsPerHour, claude_calls_per_hour: P.claudePerHour, max_upload_mb: Math.round(P.maxUploadBytes / 1048576 * 10) / 10 }, claude_budget_left_today: claude.daily.remaining() > 0 },
    });
    next();
  });

  // sandbox test buyer for the hold screen (sandbox only; never merchant credentials)
  app.get('/api/public/config', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    const b = P.showBuyer && P.buyer.email && P.buyer.password ? { email: P.buyer.email, password: P.buyer.password } : null;
    res.json({ banner: 'PayPal Sandbox: no real money', sandbox_buyer: b, try_demo_url: '/?demo=1' });
  });

  // webhooks: signature verification stays on; unsigned or unverifiable events are refused in public mode
  app.post('/webhooks/paypal', (req, res, next) => {
    if (!live || !process.env.PAYPAL_WEBHOOK_ID) return res.status(401).json({ error: 'webhook verification is not configured', code: 'BAD_SIGNATURE' });
    if (!req.headers['paypal-transmission-sig']) return res.status(401).json({ error: 'signature verification failed', code: 'BAD_SIGNATURE' });
    next();
  });

  // banner assets and the injected index page
  app.get('/_public/public.js', (_req, res) => res.type('application/javascript').set('Cache-Control', 'no-cache').sendFile(path.join(here, 'assets', 'public.js')));
  app.get('/_public/public.css', (_req, res) => res.type('text/css').set('Cache-Control', 'no-cache').sendFile(path.join(here, 'assets', 'public.css')));
  app.get(['/', '/index.html'], (_req, res) => { const i = index(); res.set('Content-Security-Policy', i.csp).set('Cache-Control', 'no-cache').type('html').send(i.html); });

  return {
    claude,
    finish(app2) {
      app2.use((req, res) => res.status(404).type('text/plain').send('Not found'));
      // final error handler: no stack traces, no internal messages
      app2.use((err, req, res, _next) => {
        const status = err.status || err.statusCode || 500;
        if (status >= 500) console.error('[error]', req.method, req.path, String(err.message || err).slice(0, 200));
        const msg = err.type === 'entity.too.large' ? 'Request is too large' : err.type === 'entity.parse.failed' ? 'Request body is not valid JSON' : status >= 500 ? 'Something went wrong' : 'Bad request';
        res.status(status >= 400 && status < 600 ? status : 500).json({ error: msg, code: err.type === 'entity.too.large' ? 'TOO_LARGE' : status >= 500 ? 'INTERNAL' : 'BAD_REQUEST' });
      });
    },
  };
}
