// Live QA of the other two endings on the real sandbox: (1) COMPLETE: every milestone released incl. the timer one,
// final_capture closes the authorization; (2) EXPIRE: the deadline passes and PayPal voids the held money.
import { approve } from './approve.mjs';
const B = process.env.BASE || 'http://127.0.0.1:3100';
const j = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const x = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${m} ${p} -> ${r.status} ${x.error || ''}`); return x; };
const ok = (n, v) => console.log('✔', n, v ?? '');
const must = (c, m) => { if (!c) { console.error('✖', m); process.exitCode = 1; throw new Error(m); } };

async function fundedDeal(totalCents = 3000) {
  const demo = (await j('GET', '/api/demo/contract')).contract;
  demo.hold.amount_cents = totalCents; const a = [0.3, 0.5].map((p) => Math.floor(totalCents * p)); demo.milestones[0].amount_cents = a[0]; demo.milestones[1].amount_cents = a[1]; demo.milestones[2].amount_cents = totalCents - a[0] - a[1];
  const d = await j('POST', '/api/deals', { contract: demo });
  const f = await j('POST', `/api/deals/${d.id}/fund`); await approve(f.approve_url);
  await new Promise((r) => setTimeout(r, 1500));
  let x = await j('GET', `/api/deals/${d.id}`); if (x.funding.status !== 'authorized') x = await j('POST', `/api/deals/${d.id}/fund/complete`, { order_id: f.order_id });
  must(x.funding.status === 'authorized', 'funded'); return x;
}

// ---- 1. complete ----
let d = await fundedDeal(3000); ok('complete path: funded', d.id);
let r = await j('POST', `/api/deals/${d.id}/milestones/m1/submit`, { url: B + '/demo/staging' }); must(r.result.outcome === 'released', 'm1 released by URL oracle');
r = await j('POST', `/api/deals/${d.id}/milestones/m2/submit`, { text: 'ok' }); if (r.result.outcome !== 'released') await j('POST', `/api/deals/${d.id}/milestones/m2/review`, { decision: 'release' });
d = await j('POST', `/api/deals/${d.id}/clock`, { advance_days: 3 }); must(d.milestones[2].status === 'PENDING', 'timer not yet');
d = await j('POST', `/api/deals/${d.id}/clock`, { advance_days: 5 });
must(d.status === 'COMPLETED' && d.money.captured_cents === 3000 && d.money.remaining_cents === 0, 'completed: ' + JSON.stringify(d.money));
ok('COMPLETED: all captured, nothing left held', JSON.stringify(d.money));
let led = (await j('GET', `/api/deals/${d.id}/ledger`)).rows;
ok('ledger kinds', [...new Set(led.map((x) => x.kind))].join(','));
must(led.filter((x) => x.kind === 'capture').length === 3 && led.filter((x) => x.kind === 'invoice.payment').length === 3, '3 captures + 3 receipts');
console.log('   reauthorize rows:', led.filter((x) => x.kind === 'reauthorize').map((x) => `${x.status}: ${x.note.slice(0, 90)}`).join(' | ') || 'none');

// ---- 2. expire ----
d = await fundedDeal(2000); ok('expire path: funded', d.id);
r = await j('POST', `/api/deals/${d.id}/milestones/m1/submit`, { url: B + '/demo/staging' }); must(r.result.outcome === 'released', 'm1 released');
d = await j('POST', `/api/deals/${d.id}/clock`, { advance_days: 18 });
must(d.status === 'EXPIRED' && d.money.captured_cents === 600 && d.money.voided_cents === 1400 && d.money.remaining_cents === 0, 'expired: ' + JSON.stringify(d.money));
ok('EXPIRED: remainder voided at PayPal', JSON.stringify(d.money));
led = (await j('GET', `/api/deals/${d.id}/ledger`)).rows; must(led.some((x) => x.kind === 'void' && x.debug_id), 'void row has PayPal debug id');
console.log('\nE2E LIVE PATHS PASSED');
