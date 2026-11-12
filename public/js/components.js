import { h, ic, money, RM, initials, countTo, sleep } from './util.js';

// ---- popover helper (tap to open, outside click / Esc closes) ----
// Keep a popover inside the viewport and its nearest clipping container: cap the width, then shift
// horizontally (flip right-aligned first, then clamp) and flip above/below if it would be cut off.
export function place(pop, anchor) {
  const M = 8;
  let lo = M, hi = window.innerWidth - M, top = M, bottom = window.innerHeight - M;
  for (let el = anchor.parentElement; el && el !== document.body; el = el.parentElement) {
    const cs = getComputedStyle(el);
    if (/(hidden|clip|auto|scroll)/.test(cs.overflowX + cs.overflow)) { const r = el.getBoundingClientRect(); lo = Math.max(lo, r.left + M); hi = Math.min(hi, r.right - M); break; }
  }
  if (hi - lo < 200) { lo = M; hi = window.innerWidth - M; } // container too narrow: use the viewport
  pop.style.maxWidth = `${Math.max(160, hi - lo)}px`;
  pop.style.left = '0px'; pop.style.right = 'auto';
  const a = anchor.getBoundingClientRect(); let r = pop.getBoundingClientRect();
  let x = 0;
  if (r.right > hi) x = (a.right - r.width) - a.left; // right-align to the trigger
  if (a.left + x < lo) x = lo - a.left;
  if (a.left + x + r.width > hi) x = hi - r.width - a.left;
  pop.style.left = `${Math.round(x)}px`;
  r = pop.getBoundingClientRect();
  if (r.bottom > bottom && a.top - r.height - 10 > top) { pop.style.top = 'auto'; pop.style.bottom = 'calc(100% + 10px)'; }
  else if (r.top < top) { pop.style.bottom = 'auto'; pop.style.top = 'calc(100% + 10px)'; }
}

export function popover(trigger, content, cls = '') {
  const wrap = h('span', { class: 'popwrap', style: { position: 'relative', display: 'inline-flex' } }, trigger);
  let pop = null;
  const close = () => { if (pop) { pop.remove(); pop = null; trigger.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', away, true); document.removeEventListener('keydown', esc); } };
  const away = (e) => { if (pop && !wrap.contains(e.target)) close(); };
  const esc = (e) => { if (e.key === 'Escape') { close(); trigger.focus(); } };
  trigger.setAttribute('aria-haspopup', 'true'); trigger.setAttribute('aria-expanded', 'false');
  trigger.addEventListener('click', () => {
    if (pop) return close();
    pop = h('div', { class: 'pop ' + cls, role: 'dialog' }, typeof content === 'function' ? content() : content);
    wrap.append(pop); trigger.setAttribute('aria-expanded', 'true');
    place(pop, wrap);
    document.addEventListener('click', away, true); document.addEventListener('keydown', esc);
  });
  return wrap;
}

export function verifiedBadge(v, label) {
  const btn = h('button', { type: 'button' }, ic('shield', 16), label || `Verified · ${Number(v.paths).toLocaleString("en-US")} paths`);
  const body = () => [
    h('h4', null, 'Checked by a model checker'),
    h('p', null, `Every one of ${Number(v.paths).toLocaleString("en-US")} paths through this deal (${v.states} states) ends with the money accounted for.`),
    h('ul', null, (v.invariants || []).map((i) => h('li', null, ic(i.ok ? 'check' : 'x', 16), i.name))),
  ];
  return h('span', { class: 'verified' }, popover(btn, body));
}

// ---- sheets ----
export function openSheet(node, { onClose, cls = '' } = {}) {
  const root = document.getElementById('sheet-root');
  const prev = document.activeElement;
  const back = h('div', { class: 'backdrop' }, h('div', { class: 'sheet ' + cls, role: 'dialog', 'aria-modal': 'true' }, node));
  const close = (res) => { document.removeEventListener('keydown', esc); back.remove(); if (prev && prev.focus) prev.focus(); onClose && onClose(res); };
  const esc = (e) => { if (e.key === 'Escape') close('esc'); };
  back.addEventListener('mousedown', (e) => { if (e.target === back) close('backdrop'); });
  document.addEventListener('keydown', esc);
  root.append(back);
  const first = back.querySelector('button, [href], input'); if (first) setTimeout(() => first.focus(), 30);
  return close;
}

export function paypalSheet({ amount_cents, client, payee, onApprove, onCancel }) {
  let close;
  const approve = h('button', { class: 'btn primary lg', type: 'button', id: 'pp-approve' }, 'Authorize ', money(amount_cents));
  const cancel = h('button', { class: 'btn ghost', type: 'button', id: 'pp-cancel' }, 'Cancel');
  approve.addEventListener('click', () => { approve.classList.add('busy'); setTimeout(() => { close('ok'); onApprove(); }, RM() ? 0 : 700); });
  cancel.addEventListener('click', () => close('cancel'));
  const node = h('div', { class: 'pp-sheet', style: { display: 'grid', gap: '16px' } },
    h('div', { class: 'pp-head' }, h('span', { class: 'pp-logo' }, 'Pay', h('span', null, 'Pal')), h('span', { class: 'pill' }, 'Sandbox')),
    h('h2', null, 'Hold ', money(amount_cents), ' for this deal'),
    h('div', null,
      h('div', { class: 'pp-line' }, h('span', null, 'Paying'), h('b', null, client)),
      h('div', { class: 'pp-line' }, h('span', null, 'Merchant'), h('b', null, 'Pactline · ' + payee)),
      h('div', { class: 'pp-line' }, h('span', null, 'Held, not charged'), h('b', null, money(amount_cents)))),
    h('p', { class: 'sandbox' }, 'Simulated PayPal approval. Nothing moves until a milestone passes.'),
    h('div', { class: 'acts' }, approve, cancel));
  close = openSheet(node, { cls: 'pp-sheet', onClose: (r) => { if (r !== 'ok') onCancel && onCancel(r); } });
  return close;
}

// ---- money flow strip: client -> PayPal vessel -> payee ----
const short = (n) => String(n).split(' ')[0];
export function flowStrip({ client, payee }) {
  const waveSvg = '<svg viewBox="0 0 200 12" preserveAspectRatio="none" aria-hidden="true"><path d="M0 6 Q12.5 0 25 6 T50 6 T75 6 T100 6 T125 6 T150 6 T175 6 T200 6 V12 H0Z"/></svg>';
  const liquid = h('div', { class: 'liquid', html: waveSvg });
  const vessel = h('div', { class: 'vessel empty', role: 'img', 'aria-label': 'PayPal hold' }, liquid, h('div', { class: 'vlabel' }, h('span', null, 'PayPal'), h('b', null, 'hold')));
  const got = h('div', { class: 'got' }), back = h('div', { class: 'back' });
  const laneIn = h('div', { class: 'lane in' }), laneOut = h('div', { class: 'lane out' });
  const cEl = h('div', { class: 'party client' }, h('span', { class: 'av' }, initials(client)), h('b', null, short(client)), h('small', null, 'Client'), back);
  const pEl = h('div', { class: 'party payee' }, h('span', { class: 'av alt' }, initials(payee)), h('b', null, short(payee)), h('small', null, 'Gets paid'), got);
  const token = h('div', { class: 'token' });
  const el = h('div', { class: 'flow' }, cEl, laneIn, vessel, laneOut, pEl, token);
  let lvl = 0, gotC = 0;

  const center = (n) => { const r = n.getBoundingClientRect(), f = el.getBoundingClientRect(); return { x: r.left - f.left + r.width / 2, y: r.top - f.top + r.height / 2 }; };
  function fly(from, to, text, kind, ms = 900) {
    if (RM()) return Promise.resolve();
    const a = center(from), b = center(to);
    token.textContent = text; token.className = 'token ' + kind;
    const anim = token.animate([
      { left: a.x + 'px', top: a.y + 'px', opacity: 0, transform: 'translate(-50%,-50%) scale(.6)' },
      { opacity: 1, offset: .15, transform: 'translate(-50%,-50%) scale(1)' },
      { opacity: 1, offset: .85, transform: 'translate(-50%,-50%) scale(1)' },
      { left: b.x + 'px', top: b.y + 'px', opacity: 0, transform: 'translate(-50%,-50%) scale(.7)' },
    ], { duration: ms, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
    return Promise.race([anim.finished.catch(() => {}), sleep(ms + 250)]);
  }
  const api = {
    el,
    setLevel(frac, animate = true) {
      lvl = Math.max(0, Math.min(1, frac));
      if (!animate) liquid.style.transition = 'none';
      liquid.style.setProperty('--lvl', lvl);
      vessel.classList.toggle('empty', lvl === 0);
      if (!animate) { void liquid.offsetWidth; liquid.style.transition = ''; }
    },
    setGot(cents, animate = true) { if (animate) countTo(got, gotC, cents, 700); else got.textContent = cents ? money(cents) : ''; if (!cents) got.textContent = ''; gotC = cents; },
    setBack(cents) { back.textContent = cents ? '↩ ' + money(cents) + ' back' : ''; },
    async deposit(cents) { laneIn.classList.add('flowing'); await fly(cEl.querySelector('.av'), vessel, money(cents, { compact: true }), 'in', 1000); laneIn.classList.remove('flowing'); },
    async release(cents) { laneOut.classList.add('flowing'); await fly(vessel, pEl.querySelector('.av'), money(cents, { compact: true }), 'out', 1000); laneOut.classList.remove('flowing'); },
    async refund(cents) { laneIn.classList.add('flowing'); await fly(vessel, cEl.querySelector('.av'), money(cents, { compact: true }), 'back', 1000); laneIn.classList.remove('flowing'); },
  };
  return api;
}

export const roleName = (deal, role) => (role === 'client' ? deal.contract.client.name : deal.contract.freelancer.name);

export function srSay(msg) { const l = document.getElementById('sr-live'); if (l) { l.textContent = ''; setTimeout(() => { l.textContent = msg; }, 30); } }
