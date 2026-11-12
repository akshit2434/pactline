// The Pactline engine: wires the pure state machine to PayPal (via the escrow adapter), the oracles, the AI judge,
// receipts, the ledger and the live event bus. Money only moves as the machine's `effects`.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { initState, apply, remaining, EscrowError } from './core/machine.js';
import { verifyContract } from './core/verify.js';
import { normalizeContract } from './core/contract.js';
import { runOracle } from './oracles/index.js';
import { MockEscrow } from './paypal/escrow.js';

export class EngineError extends Error { constructor(code, message, status = 400, extra = {}) { super(message); this.code = code; this.status = status; Object.assign(this, extra); } }

const RELEASE_CONFIDENCE = 0.8;
const usd = (c) => `$${(c / 100).toFixed(2)}`;

export function createEngine({ escrow, baseUrl, dataFile, now = () => Date.now(), ai = {} }) {
  const mockEscrow = new MockEscrow();
  const deals = new Map();
  const events = []; const ledger = []; const subscribers = new Set();
  let evId = 0, ledgerId = 0;

  // ---------- persistence (live deals only) ----------
  const persist = () => { if (!dataFile) return; try { fs.mkdirSync(path.dirname(dataFile), { recursive: true }); fs.writeFileSync(dataFile, JSON.stringify({ deals: [...deals.values()].filter((d) => !d.mock), ledger: ledger.filter((r) => !r.mock), evId, ledgerId })); } catch { /* best effort */ } };
  if (dataFile && fs.existsSync(dataFile)) {
    try { const s = JSON.parse(fs.readFileSync(dataFile, 'utf8')); (s.deals || []).forEach((d) => deals.set(d.id, d)); ledger.push(...(s.ledger || [])); evId = s.evId || 0; ledgerId = s.ledgerId || 0; } catch { /* ignore */ }
  }

  const esc = (d) => (d.mock ? mockEscrow : escrow);
  // one operation at a time per deal: two clicks can never release the same milestone twice
  const locks = new Map();
  const locked = (id, fn) => { const prev = locks.get(id) || Promise.resolve(); const next = prev.then(fn, fn); locks.set(id, next.catch(() => {})); return next; };

  // ---------- events + ledger ----------
  function emit(type, deal, extra = {}) {
    const ev = { id: ++evId, ts: new Date(now()).toISOString(), type, deal_id: deal?.id, milestone_id: extra.milestone_id, summary: extra.summary || type, data: extra.data || {} };
    events.push(ev); if (events.length > 2000) events.shift();
    for (const fn of subscribers) { try { fn(ev); } catch { /* subscriber gone */ } }
    return ev;
  }
  function row(deal, kind, r = {}) {
    const m = money(deal);
    const x = { id: ++ledgerId, ts: new Date(now()).toISOString(), deal_id: deal.id, milestone_id: r.milestone_id || null, kind, call: r.meta?.call || r.call || null, paypal_id: r.paypal_id || null, debug_id: r.meta?.debug_id || null, http_status: r.meta?.http_status || null, status: r.status || null, amount_cents: r.amount_cents ?? null, held_cents: m.held_cents, captured_cents: m.captured_cents, voided_cents: m.voided_cents, balance_cents: m.remaining_cents, note: r.note || '', mock: !!(r.meta?.mock ?? deal.mock) };
    ledger.push(x); emit('ledger.row', deal, { milestone_id: x.milestone_id, summary: `${kind}: ${x.note}`.slice(0, 140), data: { row_id: x.id } });
    return x;
  }
  const money = (d) => ({ currency: 'USD', hold_cents: d.state.hold_cents, held_cents: d.state.held_cents, captured_cents: d.state.captured_cents, voided_cents: d.state.voided_cents, remaining_cents: d.state.held_cents ? remaining(d.state) : 0 });

  // ---------- API shape ----------
  function toApi(d) {
    const st = d.state;
    return {
      id: d.id, status: st.status, created_at: d.created_at, funded_at: d.funded_at || null, ends_at: d.funded_at ? new Date(Date.parse(d.funded_at) + st.deadline_day * 864e5).toISOString() : null,
      contract: d.contract, verification: { ok: d.verification.ok, paths: d.verification.paths, states: d.verification.states }, mock: !!d.mock,
      money: money(d),
      funding: { status: d.funding.status, order_id: d.funding.order_id || null, authorization_id: d.funding.authorization_id || null, approve_url: d.funding.approve_url || null, authorized_at: d.funding.authorized_at || null, expires_at: d.funding.expires_at || null, reauthorized: d.funding.reauthorized || 0, payer: d.funding.payer || null },
      milestones: d.contract.milestones.map((cm) => {
        const sm = st.milestones.find((x) => x.id === cm.id); const x = d.ms[cm.id] || {};
        return { id: cm.id, title: cm.title, share_pct: cm.share_pct, amount_cents: cm.amount_cents, depends_on: cm.depends_on || [], oracle: cm.oracle, criteria: cm.criteria || '', due_day: cm.due_day ?? null, proof_type: cm.proof_type || null,
          status: sm.status, evidence: x.evidence || null, verdict: x.verdict || null, review: x.review || null, capture_id: x.capture_id || null, released_at: x.released_at || null, receipt: x.receipt || null };
      }),
      clock: { now: new Date(now()).toISOString(), day: st.day }, version: d.version,
    };
  }
  const touch = (d) => { d.version += 1; persist(); };

  // ---------- creation ----------
  function createDeal(rawContract, { mock = false, id } = {}) {
    const verification = verifyContract(rawContract);
    if (!verification.ok) throw new EngineError('VERIFY_FAILED', 'The contract did not pass verification', 422, { verification });
    const contract = normalizeContract(rawContract);
    const d = { id: id || 'd_' + crypto.randomBytes(4).toString('hex'), created_at: new Date(now()).toISOString(), mock, contract, verification, state: initState(contract), funding: { status: 'none' }, ms: {}, version: 1 };
    deals.set(d.id, d);
    emit('deal.created', d, { summary: `Deal "${contract.title}" created (${usd(contract.hold.amount_cents)})` });
    row(d, 'state', { note: `Deal created: ${contract.milestones.length} milestones, ${verification.paths} execution paths verified` });
    touch(d); return d;
  }
  const get = (id) => { const d = deals.get(id); if (!d) throw new EngineError('NOT_FOUND', `No deal ${id}`, 404); return d; };

  // ---------- funding ----------
  const startFunding = (...a) => locked(a[0], () => startFundingImpl(...a));
  async function startFundingImpl(id) {
    const d = get(id);
    if (d.state.status !== 'AWAITING_FUNDING') throw new EngineError('BAD_STATE', 'Deal is not waiting for funding', 409);
    const e = esc(d);
    const r = await e.createHold({ dealId: d.id, title: d.contract.title, amountCents: d.state.hold_cents, currency: 'USD', returnUrl: `${baseUrl}/api/deals/${d.id}/fund/return`, cancelUrl: `${baseUrl}/?deal=${d.id}&funded=0` });
    d.funding = { status: 'pending_approval', order_id: r.orderId, approve_url: r.approveUrl };
    row(d, 'order.create', { meta: r.meta, paypal_id: r.orderId, status: r.status, amount_cents: d.state.hold_cents, note: 'Hold requested: client must approve in PayPal' });
    emit('funding.pending', d, { summary: `Waiting for the client to approve a ${usd(d.state.hold_cents)} hold` });
    touch(d); return { order_id: r.orderId, approve_url: r.approveUrl, mock: !!e.mock };
  }

  const completeFunding = (...a) => locked(a[0], () => completeFundingImpl(...a));
  async function completeFundingImpl(id, orderId) {
    const d = get(id);
    if (d.funding.status === 'authorized') return d;
    if (!orderId || orderId !== d.funding.order_id) throw new EngineError('WRONG_ORDER', 'That order does not belong to this deal', 409);
    const a = await esc(d).authorize(orderId);
    if (a.amountCents !== d.state.hold_cents) throw new EngineError('WRONG_AMOUNT', 'Authorized amount does not match the hold', 409);
    const { state } = apply(d.state, { type: 'FUND', amount_cents: a.amountCents });
    d.state = state; d.funded_at = new Date(now()).toISOString();
    d.funding = { ...d.funding, status: 'authorized', authorization_id: a.authorizationId, authorized_at: d.funded_at, expires_at: a.expiresAt, payer: a.payer, reauthorized: 0 };
    row(d, 'order.authorize', { meta: a.meta, paypal_id: a.authorizationId, status: 'AUTHORIZED', amount_cents: a.amountCents, note: `${usd(a.amountCents)} held by PayPal for the buyer (authorization ${a.authorizationId})` });
    emit('funding.authorized', d, { summary: `${usd(a.amountCents)} is now held by PayPal` });
    touch(d); return d;
  }

  // ---------- executing machine effects against PayPal ----------
  async function runEffects(d, effects, ctx = {}) {
    const e = esc(d);
    for (const fx of effects) {
      if (fx.type === 'capture') {
        const cm = d.contract.milestones.find((m) => m.id === fx.milestone_id);
        const c = await e.capture(d.funding.authorization_id, { amountCents: fx.amount_cents, currency: 'USD', finalCapture: fx.final, invoiceId: `${d.id}-${fx.milestone_id}-${Date.now().toString(36)}`, note: `Pactline: ${cm.title}`, });
        d.ms[fx.milestone_id] = { ...(d.ms[fx.milestone_id] || {}), capture_id: c.captureId, released_at: new Date(now()).toISOString() };
        ctx.captured = (ctx.captured || 0) + fx.amount_cents;
        row(d, 'capture', { meta: c.meta, milestone_id: fx.milestone_id, paypal_id: c.captureId, status: c.status, amount_cents: fx.amount_cents, note: `${cm.id} released: ${usd(fx.amount_cents)} captured${fx.final ? ' (final capture)' : ''}` });
      } else if (fx.type === 'void') {
        const v = await e.void(d.funding.authorization_id).catch((err) => { if (/ALREADY|VOID/i.test(err.message)) return { status: 'VOIDED', meta: { call: 'POST /v2/payments/authorizations/{id}/void', mock: d.mock } }; throw err; });
        row(d, 'void', { meta: v.meta, paypal_id: d.funding.authorization_id, status: 'VOIDED', amount_cents: fx.amount_cents, note: `${usd(fx.amount_cents)} unreleased remainder voided: it never leaves the buyer` });
        d.funding.status = 'voided';
      } else if (fx.type === 'refund') {
        const capId = d.ms[fx.milestone_id]?.capture_id; if (!capId) continue;
        const r = await e.refund(capId, { amountCents: fx.amount_cents, currency: 'USD', note: 'Pactline timeout refund' });
        row(d, 'refund', { meta: r.meta, milestone_id: fx.milestone_id, paypal_id: r.refundId, status: r.status, amount_cents: fx.amount_cents, note: `${fx.milestone_id} refunded after timeout` });
      }
    }
  }

  async function writeReceipt(d, milestoneId) {
    const cm = d.contract.milestones.find((m) => m.id === milestoneId);
    try {
      const r = await esc(d).receipt({ client: d.contract.client, title: `${d.contract.title}: ${cm.title}`, amountCents: cm.amount_cents, currency: 'USD', note: `Milestone ${cm.id} released by Pactline. Funds were held by PayPal.`, paidNote: `Captured from PayPal authorization ${d.funding.authorization_id}` });
      d.ms[milestoneId].receipt = { invoice_id: r.invoiceId, number: r.number, status: r.status };
      row(d, 'invoice.payment', { meta: r.meta, milestone_id: milestoneId, paypal_id: r.invoiceId, status: r.status, amount_cents: cm.amount_cents, note: `Paid receipt invoice #${r.number} created for ${cm.id}` });
    } catch (err) { row(d, 'invoice.create', { milestone_id: milestoneId, status: 'ERROR', note: `Receipt invoice failed (money already captured): ${err.message.slice(0, 140)}`, call: 'POST /v2/invoicing/invoices' }); }
  }

  /** Apply a machine event, then perform its PayPal effects. State is only committed if the effects succeed. */
  async function transition(d, ev) {
    let r;
    try { r = apply(d.state, ev); } catch (err) { if (err instanceof EscrowError) throw new EngineError(err.code, err.message, 409); throw err; }
    const ctx = {}; const prev = d.state; d.state = r.state; // ledger rows snapshot the post-transition balance
    try { await runEffects(d, r.effects, ctx); }
    catch (err) { d.state = prev; row(d, 'state', { status: 'ERROR', note: `PayPal rejected ${ev.type}: ${String(err.message).slice(0, 160)}; deal state unchanged` }); touch(d); throw new EngineError('PAYPAL_ERROR', `PayPal could not complete the ${ev.type.toLowerCase()}: ${String(err.message).slice(0, 200)}`, 502); }
    for (const fx of r.effects) if (fx.type === 'capture') await writeReceipt(d, fx.milestone_id);
    return r;
  }

  // ---------- delivery ----------
  function pickOutcome(v) {
    if (v.verdict === 'pass' && v.confidence >= RELEASE_CONFIDENCE) return 'release';
    if (v.verdict === 'fail' && v.confidence >= RELEASE_CONFIDENCE) return 'reject';
    return 'review';
  }

  const submit = (...a) => locked(a[0], () => submitImpl(...a));
  async function submitImpl(id, mid, evidence = {}) {
    const d = get(id);
    if (d.state.status !== 'ACTIVE') throw new EngineError('BAD_STATE', 'The deal is not active', 409);
    const cm = d.contract.milestones.find((m) => m.id === mid); if (!cm) throw new EngineError('NOT_FOUND', `No milestone ${mid}`, 404);
    const sm = d.state.milestones.find((m) => m.id === mid);
    for (const dep of sm.depends_on) if (d.state.milestones.find((m) => m.id === dep).status !== 'RELEASED') throw new EngineError('DEPENDENCY', `${mid} can only be submitted after ${dep} is released`, 409);
    d.state = (await transition(d, { type: 'SUBMIT', id: mid })).state;
    d.ms[mid] = { ...(d.ms[mid] || {}), evidence: { text: evidence.text || null, url: evidence.url || null, has_image: !!evidence.image_data_url, submitted_at: new Date(now()).toISOString() }, review: null };
    emit('milestone.checking', d, { milestone_id: mid, summary: `${mid} submitted: checking "${cm.title}"` });
    touch(d);
    const v = await runOracle(cm, evidence, ai);
    d.ms[mid].verdict = { verdict: v.verdict, confidence: v.confidence, reasons: v.reasons, by: v.by, injection_detected: !!v.injection_detected };
    row(d, v.by === 'claude-vision' || v.by === 'heuristic' ? 'judge' : 'oracle', { milestone_id: mid, status: v.verdict.toUpperCase(), note: `${v.by}: ${v.verdict} (${Math.round(v.confidence * 100)}%): ${v.reasons[0]}` });
    const outcome = pickOutcome(v);
    if (outcome === 'release') await release(d, mid, 'oracle');
    else if (outcome === 'reject') {
      d.state = (await transition(d, { type: 'REJECT', id: mid })).state;
      emit('milestone.rejected', d, { milestone_id: mid, summary: `${mid} rejected: ${v.reasons[0]}` });
    } else {
      d.state = (await transition(d, { type: 'REVIEW', id: mid })).state;
      d.ms[mid].review = { summary: `Neutral summary: the checker could not decide ("${v.reasons[0]}", ${Math.round(v.confidence * 100)}% confident).`, for_freelancer: `If this is right, the client may release ${usd(cm.amount_cents)}. Add clearer proof to speed it up.`, for_client: `Release only if the delivered work meets: ${cm.criteria || cm.title}. Otherwise reject and the money stays held.` };
      emit('milestone.needs_review', d, { milestone_id: mid, summary: `${mid} needs a human decision: ${v.reasons[0]}` });
    }
    touch(d);
    return { deal: toApi(d), result: { verdict: v.verdict, confidence: v.confidence, reasons: v.reasons, by: v.by, outcome: outcome === 'release' ? 'released' : outcome === 'reject' ? 'rejected' : 'needs_review' } };
  }

  async function release(d, mid, by) {
    await transition(d, { type: 'RELEASE', id: mid });
    const cm = d.contract.milestones.find((m) => m.id === mid);
    emit('milestone.released', d, { milestone_id: mid, summary: `${mid} released: ${usd(cm.amount_cents)} captured`, data: { by } });
    if (d.state.status === 'COMPLETED') emit('deal.completed', d, { summary: 'All milestones released: deal complete' });
  }

  const review = (...a) => locked(a[0], () => reviewImpl(...a));
  async function reviewImpl(id, mid, decision, note) {
    const d = get(id);
    const sm = d.state.milestones.find((m) => m.id === mid); if (!sm) throw new EngineError('NOT_FOUND', `No milestone ${mid}`, 404);
    if (!['release', 'reject'].includes(decision)) throw new EngineError('BAD_INPUT', 'decision must be release or reject', 400);
    d.ms[mid] = { ...(d.ms[mid] || {}) };
    d.ms[mid].verdict = { ...(d.ms[mid].verdict || {}), verdict: decision === 'release' ? 'pass' : 'fail', confidence: 1, reasons: [note || `Client decided to ${decision}`], by: 'human' };
    if (decision === 'release') await release(d, mid, 'human');
    else { d.state = (await transition(d, { type: 'REJECT', id: mid })).state; emit('milestone.rejected', d, { milestone_id: mid, summary: `${mid} rejected by the client` }); }
    row(d, 'state', { milestone_id: mid, note: `Human decision: ${decision}${note ? ` (${note})` : ''}` });
    touch(d); return toApi(d);
  }

  const cancel = (...a) => locked(a[0], () => cancelImpl(...a));
  async function cancelImpl(id, reason) {
    const d = get(id);
    const before = remaining(d.state);
    await transition(d, { type: 'CANCEL' });
    row(d, 'state', { note: `Deal cancelled${reason ? `: ${reason}` : ''}. ${d.state.held_cents ? `${usd(before)} returned to the buyer, ${usd(d.state.captured_cents)} stays with the freelancer` : 'Nothing had been held'}` });
    emit('deal.cancelled', d, { summary: `Deal cancelled: ${usd(before)} voided` });
    touch(d); return toApi(d);
  }

  const advanceClock = (...a) => locked(a[0], () => advanceClockImpl(...a));
  async function advanceClockImpl(id, days) {
    const d = get(id);
    if (d.state.status !== 'ACTIVE') throw new EngineError('BAD_STATE', 'The deal is not active', 409);
    const day = d.state.day + Math.max(0, Math.floor(days));
    // timer oracles first, in order, then the overall timeout
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const cm of d.contract.milestones) {
        const sm = d.state.milestones.find((m) => m.id === cm.id);
        if (cm.oracle?.type !== 'deadline' || !['PENDING', 'REJECTED'].includes(sm.status) || d.state.status !== 'ACTIVE') continue;
        const depsOk = sm.depends_on.every((x) => d.state.milestones.find((m) => m.id === x).status === 'RELEASED');
        const anchor = cm.oracle.after ? d.state.milestones.find((m) => m.id === cm.oracle.after) : null;
        const startDay = anchor ? anchor.released_day : 0;
        if (depsOk && startDay != null && day >= startDay + (cm.oracle.after_days || 0) && day < d.state.deadline_day) {
          d.state = apply(d.state, { type: 'TICK', day: Math.min(day, d.state.deadline_day - 1) }).state;
          d.ms[cm.id] = { ...(d.ms[cm.id] || {}), verdict: { verdict: 'pass', confidence: 1, reasons: [`${cm.oracle.after_days} days passed with no dispute`], by: 'timer' } };
          row(d, 'oracle', { milestone_id: cm.id, status: 'PASS', note: `timer: waiting period of ${cm.oracle.after_days} days is over` });
          await release(d, cm.id, 'timer'); progressed = true;
        }
      }
    }
    // honour window: a PayPal authorization is honoured for 3 days; reauthorize to keep the guarantee alive
    if (d.state.status === 'ACTIVE' && day >= 4 && (d.funding.reauthorized || 0) === 0 && !d.funding.reauth_tried && remaining(d.state) > 0) {
      d.funding.reauth_tried = true;
      try { const r = await esc(d).reauthorize(d.funding.authorization_id, { amountCents: remaining(d.state), currency: 'USD' }); d.funding.reauthorized = 1; row(d, 'reauthorize', { meta: r.meta, paypal_id: d.funding.authorization_id, status: r.status, amount_cents: remaining(d.state), note: 'Hold re-authorized after the 3-day honor period so the money stays guaranteed' }); }
      catch (err) { const soon = /TOO_SOON/.test(err.message); row(d, 'reauthorize', { status: soon ? 'SCHEDULED' : 'SKIPPED', call: 'POST /v2/payments/authorizations/{id}/reauthorize', note: soon ? 'PayPal only allows reauthorization after the real 3-day honor period (sandbox: REAUTHORIZATION_TOO_SOON). Production would reauthorize here; the demo clock is simulated.' : `Reauthorize not accepted: ${String(err.message).slice(0, 120)}` }); }
    }
    if (d.state.status === 'ACTIVE') {
      const t = await transition(d, { type: 'TICK', day });
      if (d.state.status === 'EXPIRED') { row(d, 'state', { note: `Deadline reached on day ${day}: unreleased money voided` }); emit('deal.expired', d, { summary: 'Deadline reached: remaining hold voided' }); }
      void t;
    }
    emit('clock.advanced', d, { summary: `Clock moved to day ${day}` });
    touch(d); return toApi(d);
  }

  // ---------- webhooks ----------
  function handleWebhook(evt, { verified }) {
    const type = evt.event_type || 'UNKNOWN'; const res = evt.resource || {};
    const d = [...deals.values()].find((x) => x.funding.authorization_id && (res.id === x.funding.authorization_id || res.supplementary_data?.related_ids?.authorization_id === x.funding.authorization_id || res.custom_id === x.id || [...Object.values(x.ms)].some((m) => m.capture_id && m.capture_id === res.id)));
    if (!d) { return { matched: false }; }
    row(d, 'webhook', { call: `webhook ${type}`, paypal_id: res.id, status: verified ? 'VERIFIED' : 'SIMULATED', amount_cents: res.amount?.value ? Math.round(Number(res.amount.value) * 100) : null, note: `${type} received${verified ? '' : ' (simulated)'}: state reconciled, no money moved by the webhook`, meta: { mock: !verified } });
    emit('webhook.received', d, { summary: `${type} received`, data: { type, verified } });
    touch(d); return { matched: true, deal_id: d.id };
  }

  // ---------- demo seed (mock money, never calls PayPal) ----------
  async function seedDemo(stage = 'midway', demoContract) {
    const d = createDeal(demoContract, { mock: true, id: 'd_' + crypto.randomBytes(3).toString('hex') });
    if (stage === 'draft') { d.state.status = 'AWAITING_FUNDING'; return d; }
    const f = await startFunding(d.id);
    if (stage === 'awaiting') return d;
    await completeFunding(d.id, f.order_id);
    if (stage === 'funded') return d;
    d.funded_at = new Date(now()).toISOString();
    await release(d, 'm1', 'oracle'); d.ms.m1.evidence = { text: null, url: d.contract.milestones[0].oracle.url, has_image: false, submitted_at: d.funded_at }; d.ms.m1.verdict = { verdict: 'pass', confidence: 0.98, reasons: ['staging site returned 200 and shows the Northwind headline'], by: 'url-oracle' };
    if (stage === 'midway') {
      d.state = apply(d.state, { type: 'SUBMIT', id: 'm2' }).state; d.state = apply(d.state, { type: 'REVIEW', id: 'm2' }).state;
      d.ms.m2 = { evidence: { text: 'Hero, pricing and footer match the approved mockup; one icon is a different weight.', url: null, has_image: true, submitted_at: d.funded_at }, verdict: { verdict: 'unclear', confidence: 0.62, reasons: ['Layout matches, but the pricing icons differ from the mockup'], by: 'claude-vision' }, review: { summary: 'Neutral summary: layout matches, one visual detail differs (icon weight). The checker is 62% confident.', for_freelancer: 'The client may still release $600.00. Consider replacing the icons to speed it up.', for_client: 'Release if the icon difference is acceptable under the brief; otherwise reject and the money stays held.' } };
      emit('milestone.needs_review', d, { milestone_id: 'm2', summary: 'm2 needs a human decision' });
    } else if (stage === 'done') {
      for (const m of ['m2', 'm3']) { await release(d, m, 'oracle'); }
    } else if (stage === 'cancelled') { await cancel(d.id, 'Client cancelled'); }
    touch(d); return d;
  }

  return {
    createDeal, get, toApi, startFunding, completeFunding, submit, review, cancel, advanceClock, handleWebhook, seedDemo,
    list: () => [...deals.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    ledger: (dealId) => ledger.filter((r) => !dealId || r.deal_id === dealId),
    events: (since = 0, dealId) => events.filter((e) => e.id > since && (!dealId || e.deal_id === dealId)),
    lastEventId: () => evId,
    subscribe: (fn) => { subscribers.add(fn); return () => subscribers.delete(fn); },
    reset: () => { for (const [k, d] of deals) if (d.mock) deals.delete(k); },
    now,
  };
}
