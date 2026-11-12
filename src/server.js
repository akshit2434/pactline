import express from 'express';
import path from 'node:path';
import { config } from './config.js';
import { createPayPal } from './paypal/index.js';
import { LiveEscrow, MockEscrow } from './paypal/escrow.js';
import { LivePayPal } from './paypal/live.js';
import { createEngine, EngineError } from './engine.js';
import { aiStatus, explainEvent } from './ai/index.js';
import { verifyContract } from './core/verify.js';
import { compileText } from './compile.js';
import { DEMO_TEXT, demoContract } from './demo.js';
import { applyPublicMode } from './public/mode.js';

const pp = await createPayPal().catch((e) => { console.error('[paypal] live setup failed, using mock:', e.message.slice(0, 200)); return null; });
const live = pp && pp.mode === 'live';
const invPP = live && config.paypal.invoicingClientId && config.paypal.invoicingClientId !== config.paypal.clientId ? new LivePayPal({ ...config.paypal, clientId: config.paypal.invoicingClientId, clientSecret: config.paypal.invoicingClientSecret, currency: 'USD' }) : null;
const escrow = live ? new LiveEscrow(pp, invPP) : new MockEscrow();
const engine = createEngine({ escrow, baseUrl: config.publicBaseUrl, dataFile: path.join(config.dataDir, 'pactline-state.json'), confirmDays: Number(process.env.PACTLINE_CONFIRM_DAYS ?? 3) });

const app = express();
app.disable('x-powered-by');
// Public judge demo: limits, caps, headers, per-visitor deals, banner (src/public/mode.js). Must run before the routes.
const pub = config.public ? applyPublicMode(app, { engine, config, live }) : null;
if (!pub) app.use(express.json({ limit: '12mb' })); // evidence screenshots arrive as data URLs
app.use(express.static(path.join(config.root, 'public')));

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  const status = e.status || (e.code === 'AI_BAD_INPUT' ? 400 : 500);
  if (status >= 500) console.error('[error]', e.stack?.split('\n').slice(0, 3).join(' | '));
  if (pub && status >= 500) return res.status(status).json({ error: 'Something went wrong. Please try again.', code: e.code && /^[A-Z_]+$/.test(e.code) ? e.code : 'INTERNAL' });
  res.status(status).json({ error: e.message, code: e.code || 'INTERNAL', ...(e.verification ? { verification: e.verification } : {}) });
});

app.get('/api/status', (_req, res) => res.json({
  paypal: live ? 'live' : 'mock', currency: 'USD', ai: aiStatus(),
  clock: { now: new Date().toISOString(), offset_days: 0 },
  webhooks: { verify: live && process.env.PAYPAL_WEBHOOK_ID ? 'paypal' : 'simulated-only', public_url: process.env.PUBLIC_WEBHOOK_URL || null },
}));

// ---- contracts ----
app.post('/api/contracts/compile', wrap(async (req, res) => { res.json(await compileText(String(req.body?.text || ''))); }));
app.post('/api/contracts/typo', wrap(async (req, res) => { res.json(await compileText(String(req.body?.text || DEMO_TEXT), { forceTypo: true })); }));
app.post('/api/contracts/verify', wrap(async (req, res) => { res.json(verifyContract(req.body?.contract)); }));
app.get('/api/demo/contract', (_req, res) => res.json({ text: DEMO_TEXT, contract: demoContract(config.publicBaseUrl) }));
// A tiny "staging site" the demo's URL oracle can check (returns 200 and shows the client's headline).
app.get('/demo/staging', (_req, res) => res.type('html').send('<!doctype html><meta charset=utf-8><title>Northwind Traders: staging</title><body style="font:18px system-ui;max-width:640px;margin:10vh auto;padding:0 20px"><h1>Northwind Traders</h1><p>Staging build of the new landing page. Hero, pricing table and footer are live.</p></body>'));

// ---- deals ----
app.post('/api/deals', wrap(async (req, res) => { res.status(201).json(engine.toApi(engine.createDeal(req.body?.contract))); }));
app.get('/api/deals', (_req, res) => res.json({ deals: engine.list().map((d) => engine.toApi(d)) }));
app.get('/api/deals/:id', wrap(async (req, res) => { res.json(engine.toApi(engine.get(req.params.id))); }));
app.post('/api/deals/:id/fund', wrap(async (req, res) => { res.json(await engine.startFunding(req.params.id)); }));
app.post('/api/deals/:id/fund/complete', wrap(async (req, res) => { res.json(engine.toApi(await engine.completeFunding(req.params.id, req.body?.order_id))); }));
app.get('/api/deals/:id/fund/return', wrap(async (req, res) => {
  try { await engine.completeFunding(req.params.id, String(req.query.token || '')); res.redirect(`/?deal=${req.params.id}&funded=1`); }
  catch (e) { console.error('[fund/return]', e.message.slice(0, 200)); res.redirect(`/?deal=${req.params.id}&funded=0&error=${encodeURIComponent(pub ? 'PayPal did not confirm the hold' : e.message.slice(0, 120))}`); }
}));
app.post('/api/deals/:id/milestones/:mid/submit', wrap(async (req, res) => {
  const b = req.body || {}; res.json(await engine.submit(req.params.id, req.params.mid, { text: b.text, url: b.url, image_data_url: b.image_data_url }));
}));
app.post('/api/deals/:id/milestones/:mid/review', wrap(async (req, res) => { res.json(await engine.review(req.params.id, req.params.mid, req.body?.decision, req.body?.note)); }));
app.post('/api/deals/:id/milestones/:mid/confirm', wrap(async (req, res) => { res.json(await engine.confirm(req.params.id, req.params.mid)); }));
app.post('/api/deals/:id/milestones/:mid/dispute', wrap(async (req, res) => { res.json(await engine.dispute(req.params.id, req.params.mid, { reason: req.body?.reason, criterion: req.body?.criterion })); }));
app.post('/api/deals/:id/cancel', wrap(async (req, res) => { res.json(await engine.cancel(req.params.id, req.body?.reason)); }));
app.post('/api/deals/:id/clock', wrap(async (req, res) => { res.json(await engine.advanceClock(req.params.id, Number(req.body?.advance_days) || 0)); }));
app.get('/api/deals/:id/ledger', wrap(async (req, res) => { engine.get(req.params.id); res.json({ rows: engine.ledger(req.params.id) }); }));
app.get('/api/ledger', (_req, res) => res.json({ rows: engine.ledger() }));

// ---- events ----
app.get('/api/events/poll', (req, res) => { const ev = engine.events(Number(req.query.since) || 0, req.query.deal); res.json({ events: ev, last_id: ev.length ? ev[ev.length - 1].id : engine.lastEventId() }); });
app.get('/api/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const send = (ev) => { if (!req.query.deal || req.query.deal === ev.deal_id) res.write(`id: ${ev.id}\ndata: ${JSON.stringify(ev)}\n\n`); };
  res.write(': connected\n\n');
  const since = Number(req.get('last-event-id') || req.query.since || 0); if (since) engine.events(since).forEach(send);
  const off = engine.subscribe(send); const hb = setInterval(() => res.write(': hb\n\n'), 20000);
  req.on('close', () => { off(); clearInterval(hb); });
});
app.post('/api/explain', wrap(async (req, res) => { res.json({ text: await explainEvent(req.body?.event || {}) }); }));

// ---- webhooks ----
app.post('/webhooks/paypal', wrap(async (req, res) => {
  let verified = false;
  if (live && process.env.PAYPAL_WEBHOOK_ID) {
    verified = await pp.verifyWebhook({ headers: req.headers, body: req.body, webhookId: process.env.PAYPAL_WEBHOOK_ID }).catch(() => false);
    if (!verified) return res.status(401).json({ error: 'signature verification failed', code: 'BAD_SIGNATURE' });
  }
  res.json({ ok: true, ...engine.handleWebhook(req.body || {}, { verified }) });
}));
app.post('/api/webhooks/simulate', wrap(async (req, res) => {
  const d = engine.get(req.body?.deal_id); const type = req.body?.type || 'PAYMENT.CAPTURE.COMPLETED';
  const cap = Object.values(d.ms).find((m) => m.capture_id)?.capture_id;
  const resource = type.includes('AUTHORIZATION') ? { id: d.funding.authorization_id } : type.startsWith('INVOICING') ? { id: Object.values(d.ms).find((m) => m.receipt)?.receipt.invoice_id || d.id, custom_id: d.id } : { id: cap || d.id, custom_id: d.id, amount: { value: '0.00' } };
  res.json({ ok: true, ...engine.handleWebhook({ id: 'WH-SIM-' + Date.now(), event_type: type, resource }, { verified: false }) });
}));

// ---- mock approval page (mock mode only) ----
app.get('/mock/approve', (req, res) => {
  const ret = String(req.query.return || '/'); if (!ret.startsWith('/') && !ret.startsWith(config.publicBaseUrl)) return res.status(400).send('bad return');
  res.type('html').send(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Mock PayPal approval</title><body style="font:16px system-ui;max-width:440px;margin:12vh auto;padding:0 20px"><h1>Mock PayPal sandbox</h1><p>Stands in for the PayPal approval screen when no sandbox keys are configured. Approving authorizes a hold; nothing is charged.</p><a href="${ret.replace(/"/g, '&quot;')}" style="display:inline-block;background:#0070ba;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600">Approve hold as sandbox buyer</a></body>`);
});

// ---- demo helpers ----
app.post('/api/demo/seed', wrap(async (req, res) => { res.json(engine.toApi(await engine.seedDemo(req.body?.stage || 'midway', demoContract(config.publicBaseUrl)))); }));
app.post('/api/demo/reset', wrap(async (_req, res) => { engine.reset(); res.json({ ok: true }); }));

app.use('/api', (_req, res) => res.status(404).json({ error: 'No such endpoint', code: 'NOT_FOUND' }));
if (pub) pub.finish(app);
app.listen(config.port, config.host, () => console.log(`Pactline on http://${config.host}:${config.port}  paypal=${live ? 'live' : 'mock'}  ai=${JSON.stringify(aiStatus())}`));
