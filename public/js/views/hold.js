import { h, ic, money, sleep, RM, countTo } from '../util.js';
import { api, engine } from '../api.js';
import { state, nav } from '../state.js';
import { flowStrip, paypalSheet } from '../components.js';

// Phases: creating -> approve -> waiting -> held | cancelled | error
export function mount(root, { id }) {
  let dead = false, deal = null, phase = 'creating', poll = null, popup = null, order = null;
  const body = h('div', { class: 'card hold enter' });
  root.append(h('section', { class: 'page' }, body));
  let flow = null;

  const stepsEl = (active) => {
    const labels = ['Create hold', 'Approve in PayPal', 'Funds held'];
    return h('div', { class: 'hold-steps', role: 'list' }, labels.map((l, i) => h('span', { class: 's ' + (i < active ? 'done' : i === active ? 'on' : ''), role: 'listitem' }, i < active ? ic('check', 14) : null, l)));
  };

  function paint() {
    body.replaceChildren();
    const c = (deal && deal.contract) || state.pendingContract;
    if (!c) { nav('#/'); return; }
    const cents = c.hold.amount_cents;
    flow = flowStrip({ client: c.client.name, payee: c.freelancer.name });
    const idx = { creating: 0, approve: 1, waiting: 1, held: 2, cancelled: 1, error: 1 }[phase];
    body.append(stepsEl(idx));
    if (phase === 'held') {
      body.append(
        h('span', { class: 'check-badge' }, h('svg', { viewBox: '0 0 24 24', width: 36, height: 36, fill: 'none', stroke: 'currentColor', 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, h('path', { d: 'M5 12.500l4.500 4.500L19 7.500' }))),
        h('h1', null, money(cents, { compact: true }), ' is held by PayPal'),
        flow.el,
        h('p', { class: 'note' }, 'It stays with the buyer until each milestone is proven.'),
        h('button', { class: 'btn primary lg', type: 'button', id: 'open-deal', onclick: () => go() }, 'Open the deal ', ic('arrow', 18, 'arrow')));
      flow.setLevel(0, false);
      requestAnimationFrame(async () => { flow.deposit(cents); await sleep(RM() ? 0 : 450); flow.setLevel(1); });
      return;
    }
    const title = { creating: 'Creating your hold…', approve: 'Approve the hold in PayPal', waiting: 'Waiting for PayPal…', cancelled: 'PayPal was closed', error: 'Something went wrong' }[phase];
    const amount = h('div', { class: 'hero-amt' }, money(cents).replace(/\.00$/, ''), h('small', null, '.00'));
    body.append(h('h1', null, title), amount, flow.el);
    flow.setLevel(0, false);
    if (phase === 'creating') body.append(h('div', { class: 'skel', style: { width: '220px', height: '48px', borderRadius: '999px' } }));
    if (phase === 'approve') {
      body.append(
        h('button', { class: 'btn primary lg', type: 'button', id: 'continue-pp', onclick: openPayPal }, ic('lock', 18), 'Continue to PayPal'),
        h('p', { class: 'note' }, 'You only authorize. Nothing is charged until a milestone passes.'));
    }
    if (phase === 'waiting') {
      body.append(
        h('div', { class: 'waiting' }, h('span', { class: 'spinner' }), 'Finish in the PayPal window, then come back.'),
        h('button', { class: 'link', type: 'button', onclick: openPayPal }, 'Reopen PayPal'));
    }
    if (phase === 'cancelled') {
      body.append(
        h('p', { class: 'note' }, 'Nothing was held and nothing was charged.'),
        h('button', { class: 'btn primary lg', type: 'button', onclick: openPayPal }, 'Try again'),
        h('a', { class: 'link', href: '#/review' }, 'Back to the contract'));
    }
    if (phase === 'error') {
      body.append(h('div', { class: 'err' }, state.holdError || 'Please try again.'), h('button', { class: 'btn primary lg', type: 'button', onclick: start }, 'Try again'));
    }
  }

  async function start() {
    phase = 'creating'; paint();
    try {
      if (id === 'new') {
        const c = state.pendingContract;
        deal = await api.createDeal(c);
        state.deal = deal;
        history.replaceState(null, '', '#/hold/' + deal.id);
      } else deal = await api.getDeal(id);
      if (deal.status === 'ACTIVE' || deal.funding.status === 'authorized') return held();
      const r = await api.fund(deal.id);
      order = r;
      phase = 'approve'; paint();
      if (state.demo) return; // demo drives the click itself
    } catch (e) { state.holdError = e.message; phase = 'error'; paint(); }
  }

  function openPayPal() {
    if (engine.mode === 'mock' || (order && order.mock)) {
      phase = 'waiting'; paint();
      const c = deal.contract;
      paypalSheet({
        amount_cents: c.hold.amount_cents, client: c.client.name, payee: c.freelancer.name,
        onApprove: async () => { try { deal = await api.fundComplete(deal.id, order.order_id); state.deal = deal; held(); } catch (e) { state.holdError = e.message; phase = 'error'; paint(); } },
        onCancel: () => { phase = 'cancelled'; paint(); },
      });
      return;
    }
    popup = window.open(order.approve_url, 'paypal-approve', 'width=480,height=760');
    if (!popup) { location.href = order.approve_url; return; }
    phase = 'waiting'; paint();
    clearInterval(poll);
    poll = setInterval(async () => {
      try {
        const d = await api.getDeal(deal.id);
        if (d.funding.status === 'authorized' || d.status === 'ACTIVE') { deal = d; state.deal = d; try { popup && popup.close(); } catch { /* cross-origin */ } held(); }
        else if (popup && popup.closed) { clearInterval(poll); if (phase === 'waiting') { phase = 'cancelled'; paint(); } }
      } catch { /* keep polling */ }
    }, 1500);
  }

  function held() {
    clearInterval(poll);
    if (dead) return;
    phase = 'held'; paint();
    state.deal = deal;
    setTimeout(() => { if (!dead && phase === 'held' && !state.demo) go(); }, 3200);
  }
  const go = () => { if (!dead) nav('#/deal/' + deal.id); };

  const onMsg = (e) => { if (e.data && e.data.pactline === 'funded') api.getDeal(deal.id).then((d) => { deal = d; held(); }); };
  window.addEventListener('message', onMsg);

  if (id !== 'new' && state.justFunded === id) { state.justFunded = null; api.getDeal(id).then((d) => { deal = d; held(); }); }
  else start();

  return {
    onEvent(e) { if (e.type === 'funding.authorized' && deal && e.deal_id === deal.id && phase !== 'held') api.getDeal(deal.id).then((d) => { deal = d; held(); }); },
    destroy() { dead = true; clearInterval(poll); window.removeEventListener('message', onMsg); },
  };
}
