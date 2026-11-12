import { h, ic, money, fmtTime, fmtDate } from '../util.js';
import { api } from '../api.js';
import { state, nav } from '../state.js';

const TITLE = {
  'order.create': 'Order created', 'order.authorize': 'Hold authorized', capture: 'Released to freelancer', void: 'Remainder voided', reauthorize: 'Hold extended',
  refund: 'Refunded', 'invoice.create': 'Receipt drafted', 'invoice.send': 'Receipt sent', 'invoice.payment': 'Receipt marked paid', webhook: 'Webhook received',
  oracle: 'Proof checked', judge: 'AI verdict', state: 'State change',
};
const GROUP = { webhook: 'webhook', oracle: 'ai', judge: 'ai', state: 'state' };
const grp = (k) => GROUP[k] || 'paypal';
const kClass = (k) => (k === 'capture' ? 'k-capture' : k.startsWith('invoice') ? 'k-invoice' : k === 'void' || k === 'refund' ? 'k-void' : k === 'webhook' ? 'k-webhook' : grp(k) === 'ai' ? 'k-ai' : '');

function rawFor(r, deal) {
  if (r.request) return { label: 'Request', req: r.request, res: r.response };
  const cur = deal ? deal.contract.currency : 'USD';
  const val = (c) => ((c || 0) / 100).toFixed(2);
  const amount = { currency_code: cur, value: val(r.amount_cents) };
  const headers = { 'Content-Type': 'application/json', 'PayPal-Request-Id': '<idempotency-key>', Authorization: 'Bearer <redacted>' };
  let body = null;
  switch (r.kind) {
    case 'order.create': body = { intent: 'AUTHORIZE', purchase_units: [{ reference_id: r.deal_id, amount }] }; break;
    case 'order.authorize': body = {}; break;
    case 'capture': body = { amount, final_capture: false, invoice_id: r.deal_id + '-' + r.milestone_id }; break;
    case 'void': body = null; break;
    case 'invoice.create': body = { detail: { currency_code: cur, note: r.note }, amount }; break;
    default: body = null;
  }
  const line = r.call;
  const isHttp = /^(GET|POST|PUT|PATCH|DELETE)\s/.test(line);
  return { label: 'Request shape (rebuilt from this record)', line: isHttp ? line : null, headers: isHttp ? headers : null, body: isHttp ? body : null };
}

function hl(json) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return esc(json).replace(/("(?:\\.|[^"\\])*")(\s*:)?|\b(-?\d+\.?\d*)\b/g, (m, str, colon, num) => (str ? (colon ? `<span class="k">${str}</span>${colon}` : `<span class="s">${str}</span>`) : `<span class="n">${num}</span>`));
}

export function mount(root, { id }) {
  let rows = [], deal = null, dead = false, filter = 'all', view = 'timeline';
  const open = new Set();
  const content = h('div'), filters = h('div', { class: 'filters', role: 'group', 'aria-label': 'Filter' }), toggle = h('div', { class: 'seg', role: 'group', 'aria-label': 'View' });
  const titleEl = h('h1', null, 'Audit trail'), sub = h('p', { class: 'lede' }, 'Every call to PayPal, in order.');
  root.append(h('section', { class: 'page' },
    h('div', { class: 'ledger-head enter' }, h('div', { style: { display: 'grid', gap: '8px' } }, h('span', { class: 'kicker' }, 'Ledger'), titleEl, sub), h('div', { style: { display: 'grid', gap: '10px', justifyItems: 'end' } }, toggle, filters)),
    content));

  const F = [['all', 'All'], ['paypal', 'PayPal'], ['webhook', 'Webhooks'], ['ai', 'AI checks']];
  function paintControls() {
    filters.replaceChildren(...F.map(([k, l]) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(filter === k), onclick: () => { filter = k; paint(); } }, l)));
    toggle.replaceChildren(
      h('button', { type: 'button', 'aria-pressed': String(view === 'timeline'), onclick: () => { view = 'timeline'; paint(); } }, 'Timeline'),
      h('button', { type: 'button', 'aria-pressed': String(view === 'table'), onclick: () => { view = 'table'; paint(); } }, 'Table'));
  }

  function chart() {
    const pts = rows.filter((r) => ['order.authorize', 'capture', 'void', 'refund', 'reauthorize'].includes(r.kind));
    if (pts.length < 2) return null;
    const W = 600, H = 110, pad = 6, max = Math.max(...pts.map((p) => Math.max(p.balance_cents, p.held_cents || 0)), 1);
    const x = (i) => pad + (i / (pts.length - 1)) * (W - pad * 2 - 36), y = (v) => H - 18 - (v / max) * (H - 36);
    let d = `M ${x(0)} ${y(pts[0].balance_cents)}`;
    pts.slice(1).forEach((p, i) => { d += ` H ${x(i + 1)} V ${y(p.balance_cents)}`; });
    const last = pts[pts.length - 1];
    const ns = 'http://www.w3.org/2000/svg';
    const wrap = h('div', { class: 'card bal enter' },
      h('div', { class: 'row' }, h('span', { class: 'kicker' }, 'PayPal still holds'), h('b', { style: { fontSize: '22px', fontVariantNumeric: 'tabular-nums' } }, money(last.balance_cents, { compact: true }))));
    const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `Balance held by PayPal over time, ending at ${money(last.balance_cents)}`);
    svg.innerHTML = `<line class="grid-l" x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}"/><line class="grid-l" x1="0" x2="${W}" y1="${y(max)}" y2="${y(max)}" stroke-dasharray="3 4"/>
      <path class="area" d="${d} V ${y(0)} H ${x(0)} Z"/><path class="line" d="${d}"/>
      ${pts.map((p, i) => `<circle class="pt" cx="${x(i)}" cy="${y(p.balance_cents)}" r="4"/>`).join('')}
      <text x="${W - 4}" y="${y(last.balance_cents) - 10}" text-anchor="end">${money(last.balance_cents, { compact: true })}</text>
      <text x="0" y="${y(max) - 6}">${money(max, { compact: true })} held</text>`;
    wrap.append(svg);
    return wrap;
  }

  function paint() {
    paintControls();
    const list = rows.filter((r) => filter === 'all' || grp(r.kind) === filter);
    content.replaceChildren();
    if (!rows.length) { content.append(h('div', { class: 'empty-state' }, h('h2', null, 'No calls yet'), h('p', null, 'Hold funds to see the first PayPal call land here.'), h('a', { class: 'btn primary', href: '#/' }, 'Start a deal'))); return; }
    const ch = chart(); if (ch) content.append(ch);
    if (view === 'table') {
      content.append(h('div', { class: 'card gridwrap' }, h('table', { class: 'grid' },
        h('thead', null, h('tr', null, ['Time', 'Call', 'PayPal ID', 'Debug ID', 'Status', 'Amount', 'Held', 'Captured', 'Balance'].map((t, i) => h('th', { class: i > 4 ? 'n' : '' }, t)))),
        h('tbody', null, list.map((r) => h('tr', null,
          h('td', { class: 'mono' }, fmtTime(r.ts)), h('td', { class: 'mono' }, r.call), h('td', { class: 'mono' }, r.paypal_id || '–'), h('td', { class: 'mono' }, r.debug_id || '–'),
          h('td', null, h('span', { class: 'sc ' + (r.http_status < 300 ? 'ok' : '') }, r.http_status || '', ' ', r.status)),
          h('td', { class: 'n' }, r.amount_cents ? money(r.amount_cents) : '–'), h('td', { class: 'n' }, money(r.held_cents)), h('td', { class: 'n' }, money(r.captured_cents)), h('td', { class: 'n' }, money(r.balance_cents))))))));
      return;
    }
    content.append(h('ol', { class: 'tl' }, list.map((r) => entry(r))));
  }

  function entry(r) {
    const isOpen = open.has(r.id);
    const btn = h('button', { type: 'button', 'aria-expanded': String(isOpen), onclick: () => { isOpen ? open.delete(r.id) : open.add(r.id); paint(); } },
      h('span', null,
        h('span', { class: 'ttl' }, TITLE[r.kind] || r.kind, r.milestone_id ? h('span', { class: 'sc' }, r.milestone_id) : null, h('span', { class: 'sc ' + (r.http_status && r.http_status < 300 ? 'ok' : '') }, (r.http_status || '') + ' ' + (r.status || ''))),
        h('span', { class: 'call', style: { display: 'block' } }, r.call), r.note ? h('span', { style: { display: 'block', color: 'var(--ink-2)', fontSize: '14px', marginTop: '2px' } }, r.note) : null),
      h('span', { class: 'amt' }, r.amount_cents ? money(r.amount_cents) : '', h('small', null, `PayPal holds ${money(r.balance_cents, { compact: true })}`)));
    const item = h('div', { class: 'item' + (isOpen ? ' open' : '') }, btn);
    if (isOpen) {
      const raw = rawFor(r, deal);
      const req = raw.line ? [raw.line, ...Object.entries(raw.headers).map(([k, v]) => `${k}: ${v}`), '', raw.body ? JSON.stringify(raw.body, null, 2) : ''].join('\n') : (raw.req ? JSON.stringify(raw.req, null, 2) : r.call);
      const rec = JSON.stringify(r, null, 2);
      item.append(h('div', { class: 'raw' },
        h('h4', null, raw.label), h('pre', { html: hl(req) }),
        raw.res ? [h('h4', null, 'Response'), h('pre', { html: hl(JSON.stringify(raw.res, null, 2)) })] : null,
        h('h4', null, 'Ledger record'), h('pre', { html: hl(rec) })));
    }
    return h('li', { class: kClass(r.kind) }, h('span', { class: 'when' }, fmtTime(r.ts)), h('span', { class: 'dotcol' }, h('i')), item);
  }

  async function load() {
    try {
      let did = id || (state.deal && state.deal.id);
      if (!did) { const ds = await api.listDeals(); did = ds[0] && ds[0].id; }
      if (did) { deal = await api.getDeal(did); titleEl.textContent = deal.contract.title; sub.textContent = `Every PayPal call for this deal, in order. ${deal.id}`; }
      rows = did ? await api.ledger(did) : [];
      if (dead) return;
      paint();
    } catch (e) { content.replaceChildren(h('div', { class: 'err' }, e.message)); }
  }
  paintControls();
  content.append(h('div', { class: 'skel', style: { height: '320px', borderRadius: '24px' } }));
  load();
  return { onEvent(e) { if (e.type === 'ledger.row' && (!deal || e.deal_id === deal.id)) load(); }, destroy() { dead = true; } };
}
