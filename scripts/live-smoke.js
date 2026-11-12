// Live sandbox smoke test of the escrow primitives: AUTHORIZE order -> buyer approval -> authorize ->
// capture 30% -> capture 50% -> void the rest. Needs sandbox keys + buyer credentials in env.
// Usage: node scripts/live-smoke.js
import { config } from '../src/config.js';
import { LivePayPal } from '../src/paypal/live.js';
import { approve } from './approve.mjs';

const pp = new LivePayPal({ ...config.paypal, currency: 'USD' });
const step = (n, v) => console.log(`✔ ${n}`, v === undefined ? '' : JSON.stringify(v));
const order = await pp.createHoldOrder({ dealId: 'smoke-' + Date.now(), title: 'smoke test', amountCents: 10000, currency: 'USD', returnUrl: 'http://127.0.0.1:3100/ok', cancelUrl: 'http://127.0.0.1:3100/no' });
step('order created', { id: order.orderId, status: order.status });
const final = await approve(order.approveUrl, { log: (...a) => console.log('  [buyer]', ...a) });
step('buyer approved', final.slice(0, 80));
const auth = await pp.authorizeOrder(order.orderId);
step('authorized', auth);
const c1 = await pp.captureAuthorization(auth.authorizationId, { amountCents: 3000, currency: 'USD', finalCapture: false, invoiceId: 'smoke-a-' + Date.now() });
step('capture 30%', c1);
const c2 = await pp.captureAuthorization(auth.authorizationId, { amountCents: 5000, currency: 'USD', finalCapture: false, invoiceId: 'smoke-b-' + Date.now() });
step('capture 50%', c2);
let over; try { await pp.captureAuthorization(auth.authorizationId, { amountCents: 9000, currency: 'USD', invoiceId: 'smoke-c-' + Date.now() }); over = 'NOT REJECTED'; } catch (e) { over = e.message.slice(0, 160); }
step('over-capture rejected?', over);
const v = await pp.voidAuthorization(auth.authorizationId).catch((e) => ({ error: e.message.slice(0, 200) }));
step('void remainder', v.error ? v : v.status);
const after = await pp.getAuthorization(auth.authorizationId);
step('authorization after', { status: after.status });
const refund = await pp.refundCapture(c1.captureId, { amountCents: 3000, currency: 'USD', note: 'smoke refund' }).catch((e) => ({ error: e.message.slice(0, 200) }));
step('refund capture 1', refund);
