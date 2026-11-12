import { h, ic, money, fmtTime, countTo, sleep, RM, toast } from '../util.js';
import { api } from '../api.js';
import { state, nav } from '../state.js';
import { ORACLE_LABEL, ORACLE_ICON } from '../parse.js';
import { flowStrip, popover, openSheet, srSay } from '../components.js';

const BY = { 'claude-vision': 'Claude vision', 'claude-cli': 'Claude', 'url-oracle': 'URL check', heuristic: 'Timer check', human: 'A person' };
const STATE_LABEL = { PENDING: 'Waiting', CHECKING: 'Checking', NEEDS_REVIEW: 'Needs a look', AWAITING_CONFIRMATION: 'Client to confirm', RELEASED: 'Released', REJECTED: 'Rejected', VOIDED: 'Voided' };

export function mount(root, { id }) {
  let deal = null, dead = false, ops = 0, dirty = false, shown = 0;
  const local = {}, staged = {};
  let flow = null;

  const hero = h('div', { class: 'card hero enter' });
  const rail = h('ol', { class: 'rail', 'aria-label': 'Milestones' });
  root.append(h('section', { class: 'page' }, h('div', { class: 'deal-grid' }, hero, h('div', null, rail))));
  skeleton();

  function skeleton() {
    hero.replaceChildren(h('div', { class: 'skel', style: { height: '28px', width: '50%' } }), h('div', { class: 'skel', style: { height: '84px' } }), h('div', { class: 'skel', style: { height: '160px' } }));
    rail.replaceChildren(...[0, 1, 2].map(() => h('li', null, h('div', { class: 'skel', style: { width: '40px', height: '40px', borderRadius: '50%' } }), h('div', { class: 'skel', style: { height: '72px' } }))));
  }

  const statusOf = (m) => local[m.id] || m.status;
  const activeMs = () => deal.milestones.find((m) => ['PENDING', 'CHECKING', 'NEEDS_REVIEW', 'REJECTED'].includes(statusOf(m)) && m.depends_on.every((d) => (deal.milestones.find((x) => x.id === d) || {}).status === 'RELEASED')) || null;

  // ---------- hero ----------
  function buildHero() {
    const c = deal.contract;
    flow = flowStrip({ client: c.client.name, payee: c.freelancer.name });
    const amountEl = h('div', { class: 'hero-amt', id: 'hero-amt', 'aria-live': 'polite' });
    const label = h('div', { class: 'label', id: 'hero-label' });
    const next = h('div', { class: 'next', id: 'hero-next' });
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'View as' },
      ['client', 'freelancer'].map((r) => h('button', { type: 'button', 'data-role': r, 'aria-pressed': String(state.role === r), onclick: () => setRole(r) }, r === 'client' ? 'Client' : 'Freelancer')));
    const foot = h('div', { class: 'hero-foot', id: 'hero-foot' });
    hero.replaceChildren(
      h('div', { class: 'top-line' }, h('h1', null, c.title), seg),
      h('div', { class: 'big' }, label, amountEl),
      flow.el, next, foot, h('div', { class: 'glow' }));
    hero._els = { amountEl, label, next, foot, seg };
  }
  function setRole(r) {
    state.role = r;
    hero._els.seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.role === r)));
    paintHero(false); paintRail();
  }

  function paintHero(animate = true, prev = null) {
    const { amountEl, label, next, foot } = hero._els;
    const c = deal.contract, m = deal.money;
    let target, lbl;
    if (deal.status === 'COMPLETED') { target = m.captured_cents; lbl = [ic('check', 16), `Released to ${c.freelancer.name}`]; }
    else if (deal.status === 'CANCELLED' || deal.status === 'EXPIRED') { target = m.voided_cents; lbl = [ic('undo', 16), `Returned to ${c.client.name}`]; }
    else { target = m.remaining_cents; lbl = [ic('lock', 16), 'Held by', h('img', { class: 'pp-logo-img sm', src: 'assets/paypal/paypal-color.svg', alt: 'PayPal', width: 64, height: 18 })]; }
    label.replaceChildren(...lbl);
    amountEl.dataset.cents = target;
    if (animate && target !== shown) countTo(amountEl, shown, target, 800); else amountEl.textContent = money(target);
    shown = target;
    hero.classList.toggle('done', deal.status === 'COMPLETED');
    const big = amountEl.parentNode, ring = big.querySelector('.done-ring');
    if (deal.status === 'COMPLETED' && !ring) big.append(h('span', { html: '<svg class="done-ring" viewBox="0 0 72 72" aria-hidden="true"><circle cx="36" cy="36" r="30"/><path d="M24 37l8 8 16-17"/></svg>' }).firstChild);
    else if (deal.status !== 'COMPLETED' && ring) ring.remove();

    const act = activeMs();
    if (deal.status === 'ACTIVE') {
      next.replaceChildren(ic('bolt', 18), act ? h('span', null, 'Next release ', h('b', null, money(act.amount_cents, { compact: true })), ' · ', act.title) : 'Waiting on the last checks');
    } else if (deal.status === 'COMPLETED') {
      const n = deal.milestones.filter((x) => x.receipt).length;
      next.replaceChildren(ic('check', 18), h('span', null, `All ${deal.milestones.length} milestones released`, n ? ` · ${n} receipts` : ''));
    } else {
      next.replaceChildren(ic('undo', 18), h('span', null, m.captured_cents ? `${money(m.captured_cents, { compact: true })} already released stays with ${c.freelancer.name}` : 'Nothing was ever charged'));
    }
    foot.replaceChildren(
      h('a', { class: 'btn ghost sm', href: '#/ledger/' + deal.id, id: 'open-ledger' }, ic('doc', 16), 'Audit trail'),
      ...(deal.status === 'ACTIVE' && state.role === 'client' ? [h('button', { class: 'link', type: 'button', id: 'cancel-deal', onclick: askCancel }, 'Cancel and void the rest')] : []));
  }

  async function syncFlow(prev) {
    const m = deal.money;
    const level = m.hold_cents ? m.remaining_cents / m.hold_cents : 0;
    if (!prev) { flow.setLevel(level, false); flow.setGot(m.captured_cents, false); flow.setBack(m.voided_cents); return; }
    let run = prev.money.captured_cents, rem = prev.money.remaining_cents;
    for (const nm of deal.milestones) {
      const pm = prev.milestones.find((x) => x.id === nm.id);
      if (pm && pm.status !== 'RELEASED' && nm.status === 'RELEASED') {
        const p = flow.release(nm.amount_cents);
        await sleep(RM() ? 0 : 380);
        rem -= nm.amount_cents; run += nm.amount_cents;
        flow.setLevel(Math.max(0, rem) / (m.hold_cents || 1));
        await p;
        flow.setGot(run, true);
      }
    }
    if (m.voided_cents > (prev.money.voided_cents || 0) && deal.status !== 'ACTIVE') {
      const p = flow.refund(m.voided_cents - (prev.money.voided_cents || 0));
      await sleep(RM() ? 0 : 380); flow.setLevel(0); await p; flow.setBack(m.voided_cents);
    }
    flow.setGot(m.captured_cents, true); flow.setLevel(level);
  }

  // ---------- rail ----------
  // Repaint only when something the rail shows has changed, and animate a node only on a real status change.
  // (Every SSE event used to rebuild the rail, which replayed the green "released" pop every couple of seconds.)
  const seen = {}; let railSig = null;
  function paintRail() {
    const act = activeMs();
    const sig = JSON.stringify([state.role, deal.status, deal.clock && deal.clock.day, act && act.id, deal.milestones.map((m) => [statusOf(m), m.verdict, m.review, m.receipt && m.receipt.number, m.released_at, staged[m.id] && staged[m.id].name])]);
    if (sig === railSig) return;
    railSig = sig;
    rail.replaceChildren(...deal.milestones.map((m, i) => {
      const st = statusOf(m), changed = seen[m.id] !== undefined && seen[m.id] !== st;
      seen[m.id] = st;
      const li = item(m, i, act && act.id === m.id);
      if (changed) li.classList.add('anim');
      return li;
    }));
  }

  function item(m, i, active) {
    const st = statusOf(m);
    const node = h('span', { class: 'node' }, st === 'RELEASED' ? ic('check', 20) : st === 'CHECKING' ? h('span', { class: 'spinner' }) : st === 'NEEDS_REVIEW' || st === 'AWAITING_CONFIRMATION' ? ic('pause', 18) : st === 'REJECTED' ? ic('x', 18) : st === 'VOIDED' ? ic('undo', 16) : String(i + 1));
    const metaBits = [h('span', { class: 'state-chip ' + st }, STATE_LABEL[st] || st), h('span', { style: { display: 'inline-flex', gap: '6px', alignItems: 'center' } }, ic(ORACLE_ICON[m.oracle.type] || 'check', 14), ORACLE_LABEL[m.oracle.type])];
    if (st === 'RELEASED' && m.released_at) metaBits.push(h('span', null, fmtTime(m.released_at)));
    if (m.verdict && ['RELEASED', 'NEEDS_REVIEW', 'REJECTED', 'AWAITING_CONFIRMATION'].includes(st)) metaBits.unshift(verdictChip(m.verdict));
    const body = h('div', { class: 'ms-body' }, h('div', { class: 'ms-top' }, h('span', { class: 't' }, m.title), h('span', { class: 'a' }, money(m.amount_cents, { compact: true }))), h('div', { class: 'ms-meta' }, metaBits));
    const panel = panelFor(m, st, active);
    if (panel) body.append(panel);
    if (st === 'RELEASED' && m.receipt) body.append(h('span', { class: 'receipt' }, ic('doc', 14), `Receipt #${m.receipt.number} · captured from the PayPal hold`));
    return h('li', { class: `s-${st} ${active ? 'active' : ''}`, 'data-mid': m.id }, node, body);
  }

  function verdictChip(v) {
    const cls = v.verdict === 'pass' ? 'pass' : v.verdict === 'fail' ? 'fail' : 'unclear';
    const label = (v.verdict === 'pass' ? 'Passed' : v.verdict === 'fail' ? 'Failed' : 'Unclear') + (v.confidence != null && v.by !== 'url-oracle' && v.by !== 'human' ? ` · ${Math.round(v.confidence * 100)}%` : '');
    const btn = h('button', { type: 'button', 'aria-label': 'Why? ' + label }, ic(v.verdict === 'pass' ? 'check' : 'sparkle', 14), label);
    const content = () => [h('h4', null, 'Why'), h('ul', null, (v.reasons || []).map((r) => h('li', null, ic('check', 16), r))), h('p', { style: { color: 'var(--ink-3)', fontSize: '13px' } }, 'Checked by ' + (BY[v.by] || v.by))];
    return h('span', { class: 'verdict ' + cls }, popover(btn, content));
  }

  function panelFor(m, st, active) {
    const c = deal.contract, role = state.role;
    if (st === 'CHECKING') {
      return h('div', { class: 'proof' }, h('div', { class: 'checking', 'aria-busy': 'true' }, h('div', { class: 'lbl' }, h('span', { class: 'spinner' }), m.oracle.type === 'evidence' ? 'Claude is reading the proof…' : 'Checking…'), h('div', { class: 'skel' }), h('div', { class: 'skel' }), h('div', { class: 'skel' })));
    }
    if (st === 'AWAITING_CONFIRMATION') {
      const cf = m.confirmation; const left = Math.max(0, cf.until_day - deal.clock.day);
      const box = h('div', { class: 'review-box confirm-box', id: 'confirm-box-' + m.id },
        h('p', null, h('strong', null, 'Proof passed. '), `${money(m.amount_cents, { compact: true })} releases in ${left} day${left === 1 ? '' : 's'} unless ${c.client.name} disputes it.`),
        h('p', { class: 'countdown', role: 'timer', 'aria-live': 'off' }, ic('hour', 16), `Day ${deal.clock.day} of ${cf.until_day}: auto-release on day ${cf.until_day}`));
      if (role === 'client') {
        box.append(h('div', { class: 'row' },
          h('button', { class: 'btn primary sm', type: 'button', id: 'confirm-' + m.id, onclick: () => confirmNow(m) }, 'Confirm now'),
          h('button', { class: 'btn ghost sm', type: 'button', id: 'dispute-' + m.id, onclick: () => askDispute(m) }, 'Dispute')));
      } else box.append(h('div', { class: 'waiting' }, ic('clock', 16), `Waiting for ${c.client.name} to confirm, or for the window to end`));
      box.append(h('div', { class: 'row' }, h('span', { class: 'waiting' }, 'Demo clock'), h('button', { class: 'btn ghost sm', type: 'button', id: 'skip-days', onclick: () => skipDays(left) }, `Skip ${left} day${left === 1 ? '' : 's'}`)));
      return box;
    }
    if (st === 'NEEDS_REVIEW') {
      const r = m.review || {};
      const box = h('div', { class: 'review-box' }, h('p', null, r.summary || 'The check was not sure.'));
      if (m.dispute) box.prepend(h('p', { class: 'dispute-tag', role: 'status' }, ic('pause', 16), h('strong', null, 'Disputed: release paused. '), `Unmet: "${m.dispute.criterion}"`));
      const note = role === 'client' ? r.for_client : r.for_freelancer;
      if (note) box.append(h('p', { class: 'for-role' }, note));
      if (role === 'client') {
        box.append(h('div', { class: 'row' },
          h('button', { class: 'btn primary sm', type: 'button', id: 'release-' + m.id, onclick: () => decide(m, 'release') }, 'Release ', money(m.amount_cents, { compact: true })),
          h('button', { class: 'btn ghost sm', type: 'button', onclick: () => decide(m, 'reject') }, 'Reject')));
      } else box.append(h('div', { class: 'waiting' }, h('span', { class: 'spinner' }), `Waiting for ${c.client.name} to look`));
      return box;
    }
    if (!['PENDING', 'REJECTED'].includes(st) || !active || deal.status !== 'ACTIVE') return null;
    const o = m.oracle;
    if (o.type === 'manual') {
      return role === 'client'
        ? h('div', { class: 'proof' }, h('p', { class: 'crit' }, m.criteria), h('div', { class: 'row' }, h('button', { class: 'btn primary sm', type: 'button', id: 'release-' + m.id, onclick: () => decide(m, 'release') }, 'Release ', money(m.amount_cents, { compact: true }))))
        : h('div', { class: 'waiting' }, ic('hand', 16), `Waiting for ${c.client.name} to confirm`);
    }
    if (o.type === 'deadline') {
      return h('div', { class: 'proof' }, h('p', { class: 'crit' }, `Releases by itself after ${o.after_days} days with nothing reported.`),
        h('div', { class: 'row' }, h('span', { class: 'waiting' }, ic('hour', 16), `Day ${deal.clock.day} on the demo clock`), h('button', { class: 'btn ghost sm', type: 'button', id: 'skip-days', onclick: () => skipDays(o.after_days + 1) }, `Skip ${o.after_days + 1} days`)));
    }
    if (role === 'client') return h('div', { class: 'waiting' }, ic('clock', 16), `Waiting for ${c.freelancer.name} to send proof`);
    if (o.type === 'evidence') return evidencePanel(m);
    return h('div', { class: 'proof' }, h('p', { class: 'crit' }, m.criteria),
      h('div', { class: 'row' }, o.type === 'url' ? h('span', { class: 'mono', style: { fontSize: '13px', color: 'var(--ink-3)' } }, o.url) : h('span', null),
        h('button', { class: 'btn primary sm', type: 'button', id: 'submit-' + m.id, onclick: () => submit(m, o.type === 'url' ? { url: o.url } : {}) }, o.type === 'url' ? 'Check the URL' : 'Check the pull request')));
  }

  function evidencePanel(m) {
    const s = staged[m.id] || {};
    const inp = h('input', { type: 'file', accept: 'image/*', id: 'file-' + m.id, 'aria-label': 'Choose a photo or screenshot' });
    const zone = h('label', { class: 'dropzone', id: 'drop-' + m.id },
      s.url ? h('img', { src: s.url, alt: 'Your proof' }) : ic('upload', 26),
      h('span', null, s.url ? 'Looks good. Drop another to replace.' : 'Drop a photo or screenshot'), h('small', null, s.url ? s.name : 'or click to choose'), inp);
    const send = h('button', { class: 'btn primary sm', type: 'button', id: 'submit-' + m.id, disabled: !s.url, onclick: () => submit(m, { image_data_url: s.url, text: s.name }) }, 'Submit proof');
    const take = async (f) => { if (!f || !f.type.startsWith('image/')) return toast('That is not an image'); const url = await toDataUrl(f); staged[m.id] = { url, name: f.name }; paintRail(); };
    inp.addEventListener('change', () => take(inp.files[0]));
    ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('over'); }));
    zone.addEventListener('drop', (e) => take(e.dataTransfer.files[0]));
    return h('div', { class: 'proof' }, h('p', { class: 'crit' }, m.criteria), zone, h('div', { class: 'row' }, h('span', { class: 'waiting' }, ic('sparkle', 16), 'Claude checks it against the brief'), send));
  }

  // ---------- actions ----------
  async function guarded(fn) { ops++; try { return await fn(); } finally { ops--; if (!ops && dirty) { dirty = false; refresh(true); } } }

  async function submit(m, payload) {
    local[m.id] = 'CHECKING'; paintRail();
    await guarded(async () => {
      try {
        const prev = deal;
        const r = await api.submit(deal.id, m.id, payload);
        delete local[m.id]; delete staged[m.id];
        await apply(r.deal, prev);
        if (r.result.outcome === 'needs_review') toast('Not sure enough. Both sides get a neutral summary.');
      } catch (e) { delete local[m.id]; paintRail(); toast(e.message || 'Could not submit'); }
    });
  }
  async function decide(m, decision) {
    local[m.id] = 'CHECKING'; paintRail();
    await guarded(async () => {
      try { const prev = deal; const d = await api.review(deal.id, m.id, decision); delete local[m.id]; await apply(d, prev); } catch (e) { delete local[m.id]; paintRail(); toast(e.message); }
    });
  }
  async function confirmNow(m) {
    local[m.id] = 'CHECKING'; paintRail();
    await guarded(async () => { try { const prev = deal; const d = await api.confirm(deal.id, m.id); delete local[m.id]; await apply(d, prev); } catch (e) { delete local[m.id]; paintRail(); toast(e.message); } });
  }
  function askDispute(m) {
    const crits = String(m.criteria || m.title).split(/(?<=[.;])\s+|\s+and\s+/).map((x) => x.trim().replace(/[.;]$/, '')).filter(Boolean);
    let close;
    const sel = h('select', { id: 'dispute-criterion', required: true }, h('option', { value: '' }, 'Choose the unmet criterion'), crits.map((x) => h('option', { value: x }, x)));
    const why = h('textarea', { id: 'dispute-reason', rows: 3, required: true, minlength: 10, maxlength: 600, placeholder: 'What is missing, in one or two sentences' });
    const err = h('p', { class: 'field-error', role: 'alert' });
    const go = h('button', { class: 'btn danger', type: 'button', id: 'confirm-dispute' }, 'Pause release and dispute');
    const no = h('button', { class: 'btn ghost', type: 'button' }, 'Back');
    no.addEventListener('click', () => close());
    go.addEventListener('click', async () => {
      if (!sel.value) { err.textContent = 'Choose the criterion that is not met.'; return sel.focus(); }
      if (why.value.trim().length < 10) { err.textContent = 'Give a reason of at least 10 characters.'; return why.focus(); }
      go.classList.add('busy');
      await guarded(async () => { try { const prev = deal; const d = await api.dispute(deal.id, m.id, why.value.trim(), sel.value); close(); await apply(d, prev); toast('Disputed. The money stays held.'); } catch (e) { go.classList.remove('busy'); err.textContent = e.message; } });
    });
    close = openSheet(h('div', { style: { display: 'grid', gap: '12px' } }, h('h2', null, 'Dispute this milestone'),
      h('p', null, `${money(m.amount_cents, { compact: true })} stays held until this is resolved. Both sides see your reason.`),
      h('label', { for: 'dispute-criterion' }, 'Which criterion is not met?'), sel,
      h('label', { for: 'dispute-reason' }, 'Reason'), why, err, h('div', { class: 'acts' }, go, no)));
  }
  async function skipDays(n) {
    const btn = document.getElementById('skip-days'); if (btn) btn.classList.add('busy');
    await guarded(async () => { try { const prev = deal; const d = await api.clock(deal.id, n); await apply(d, prev); } catch (e) { toast(e.message); } });
  }
  function askCancel() {
    const m = deal.money, c = deal.contract;
    let close;
    const yes = h('button', { class: 'btn danger', type: 'button', id: 'confirm-cancel' }, `Void ${money(m.remaining_cents, { compact: true })}`);
    const no = h('button', { class: 'btn ghost', type: 'button' }, 'Keep the deal');
    no.addEventListener('click', () => close());
    yes.addEventListener('click', async () => {
      yes.classList.add('busy'); close();
      await guarded(async () => { try { const prev = deal; const d = await api.cancel(deal.id); await apply(d, prev); } catch (e) { toast(e.message); } });
    });
    close = openSheet(h('div', { style: { display: 'grid', gap: '16px' } }, h('h2', null, 'Void the rest?'),
      h('p', null, `${money(m.remaining_cents, { compact: true })} goes back to ${c.client.name}. ${m.captured_cents ? money(m.captured_cents, { compact: true }) + ' already released stays with ' + c.freelancer.name + '.' : 'Nothing has been released yet.'}`),
      h('div', { class: 'acts' }, yes, no)));
  }

  // ---------- data ----------
  async function apply(next, prev) {
    if (dead) return;
    prev = prev || deal;
    if (deal && next.version < deal.version) return;
    deal = next; state.deal = next;
    paintRail();
    paintHero(true, prev);
    const first = !prev || prev === next;
    await syncFlow(first ? null : prev);
    announce(prev, next);
    if (next.status === 'COMPLETED' && prev && prev.status !== 'COMPLETED') hero.classList.add('done');
  }
  function announce(prev, next) {
    if (!prev) return;
    next.milestones.forEach((m) => { const p = prev.milestones.find((x) => x.id === m.id); if (p && p.status !== m.status) srSay(`${m.title}: ${STATE_LABEL[m.status] || m.status}`); });
  }
  async function refresh(force) {
    if (ops && !force) { dirty = true; return; }
    try { const d = await api.getDeal(id); if (!deal || d.version !== deal.version || force) await apply(d, deal); } catch { /* offline */ }
  }

  (async () => {
    try {
      const d = await api.getDeal(id);
      if (dead) return;
      if (d.status === 'DRAFT' || d.status === 'AWAITING_FUNDING') return nav('#/hold/' + id);
      deal = d; state.deal = d; shown = 0;
      buildHero(); paintHero(false); shown = d.money.captured_cents && d.status === 'COMPLETED' ? d.money.captured_cents : shown;
      await syncFlow(null); paintHero(true); paintRail();
    } catch (e) {
      hero.replaceChildren(h('div', { class: 'empty-state' }, h('h2', null, 'Deal not found'), h('p', null, e.message), h('a', { class: 'btn primary', href: '#/' }, 'Start a new deal')));
    }
  })();

  return { onEvent(e) { if (e.deal_id === id) refresh(false); }, destroy() { dead = true; },
    // hooks for demo mode
    api: { setRole, getDeal: () => deal } };
}

async function toDataUrl(file) {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/jpeg', 0.85);
  } catch {
    return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
  }
}
