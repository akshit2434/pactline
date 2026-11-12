// Dev helper: exposes ONLY POST /webhooks/paypal to the internet (via a quick tunnel) by forwarding to the local app.
// Usage: node scripts/webhook-forwarder.mjs  (then: cloudflared tunnel --url http://127.0.0.1:3101)
import http from 'node:http';
const APP = process.env.APP || 'http://127.0.0.1:3100';
http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/webhooks/paypal') { res.writeHead(404); return res.end('not found'); }
  const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', async () => {
    try {
      const r = await fetch(APP + '/webhooks/paypal', { method: 'POST', headers: Object.fromEntries(Object.entries(req.headers).filter(([k]) => k.startsWith('paypal-') || k === 'content-type')), body: Buffer.concat(chunks) });
      res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(await r.text());
    } catch (e) { res.writeHead(502); res.end('upstream down'); }
  });
}).listen(Number(process.env.PORT || 3101), '127.0.0.1', () => console.log('webhook forwarder on 3101'));
