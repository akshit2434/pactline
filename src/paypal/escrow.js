// Escrow adapter: the only thing the engine knows about PayPal. Two implementations with one interface:
//   LiveEscrow  -> real PayPal sandbox (Orders v2 AUTHORIZE, Payments v2 capture/void/reauthorize/refund, Invoicing v2 receipts)
//   MockEscrow  -> in-memory, enforces the same rules PayPal does (cap on captures, no double void, ...)
// Every method returns { ...result, meta: { call, http_status, debug_id, mock } } so the ledger can show real call evidence.
import crypto from 'node:crypto';
import { LivePayPal } from './live.js';

const live = (pp, call, ...args) => pp[call](...args);

export class LiveEscrow {
  constructor(pp, invoicePP) { this.pp = pp; this.ipp = invoicePP || pp; this.mock = false; this.name = 'live'; }
  meta(call) { const m = this.pp.lastMeta || {}; return { call: call || m.call, http_status: m.httpStatus, debug_id: m.debugId, mock: false }; }
  async createHold(a) { const r = await this.pp.createHoldOrder(a); return { ...r, meta: this.meta('POST /v2/checkout/orders (intent=AUTHORIZE)') }; }
  async authorize(orderId) { const r = await this.pp.authorizeOrder(orderId); return { ...r, meta: this.meta('POST /v2/checkout/orders/{id}/authorize') }; }
  async capture(authId, a) { const r = await this.pp.captureAuthorization(authId, a); return { ...r, meta: this.meta('POST /v2/payments/authorizations/{id}/capture') }; }
  async void(authId) { const r = await this.pp.voidAuthorization(authId); return { ...r, meta: this.meta('POST /v2/payments/authorizations/{id}/void') }; }
  async reauthorize(authId, a) { const r = await this.pp.reauthorizeAuthorization(authId, a); return { ...r, meta: this.meta('POST /v2/payments/authorizations/{id}/reauthorize') }; }
  async refund(captureId, a) { const r = await this.pp.refundCapture(captureId, a); return { ...r, meta: this.meta('POST /v2/payments/captures/{id}/refund') }; }
  async getAuthorization(id) { return this.pp.getAuthorization(id); }
  // receipts via Invoicing v2
  async receipt({ client, title, amountCents, currency, note, paidNote }) {
    const due = new Date().toISOString().slice(0, 10);
    const inv = await this.ipp.createInvoice({ client: { name: client.name, email: client.email || 'client@example.com' }, items: [{ description: title, quantity: 1, unitPrice: amountCents / 100 }], dueDate: due, note });
    const m1 = { call: 'POST /v2/invoicing/invoices', http_status: 201, debug_id: this.ipp.lastMeta?.debugId, mock: false };
    await this.ipp.sendInvoice(inv.id, { toRecipient: false });
    const paid = await this.ipp.recordPayment(inv.id, { amount: amountCents / 100, method: 'PAYPAL', note: paidNote });
    return { invoiceId: paid.id, number: paid.number, status: paid.status, meta: { ...m1, mock: false } };
  }
}

export class MockEscrow {
  constructor() { this.mock = true; this.name = 'mock'; this.orders = new Map(); this.auths = new Map(); this.invoices = 0; }
  meta(call) { return { call, http_status: 200, debug_id: crypto.randomBytes(6).toString('hex'), mock: true }; }
  id(prefix) { return prefix + crypto.randomBytes(8).toString('hex').toUpperCase().slice(0, 14); }
  async createHold({ dealId, amountCents, currency, returnUrl }) {
    const orderId = this.id('MOCKORD');
    this.orders.set(orderId, { dealId, amountCents, currency, approved: false });
    const sep = returnUrl.includes('?') ? '&' : '?';
    return { orderId, status: 'PAYER_ACTION_REQUIRED', approveUrl: `/mock/approve?token=${orderId}&return=${encodeURIComponent(returnUrl + sep + 'token=' + orderId)}`, meta: this.meta('POST /v2/checkout/orders (intent=AUTHORIZE)') };
  }
  async authorize(orderId) {
    const o = this.orders.get(orderId); if (!o) throw new Error('Order not found');
    const authorizationId = this.id('MOCKAUTH');
    this.auths.set(authorizationId, { amountCents: o.amountCents, captured: 0, status: 'CREATED', reauth: 0 });
    return { orderId, authorizationId, status: 'CREATED', amountCents: o.amountCents, currency: o.currency, expiresAt: new Date(Date.now() + 29 * 864e5).toISOString(), payer: 'sandbox-buyer@personal.example.com', meta: this.meta('POST /v2/checkout/orders/{id}/authorize') };
  }
  async capture(authId, { amountCents, finalCapture }) {
    const a = this.auths.get(authId); if (!a) throw new Error('Authorization not found');
    if (a.status === 'VOIDED') throw new Error('AUTHORIZATION_VOIDED');
    if (a.captured + amountCents > a.amountCents) throw new Error('AUTHORIZATION_AMOUNT_EXCEEDED: capture would exceed the authorized amount');
    a.captured += amountCents; if (finalCapture || a.captured === a.amountCents) a.status = 'CAPTURED';
    return { captureId: this.id('MOCKCAP'), status: 'COMPLETED', amountCents, finalCapture: !!finalCapture, meta: this.meta('POST /v2/payments/authorizations/{id}/capture') };
  }
  async void(authId) {
    const a = this.auths.get(authId); if (!a) throw new Error('Authorization not found');
    if (a.status === 'VOIDED') throw new Error('AUTHORIZATION_ALREADY_VOIDED');
    a.status = 'VOIDED'; return { status: 'VOIDED', meta: this.meta('POST /v2/payments/authorizations/{id}/void') };
  }
  async reauthorize(authId) { const a = this.auths.get(authId); if (!a) throw new Error('Authorization not found'); a.reauth += 1; return { authorizationId: authId, status: 'CREATED', meta: this.meta('POST /v2/payments/authorizations/{id}/reauthorize') }; }
  async refund(captureId) { return { refundId: this.id('MOCKREF'), status: 'COMPLETED', meta: this.meta('POST /v2/payments/captures/{id}/refund') }; }
  async receipt({ amountCents }) { this.invoices += 1; return { invoiceId: this.id('INV2-MOCK-'), number: String(100 + this.invoices).padStart(4, '0'), status: 'MARKED_AS_PAID', meta: this.meta('POST /v2/invoicing/invoices') }; }
}
