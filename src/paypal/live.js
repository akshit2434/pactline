// Live PayPal Sandbox adapter: Invoicing v2 + Orders v2. Returns normalised invoices
// (see normalise()) so nothing above this layer depends on PayPal's JSON shape.
import crypto from 'node:crypto';
import { addDays, today, money } from '../finance.js';

export class PayPalError extends Error {
  constructor(message, { status, debugId, details, name } = {}) {
    super(message);
    this.name = 'PayPalError';
    this.status = status; this.debugId = debugId; this.details = details; this.code = name;
  }
}

export function normalise(p, currencyFallback) {
  const total = Number(p.amount?.value ?? 0);
  const paidFromPayments = Number(p.payments?.paid_amount?.value ?? 0);
  const status = p.status || 'DRAFT';
  let due = p.due_amount?.value !== undefined ? Number(p.due_amount.value) : total - paidFromPayments;
  if (status === 'PAID' || status === 'MARKED_AS_PAID') due = 0;
  const recipient = p.primary_recipients?.[0]?.billing_info || {};
  const term = p.detail?.payment_term || {};
  return {
    id: p.id,
    number: p.detail?.invoice_number,
    status,
    client: {
      name: recipient.business_name || recipient.name?.business_name || [recipient.name?.given_name, recipient.name?.surname].filter(Boolean).join(' ') || recipient.email_address || 'Unknown',
      email: recipient.email_address,
    },
    currency: p.amount?.currency_code || p.detail?.currency_code || currencyFallback,
    total, due, paid: Math.max(0, Math.round((total - due) * 100) / 100),
    issued: p.detail?.invoice_date,
    dueDate: term.due_date || (p.detail?.invoice_date && term.term_type?.startsWith('NET_') ? addDays(p.detail.invoice_date, Number(term.term_type.slice(4))) : undefined),
    note: p.detail?.note,
    items: (p.items || []).map((i) => ({ description: i.name, quantity: Number(i.quantity), unitPrice: Number(i.unit_amount?.value), taxPercent: Number(i.tax?.percent ?? 0) })),
    payerLink: p.detail?.metadata?.recipient_view_url,
    createdAt: p.detail?.metadata?.create_time,
  };
}

export class LivePayPal {
  constructor({ clientId, clientSecret, baseUrl, currency }) {
    this.clientId = clientId; this.clientSecret = clientSecret; this.baseUrl = baseUrl;
    this.currency = currency;
    this.mode = 'live';
    this.token = null; this.tokenExp = 0;
  }

  async accessToken() {
    if (this.token && Date.now() < this.tokenExp - 30000) return this.token;
    const res = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new PayPalError(`PayPal auth failed: ${j.error_description || res.status}`, { status: res.status });
    this.token = j.access_token; this.tokenExp = Date.now() + j.expires_in * 1000;
    return this.token;
  }

  async api(method, path, body, { idempotent = true, headers: extra = {} } = {}) {
    const headers = { ...extra, Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json', Accept: 'application/json' };
    if (method === 'POST' && idempotent) headers['PayPal-Request-Id'] = crypto.randomUUID();
    let res;
    for (let attempt = 0; ; attempt++) {
      res = await fetch(`${this.baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
      if ((res.status >= 500 || res.status === 429) && attempt < 3) { await new Promise((r) => setTimeout(r, 700 * (attempt + 1))); continue; } // same PayPal-Request-Id: safe to retry
      break;
    }
    const text = await res.text();
    this.lastMeta = { call: `${method} ${path.split('?')[0]}`, httpStatus: res.status, debugId: res.headers.get('paypal-debug-id') };
    let j = {};
    try { j = text ? JSON.parse(text) : {}; } catch { j = { raw: text }; }
    if (!res.ok) {
      const detail = j.details?.map((d) => `${d.issue || ''}${d.field ? ` (${d.field})` : ''}${d.description ? `: ${d.description}` : ''}`).join('; ');
      throw new PayPalError(`PayPal ${method} ${path} -> ${res.status} ${j.name || ''} ${j.message || ''} ${detail || ''}`.trim(), { status: res.status, debugId: j.debug_id, details: j.details, name: j.name });
    }
    return j;
  }

  /** Create a draft with an explicit currency; used by the startup currency probe. */
  async createDraft({ client, items, dueDate, note, currency = this.currency, invoiceDate = today() }) {
    const next = await this.api('POST', '/v2/invoicing/generate-next-invoice-number', {}, { idempotent: false });
    const body = {
      detail: {
        invoice_number: next.invoice_number,
        invoice_date: invoiceDate,
        currency_code: currency,
        note: note || undefined,
        payment_term: { term_type: 'DUE_ON_DATE_SPECIFIED', due_date: dueDate },
      },
      primary_recipients: [{ billing_info: { business_name: client.name, email_address: client.email } }],
      items: items.map((i) => ({
        name: i.description,
        quantity: String(i.quantity),
        unit_amount: { currency_code: currency, value: money(i.unitPrice) },
        ...(i.taxPercent ? { tax: { name: i.taxName || 'Tax', percent: String(i.taxPercent) } } : {}),
        unit_of_measure: 'QUANTITY',
      })),
    };
    const created = await this.api('POST', '/v2/invoicing/invoices', body);
    const id = created.href.split('/').pop();
    return this.getInvoice(id);
  }

  async createInvoice(args) { return this.createDraft(args); }

  async getInvoice(id) {
    return normalise(await this.api('GET', `/v2/invoicing/invoices/${id}`), this.currency);
  }

  async deleteInvoice(id) { await this.api('DELETE', `/v2/invoicing/invoices/${id}`); }

  async listInvoices() {
    const out = [];
    for (let page = 1; page <= 5; page++) {
      const r = await this.api('GET', `/v2/invoicing/invoices?page=${page}&page_size=100&total_required=true&fields=all`);
      for (const p of r.items || []) out.push(normalise(p, this.currency));
      if (!r.total_pages || page >= r.total_pages) break;
    }
    return out;
  }

  async sendInvoice(id, { toRecipient = true } = {}) {
    await this.api('POST', `/v2/invoicing/invoices/${id}/send`, { send_to_recipient: toRecipient, send_to_invoicer: false });
    return this.getInvoice(id);
  }

  async remindInvoice(id, { subject, message }) {
    await this.api('POST', `/v2/invoicing/invoices/${id}/remind`, { subject, note: message, send_to_recipient: true, send_to_invoicer: false });
    return { ok: true };
  }

  async recordPayment(id, { amount, method = 'BANK_TRANSFER', note, currency }) {
    const inv = await this.getInvoice(id);
    const value = amount ?? inv.due;
    await this.api('POST', `/v2/invoicing/invoices/${id}/payments`, {
      method, payment_date: today(), note,
      amount: { currency_code: currency || inv.currency, value: money(value) },
    });
    return this.getInvoice(id);
  }

  // ---- Orders v2 (checkout) ----
  async createOrder({ invoice, returnUrl, cancelUrl }) {
    const order = await this.api('POST', '/v2/checkout/orders', {
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: invoice.id,
        description: `Invoice ${invoice.number} to ${invoice.client.name}`.slice(0, 127),
        custom_id: invoice.id,
        amount: { currency_code: invoice.currency, value: money(invoice.due) },
      }],
      payment_source: { paypal: { experience_context: { return_url: returnUrl, cancel_url: cancelUrl, user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING', brand_name: 'InvoicePilot' } } },
    });
    const approve = (order.links || []).find((l) => l.rel === 'payer-action' || l.rel === 'approve');
    return { orderId: order.id, status: order.status, approveUrl: approve?.href };
  }

  async captureOrder(orderId) {
    const cap = await this.api('POST', `/v2/checkout/orders/${orderId}/capture`, undefined);
    const unit = cap.purchase_units?.[0];
    const c = unit?.payments?.captures?.[0];
    return { orderId: cap.id, status: cap.status, captureId: c?.id, captureStatus: c?.status, amount: Number(c?.amount?.value ?? 0), currency: c?.amount?.currency_code, invoiceId: unit?.reference_id || unit?.custom_id, payer: cap.payer?.email_address };
  }

  // ---- Escrow primitives: Orders v2 AUTHORIZE + Payments v2 authorizations ----
  async createHoldOrder({ dealId, title, amountCents, currency, returnUrl, cancelUrl }) {
    const order = await this.api('POST', '/v2/checkout/orders', {
      intent: 'AUTHORIZE',
      purchase_units: [{ reference_id: dealId, custom_id: dealId, description: `Pactline hold: ${title}`.slice(0, 127), amount: { currency_code: currency, value: money(amountCents / 100) } }],
      payment_source: { paypal: { experience_context: { return_url: returnUrl, cancel_url: cancelUrl, user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING', brand_name: 'Pactline' } } },
    });
    const approve = (order.links || []).find((l) => l.rel === 'payer-action' || l.rel === 'approve');
    return { orderId: order.id, status: order.status, approveUrl: approve?.href };
  }

  async getOrder(orderId) { return this.api('GET', `/v2/checkout/orders/${orderId}`); }

  async authorizeOrder(orderId) {
    const r = await this.api('POST', `/v2/checkout/orders/${orderId}/authorize`, undefined);
    const a = r.purchase_units?.[0]?.payments?.authorizations?.[0];
    if (!a) throw new PayPalError('Order authorize returned no authorization', { details: r });
    return { orderId: r.id, authorizationId: a.id, status: a.status, amountCents: Math.round(Number(a.amount.value) * 100), currency: a.amount.currency_code, expiresAt: a.expiration_time, payer: r.payer?.email_address };
  }

  async getAuthorization(id) { return this.api('GET', `/v2/payments/authorizations/${id}`); }

  async captureAuthorization(id, { amountCents, currency, finalCapture = false, invoiceId, note }) {
    const r = await this.api('POST', `/v2/payments/authorizations/${id}/capture`, {
      amount: { currency_code: currency, value: money(amountCents / 100) }, final_capture: finalCapture,
      ...(invoiceId ? { invoice_id: invoiceId } : {}), ...(note ? { note_to_payer: note.slice(0, 255) } : {}),
    }, { headers: { Prefer: 'return=representation' } });
    return { captureId: r.id, status: r.status, amountCents: Math.round(Number(r.amount?.value ?? 0) * 100), finalCapture: r.final_capture };
  }

  async voidAuthorization(id) {
    const r = await this.api('POST', `/v2/payments/authorizations/${id}/void`, undefined);
    return { status: 'VOIDED', raw: r };
  }

  async reauthorizeAuthorization(id, { amountCents, currency }) {
    const r = await this.api('POST', `/v2/payments/authorizations/${id}/reauthorize`, { amount: { currency_code: currency, value: money(amountCents / 100) } });
    return { authorizationId: r.id, status: r.status };
  }

  async refundCapture(captureId, { amountCents, currency, note }) {
    const r = await this.api('POST', `/v2/payments/captures/${captureId}/refund`, { amount: { currency_code: currency, value: money(amountCents / 100) }, ...(note ? { note_to_payer: note.slice(0, 255) } : {}) });
    return { refundId: r.id, status: r.status };
  }

  async verifyWebhook({ headers, body, webhookId }) {
    const r = await this.api('POST', '/v1/notifications/verify-webhook-signature', {
      auth_algo: headers['paypal-auth-algo'], cert_url: headers['paypal-cert-url'], transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'], transmission_time: headers['paypal-transmission-time'], webhook_id: webhookId, webhook_event: body,
    }, { idempotent: false });
    return r.verification_status === 'SUCCESS';
  }
}
