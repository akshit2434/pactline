// End-to-end QA against the REAL PayPal sandbox through the running HTTP API (server must be up on :3100, PAYPAL_MODE=live).
// compile -> verify -> create deal -> client approves the hold (headless buyer) -> milestone releases (partial captures)
// -> receipt invoices -> cancel (void remainder) -> ledger + webhook simulation.
import { approve } from './approve.mjs';
const B = process.env.BASE || 'http://127.0.0.1:3100';
const j = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const x = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${m} ${p} -> ${r.status} ${x.error || ''}`); return x; };
const ok = (n, v) => console.log('✔', n, v ?? '');
const assert = (c, m) => { if (!c) { console.error('✖ ASSERT', m); process.exitCode = 1; throw new Error(m); } };

const st = await j('GET', '/api/status'); ok('status', JSON.stringify({ paypal: st.paypal, ai: st.ai }));
assert(st.paypal === 'live', 'server must run in live mode');
const demo = await j('GET', '/api/demo/contract');
const typo = await j('POST', '/api/contracts/typo', { text: demo.text });
ok('verifier caught the typo, repair loop fixed it', `${typo.attempts.length} failed attempt(s) -> ok=${typo.verification.ok}, ${typo.verification.paths} paths`);
assert(typo.verification.ok, 'repaired contract must verify');
const contract = demo.contract; contract.hold.amount_cents = 6000; contract.milestones[0].amount_cents = 1800; contract.milestones[1].amount_cents = 3000; contract.milestones[2].amount_cents = 1200; // small real amounts: $60
const deal = await j('POST', '/api/deals', { contract }); ok('deal created', deal.id);
const fund = await j('POST', `/api/deals/${deal.id}/fund`); assert(/paypal\.com/.test(fund.approve_url), 'live approve url'); ok('hold requested', fund.order_id);
const landed = await approve(fund.approve_url, { log: (...a) => console.log('   [buyer]', ...a) });
// PayPal redirects the buyer to our return_url; the headless browser follows it, so the deal may already be authorized.
await new Promise((r) => setTimeout(r, 1500));
let d = await j('GET', `/api/deals/${deal.id}`);
if (d.funding.status !== 'authorized') { await j('GET', `/api/deals/${deal.id}/fund/return?token=${fund.order_id}`).catch(() => {}); d = await j('POST', `/api/deals/${deal.id}/fund/complete`, { order_id: fund.order_id }); }
assert(d.funding.status === 'authorized' && d.money.held_cents === 6000, 'funded and held: ' + JSON.stringify(d.funding));
ok('PayPal holds $60.00 (authorization)', d.funding.authorization_id);

// m1: URL oracle -> make it https://example.com which always returns 200 with "Example Domain"
let r = await j('POST', `/api/deals/${deal.id}/milestones/m1/submit`, { url: 'https://example.com' });
ok('m1 released via URL oracle', `${r.result.outcome} ${r.result.reasons[0]}`); assert(r.result.outcome === 'released', 'm1 released');
assert(r.deal.money.captured_cents === 1800, 'partial capture 30%');
// m2: evidence, with text only -> heuristic/Claude; force human review path if not confident
r = await j('POST', `/api/deals/${deal.id}/milestones/m2/submit`, { text: 'Screenshot attached: hero, pricing table and footer match the approved mockup.' });
ok('m2 check', `${r.result.outcome} by ${r.result.by} (${Math.round(r.result.confidence * 100)}%)`);
if (r.result.outcome !== 'released') { r = { deal: await j('POST', `/api/deals/${deal.id}/milestones/m2/review`, { decision: 'release', note: 'client approved' }) }; ok('m2 released by the client (human review path)'); }
assert(r.deal.money.captured_cents === 4800, 'second partial capture');
d = await j('GET', `/api/deals/${deal.id}`);
ok('receipts', d.milestones.filter((m) => m.receipt).map((m) => `#${m.receipt.number} ${m.receipt.status}`).join(', ')); assert(d.milestones.filter((m) => m.receipt).length === 2, 'two receipt invoices');
// cancel: void the unreleased $12
d = await j('POST', `/api/deals/${deal.id}/cancel`, { reason: 'client cancelled before the bug-free week' });
assert(d.status === 'CANCELLED' && d.money.voided_cents === 1200 && d.money.captured_cents === 4800 && d.money.remaining_cents === 0, 'void remainder: ' + JSON.stringify(d.money));
ok('cancelled: remainder voided, captured stays', JSON.stringify(d.money));
const wh = await j('POST', '/api/webhooks/simulate', { deal_id: deal.id, type: 'PAYMENT.CAPTURE.COMPLETED' }); ok('webhook simulated', JSON.stringify(wh));
const led = await j('GET', `/api/deals/${deal.id}/ledger`);
console.log('\nLEDGER'); for (const x of led.rows) console.log(String(x.id).padStart(3), x.kind.padEnd(16), String(x.status || '').padEnd(10), String(x.amount_cents ?? '').padStart(6), 'bal', String(x.balance_cents).padStart(6), x.debug_id || '-', '|', (x.call || '').slice(0, 52));
assert(led.rows.some((x) => x.kind === 'capture' && !x.mock && x.debug_id), 'ledger has real PayPal debug ids');
console.log('\nE2E LIVE PASSED');
