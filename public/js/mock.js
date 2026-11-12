// In-browser Pactline engine. Same surface as the real API (see ../../API.md) so the UI never knows the difference.
// Used when the backend is unreachable and always in Demo mode (a PayPal popup cannot be auto-played).
import { parseDeal, toContract, DEMO_TEXT } from './parse.js';

const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
const rid = (n = 10) => Array.from({ length: n }, () => A[(Math.random() * A.length) | 0]).join('');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (o) => JSON.parse(JSON.stringify(o));

export function createMock({ speed = 1 } = {}) {
  const deals = new Map();
  const ledger = [];
  const listeners = new Set();
  let evId = 0, rowId = 0;
  const ms = (n) => Math.round(n / speed);
  const baseNow = Date.now();

  const emit = (type, deal, milestone_id, summary, data) => {
    const e = { id: ++evId, ts: new Date().toISOString(), type, deal_id: deal && deal.id, milestone_id, summary, data };
    listeners.forEach((f) => f(e));
  };

  function verify(contract) {
    const errors = [], warnings = [];
    const sum = contract.milestones.reduce((a, m) => a + m.share_pct, 0);
    if (Math.abs(sum - 100) > 0.001) errors.push({ code: 'SHARES_SUM', message: `Shares add up to ${sum}%, not 100%`, path: 'milestones' });
    if (!contract.milestones.length) errors.push({ code: 'NO_ORACLE', message: 'No milestones found', path: 'milestones' });
    const n = contract.milestones.length;
    const paths = Math.round(214 * Math.pow(2.4, n - 3));
    return {
      ok: !errors.length, paths: Math.max(paths, 6), states: Math.round(57 * Math.pow(2, n - 3)) || 8,
      invariants: [
        { name: 'captured ≤ held', ok: !errors.length },
        { name: 'no milestone released twice', ok: true },
        { name: 'captured + voided = held at every end state', ok: !errors.length },
        { name: 'every path terminates', ok: true },
      ],
      errors, warnings,
    };
  }

  async function compile(text, { typo = false } = {}) {
    await sleep(ms(typo ? 900 : 450));
    const p = parseDeal(text);
    if (!p || !p.milestones.length) {
      const e = new Error('Could not read a price and milestones from that yet.'); e.code = 'PARSE'; throw e;
    }
    const attempts = [];
    const sum = p.milestones.reduce((a, m) => a + m.share_pct, 0);
    if (typo || Math.abs(sum - 100) > 0.001) {
      const bad = typo ? [30, 50, 30] : p.milestones.map((m) => m.share_pct);
      const total = bad.reduce((a, b) => a + b, 0);
      attempts.push({ n: 1, shares: bad, errors: [{ code: 'SHARES_SUM', message: `Shares add up to ${total}%, not 100%`, path: 'milestones' }], repaired: true });
      // repair: normalise the last milestone so the shares reach 100
      const head = p.milestones.slice(0, -1).reduce((a, m) => a + m.share_pct, 0);
      p.milestones[p.milestones.length - 1].share_pct = Math.max(1, 100 - head);
      if (typo && p.milestones.length === 3) { p.milestones[0].share_pct = 30; p.milestones[1].share_pct = 50; p.milestones[2].share_pct = 20; }
    }
    const contract = toContract(p);
    return { source: 'cache', contract, verification: verify(contract), attempts };
  }

  function row(deal, o) {
    const m = deal.money;
    const r = {
      id: ++rowId, ts: new Date().toISOString(), deal_id: deal.id, milestone_id: null, kind: 'state', call: '', paypal_id: null,
      debug_id: rid(13).toLowerCase(), http_status: 200, status: 'OK', amount_cents: 0,
      held_cents: m.held_cents, captured_cents: m.captured_cents, voided_cents: m.voided_cents, balance_cents: m.remaining_cents,
      note: '', mock: true, ...o,
    };
    ledger.push(r);
    emit('ledger.row', deal, r.milestone_id, r.note || r.call);
    return r;
  }
  const recompute = (d) => {
    d.money.remaining_cents = d.money.held_cents - d.money.captured_cents - d.money.voided_cents;
    d.version++;
  };
  const get = (id) => { const d = deals.get(id); if (!d) { const e = new Error('Deal not found'); e.code = 'NOT_FOUND'; throw e; } return d; };
  const view = (d) => { d.clock.now = new Date(baseNow + d.clock.day * 864e5).toISOString(); return clone(d); };

  async function createDeal(contract) {
    const v = verify(contract);
    if (!v.ok) { const e = new Error('Contract failed verification'); e.code = 'VERIFY_FAILED'; e.verification = v; throw e; }
    await sleep(ms(300));
    const d = {
      id: 'd_' + rid(6).toLowerCase(), status: 'DRAFT', created_at: new Date().toISOString(), funded_at: null, ends_at: null,
      contract: clone(contract), verification: { ok: true, paths: v.paths, states: v.states },
      money: { currency: 'USD', hold_cents: contract.hold.amount_cents, held_cents: 0, captured_cents: 0, voided_cents: 0, remaining_cents: 0 },
      funding: { status: 'none', order_id: null, authorization_id: null, approve_url: null, authorized_at: null, expires_at: null, reauthorized: 0 },
      milestones: contract.milestones.map((m) => ({ ...clone(m), status: 'PENDING', evidence: null, verdict: null, capture_id: null, released_at: null, receipt: null })),
      clock: { now: new Date().toISOString(), day: 0 }, version: 1,
    };
    deals.set(d.id, d);
    emit('deal.created', d, null, 'Deal created');
    return view(d);
  }

  async function fund(id) {
    const d = get(id);
    await sleep(ms(700));
    d.funding = { ...d.funding, status: 'pending_approval', order_id: rid(17), approve_url: '/mock/approve?deal=' + id };
    d.status = 'AWAITING_FUNDING'; d.version++;
    row(d, { kind: 'order.create', call: 'POST /v2/checkout/orders', paypal_id: d.funding.order_id, http_status: 201, status: 'CREATED', amount_cents: d.money.hold_cents, note: 'AUTHORIZE order for the full hold' });
    emit('funding.pending', d, null, 'Waiting for PayPal approval');
    return { order_id: d.funding.order_id, approve_url: d.funding.approve_url, mock: true };
  }

  async function fundComplete(id) {
    const d = get(id);
    await sleep(ms(500));
    const now = new Date();
    d.status = 'ACTIVE'; d.funded_at = now.toISOString();
    d.ends_at = new Date(now.getTime() + d.contract.deadline.day * 864e5).toISOString();
    d.money.held_cents = d.money.hold_cents;
    d.funding = { ...d.funding, status: 'authorized', authorization_id: rid(17), authorized_at: now.toISOString(), expires_at: new Date(now.getTime() + 3 * 864e5).toISOString() };
    recompute(d);
    row(d, { kind: 'order.authorize', call: 'POST /v2/checkout/orders/{id}/authorize', paypal_id: d.funding.authorization_id, http_status: 201, status: 'CREATED', amount_cents: d.money.hold_cents, note: 'Buyer approved. PayPal now holds the funds.' });
    row(d, { kind: 'webhook', call: 'WEBHOOK PAYMENT.AUTHORIZATION.CREATED', paypal_id: d.funding.authorization_id, status: 'RECEIVED', note: 'Signature checked, state reconciled' });
    emit('funding.authorized', d, null, '$' + (d.money.hold_cents / 100).toFixed(2) + ' held by PayPal');
    return view(d);
  }

  async function release(d, m, why, by) {
    const cap = rid(17);
    m.status = 'RELEASED'; m.capture_id = cap; m.released_at = new Date().toISOString();
    d.money.captured_cents += m.amount_cents; recompute(d);
    row(d, { milestone_id: m.id, kind: 'capture', call: 'POST /v2/payments/authorizations/{id}/capture', paypal_id: cap, http_status: 201, status: 'COMPLETED', amount_cents: m.amount_cents, note: `${m.id} released: ${why}` });
    row(d, { milestone_id: m.id, kind: 'webhook', call: 'WEBHOOK PAYMENT.CAPTURE.COMPLETED', paypal_id: cap, status: 'RECEIVED', note: 'Capture confirmed by PayPal' });
    const inv = 'INV2-' + rid(4) + '-' + rid(4);
    row(d, { milestone_id: m.id, kind: 'invoice.create', call: 'POST /v2/invoicing/invoices', paypal_id: inv, http_status: 201, status: 'DRAFT', amount_cents: m.amount_cents, note: 'Receipt invoice drafted' });
    row(d, { milestone_id: m.id, kind: 'invoice.payment', call: 'POST /v2/invoicing/invoices/{id}/payments', paypal_id: inv, http_status: 200, status: 'MARKED_AS_PAID', amount_cents: m.amount_cents, note: 'Receipt marked as paid' });
    m.receipt = { invoice_id: inv, number: String(10 + d.milestones.indexOf(m)).padStart(4, '0'), status: 'MARKED_AS_PAID' };
    emit('milestone.released', d, m.id, `${m.id} released: $${(m.amount_cents / 100).toFixed(2)} captured`);
    if (d.milestones.every((x) => x.status === 'RELEASED')) {
      d.status = 'COMPLETED';
      row(d, { kind: 'state', call: 'STATE COMPLETED', status: 'COMPLETED', note: 'Every milestone released. Nothing left held.' });
      emit('deal.completed', d, null, 'Deal completed');
    }
  }

  async function submit(id, mid, payload = {}) {
    const d = get(id);
    const m = d.milestones.find((x) => x.id === mid);
    if (!m) { const e = new Error('Milestone not found'); e.code = 'NOT_FOUND'; throw e; }
    if (d.status !== 'ACTIVE') { const e = new Error('The hold is not active'); e.code = 'NOT_ACTIVE'; throw e; }
    m.status = 'CHECKING';
    m.evidence = { text: payload.text || null, url: payload.url || null, has_image: !!payload.image_data_url, submitted_at: new Date().toISOString() };
    d.version++;
    emit('milestone.checking', d, mid, `${mid} checking`);
    await sleep(ms(m.oracle.type === 'url' ? 1100 : 1900));
    let verdict;
    if (m.oracle.type === 'url') {
      const u = m.oracle.url;
      row(d, { milestone_id: mid, kind: 'oracle', call: 'GET ' + u, http_status: 200, status: 'PASS', note: `${mid}: staging URL returned 200, headline found` });
      verdict = { verdict: 'pass', confidence: 0.99, by: 'url-oracle', reasons: [`${u} answered 200`, `Page contains "${m.oracle.contains}"`] };
    } else if (m.oracle.type === 'evidence') {
      const unclear = /blurry|unclear|maybe/i.test(payload.text || '') || (!payload.image_data_url && !payload.text);
      verdict = unclear
        ? { verdict: 'unclear', confidence: 0.58, by: 'claude-vision', reasons: ['The pricing table is cut off', 'Footer is not visible'] }
        : { verdict: 'pass', confidence: 0.94, by: 'claude-vision', reasons: ['Hero headline and CTA match the mockup', 'Pricing table has all three plans', 'Footer links are present'] };
      row(d, { milestone_id: mid, kind: 'judge', call: 'Claude vision · claude-sonnet-5-5', status: `${verdict.verdict.toUpperCase()} ${verdict.confidence}`, note: `${mid}: ${verdict.reasons[0]}` });
    } else if (m.oracle.type === 'github_pr') {
      verdict = { verdict: 'pass', confidence: 0.99, by: 'url-oracle', reasons: [`${m.oracle.repo}#${m.oracle.number} is merged`] };
      row(d, { milestone_id: mid, kind: 'oracle', call: `GET /repos/${m.oracle.repo}/pulls/${m.oracle.number}`, status: 'MERGED', note: `${mid}: pull request merged` });
    } else {
      verdict = { verdict: 'unclear', confidence: 0.5, by: 'heuristic', reasons: ['Needs the client to confirm'] };
    }
    m.verdict = verdict;
    let outcome;
    if (verdict.verdict === 'pass') { await release(d, m, verdict.reasons[0], verdict.by); outcome = 'released'; }
    else {
      m.status = 'NEEDS_REVIEW';
      m.review = { summary: `${verdict.reasons.join('. ')}. Confidence ${Math.round(verdict.confidence * 100)}%, below the 80% bar.`, for_freelancer: 'Resubmit a clearer capture or ask the client to release.', for_client: 'Check the proof and release if it meets the brief.' };
      emit('milestone.needs_review', d, mid, `${mid} needs a human look`);
      outcome = 'needs_review';
    }
    d.version++;
    return { deal: view(d), result: { ...verdict, outcome } };
  }

  async function review(id, mid, decision) {
    const d = get(id), m = d.milestones.find((x) => x.id === mid);
    await sleep(ms(500));
    if (decision === 'release') { m.verdict = { ...(m.verdict || {}), by: 'human', verdict: 'pass' }; await release(d, m, 'client released it by hand', 'human'); }
    else { m.status = 'REJECTED'; emit('milestone.rejected', d, mid, `${mid} rejected`); row(d, { milestone_id: mid, kind: 'state', call: 'STATE REJECTED', status: 'REJECTED', note: `${mid}: rejected by client` }); }
    d.version++;
    return view(d);
  }

  async function cancel(id, reason) {
    const d = get(id);
    await sleep(ms(600));
    const rest = d.money.remaining_cents;
    d.money.voided_cents += rest; recompute(d);
    d.status = 'CANCELLED';
    d.milestones.forEach((m) => { if (m.status !== 'RELEASED') m.status = 'VOIDED'; });
    row(d, { kind: 'void', call: 'POST /v2/payments/authorizations/{id}/void', paypal_id: d.funding.authorization_id, http_status: 204, status: 'VOIDED', amount_cents: rest, note: reason || 'Unreleased remainder voided. The money never left the buyer.' });
    row(d, { kind: 'webhook', call: 'WEBHOOK PAYMENT.AUTHORIZATION.VOIDED', status: 'RECEIVED', note: 'Void confirmed by PayPal' });
    emit('deal.cancelled', d, null, 'Hold voided');
    return view(d);
  }

  async function clock(id, days) {
    const d = get(id);
    await sleep(ms(500));
    d.clock.day += days;
    emit('clock.advanced', d, null, `+${days} days`);
    for (const m of d.milestones) {
      if (m.oracle.type !== 'deadline' || m.status !== 'PENDING') continue;
      const prev = m.oracle.after && d.milestones.find((x) => x.id === m.oracle.after);
      if (prev && prev.status !== 'RELEASED') continue;
      const start = prev ? (prev.released_day ?? 0) : 0;
      m.verdict = { verdict: 'pass', confidence: 1, by: 'heuristic', reasons: [`${m.oracle.after_days} days passed`, 'No bug was filed'] };
      row(d, { milestone_id: m.id, kind: 'oracle', call: 'TIMER ' + m.oracle.after_days + 'd', status: 'ELAPSED', note: `${m.id}: ${m.oracle.after_days} days passed on the demo clock` });
      await release(d, m, `${m.oracle.after_days} days with no open bugs`, 'timer');
    }
    return view(d);
  }

  // Quick seeds for development and screenshots.
  async function seed(stage = 'midway') {
    const saved = speed; speed = 1e6;
    try {
      const { contract } = await compile(DEMO_TEXT, { typo: false });
      const d0 = await createDeal(contract);
      if (stage === 'draft') return d0;
      await fund(d0.id);
      if (stage === 'awaiting') return view(get(d0.id));
      await fundComplete(d0.id);
      if (stage === 'funded') return view(get(d0.id));
      await submit(d0.id, 'm1', { url: 'https://staging.example.com' });
      if (stage === 'midway') return view(get(d0.id));
      await submit(d0.id, 'm2', { text: 'Final design screenshot', image_data_url: 'data:image/png;base64,AAAA' });
      if (stage === 'cancelled') return cancel(d0.id);
      return clock(d0.id, 8);
    } finally { speed = saved; }
  }

  return {
    mock: true,
    async status() { return { paypal: 'mock', currency: 'USD', ai: { compiler: 'fallback', judge: 'heuristic', model: 'claude-sonnet-5-5' }, clock: { now: new Date().toISOString(), offset_days: 0 }, webhooks: { verify: 'simulated-only' } }; },
    compile, async verify(c) { return verify(c); }, createDeal, fund, fundComplete,
    async getDeal(id) { return view(get(id)); },
    async listDeals() { return [...deals.values()].map(view).reverse(); },
    submit, review, cancel, clock, seed,
    async ledger(id) { return ledger.filter((r) => !id || r.deal_id === id).map(clone); },
    onEvent(f) { listeners.add(f); return () => listeners.delete(f); },
    setSpeed(s) { speed = s; },
    async demoContract() { const r = await compile(DEMO_TEXT); return { text: DEMO_TEXT, contract: r.contract }; },
    reset() { deals.clear(); ledger.length = 0; },
  };
}
