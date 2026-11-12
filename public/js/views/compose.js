import { h, ic, money, typeInto, RM } from '../util.js';
import { api } from '../api.js';
import { state, nav } from '../state.js';
import { parseDeal, EXAMPLES } from '../parse.js';
import { verifiedBadge } from '../components.js';

export function mount(root) {
  let seq = 0, inflight = null, typers = [];
  const ta = h('textarea', { class: 'deal-input', id: 'deal-text', rows: 4, 'aria-label': 'Describe the deal', placeholder: 'Landing page, $1,200: 30% when the staging URL is live, 50% when the design matches the mockup…', spellcheck: 'false' });
  const go = h('button', { class: 'btn primary lg', type: 'button', id: 'to-review', disabled: true }, 'Review contract ', ic('arrow', 18, 'arrow'));
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Examples' }, EXAMPLES.map((e) => h('button', { class: 'chip', type: 'button', onclick: () => fill(e.text) }, e.label)));
  const preview = h('div', { class: 'card preview', 'aria-live': 'polite' });
  const err = h('div');

  const page = h('section', { class: 'page' },
    h('div', { class: 'compose-head enter' },
      h('h1', null, 'Describe the deal'),
      h('p', { class: 'lede' }, 'Plain English. PayPal holds the money; proof releases it.')),
    h('div', { class: 'compose-grid' },
      h('div', { class: 'card composer enter', style: { animationDelay: '.06s' } }, ta, chips, err,
        h('div', { class: 'composer-foot' }, h('span', { class: 'hint' }, h('kbd', null, 'Ctrl'), '+', h('kbd', null, '↵')), go)),
      preview));
  root.append(page);

  function fill(text) {
    ta.value = text; ta.focus();
    state.draft.text = text;
    onInput(true);
  }

  function renderPreview(mode, extra = {}) {
    typers.forEach((t) => t.cancel()); typers = [];
    const d = state.draft, c = d.contract && d.compiledText === d.text ? d.contract : null;
    const p = d.parsed;
    preview.replaceChildren();
    if (!p || !p.milestones.length) {
      preview.append(
        h('div', { class: 'pv-head' }, h('span', { class: 'kicker' }, 'Contract preview')),
        h('div', { class: 'pv-title pv-empty' }, ''),
        h('div', { class: 'pv-amount', style: { color: 'var(--line-2)' } }, '$0', h('small', null, '.00')),
        h('div', { class: 'pv-list pv-empty' }, [0, 1, 2].map(() => h('div', { class: 'pv-row' }, h('span', null, '.'), h('span', null, '.'), h('span', null, '.')))),
        h('p', { class: 'pv-hint' }, 'Your contract builds here as you type.'));
      return;
    }
    const total = c ? c.hold.amount_cents : p.total_cents;
    const rows = c ? c.milestones.map((m) => ({ pct: m.share_pct, title: m.title, amount: m.amount_cents })) : p.milestones.map((m) => ({ pct: m.share_pct, title: m.title, amount: Math.round((p.total_cents * m.share_pct) / 100) }));
    const status = mode === 'compiling'
      ? h('span', { class: 'pill' }, h('span', { class: 'spinner', style: { width: '12px', height: '12px', borderWidth: '2px' } }), 'Checking every path…')
      : c && d.verification && d.verification.ok ? verifiedBadge(d.verification)
        : mode === 'error' ? h('span', { class: 'pill' }, 'Not readable yet') : h('span', { class: 'pill' }, 'Drafting');
    const list = h('div', { class: 'pv-list' });
    const amountEl = h('div', { class: 'pv-amount' }, money(total).replace(/\.00$/, ''), h('small', null, '.00'));
    preview.append(
      h('div', { class: 'pv-head' }, h('span', { class: 'kicker' }, 'Contract preview'), status),
      h('div', { class: 'pv-title' }, c ? c.title : p.title),
      amountEl, list);
    rows.forEach((r, i) => {
      const t = h('span');
      const row = h('div', { class: 'pv-row', style: { animationDelay: extra.animate ? i * 220 + 'ms' : '0ms' } },
        h('span', { class: 'pct' }, r.pct + '%'), h('span', { class: 't' }, t), h('span', { class: 'a' }, money(r.amount, { compact: true })));
      list.append(row);
      if (extra.animate && !RM()) {
        t.textContent = '';
        const delay = i * 380;
        setTimeout(() => { if (!t.isConnected) return; const ty = typeInto(t, r.title, 70); typers.push(ty); ty.done.then(() => t.classList.remove('caret')); }, delay);
        t.classList.add('caret');
      } else t.textContent = r.title;
    });
    const day = c ? c.deadline.day : p.timeout && p.timeout.day;
    if (day) preview.append(h('div', { class: 'pv-foot' }, ic('undo', 16), `Anything unreleased returns to the client by day ${day}.`));
    if (c && d.attempts && d.attempts.length) {
      const errs = d.attempts.flatMap((a) => a.errors || []);
      const e = errs.find((x) => x.code === 'SHARES_SUM') || errs[0];
      preview.append(h('div', { class: 'fix-note' }, ic('sparkle', 18), h('span', null, h('b', null, 'Verifier caught a mistake. '), (e ? e.message : 'The first draft failed a check') + (errs.length > 1 ? ` (+${errs.length - 1} more)` : '') + '. The model fixed it before you saw it.')));
    } else if (mode === 'error') preview.append(h('div', { class: 'fix-note' }, ic('x', 18), extra.message || 'Could not read that yet.'));
  }

  async function compileNow() {
    const text = state.draft.text.trim();
    const parsed = state.draft.parsed;
    if (!parsed || !parsed.milestones.length) return null;
    if (inflight && inflight.text === text) return inflight.p;
    const mine = ++seq;
    renderPreview('compiling');
    const p = (async () => {
      try {
        const r = await api.compile(text, { typo: state.typoNext });
        if (mine !== seq) return null;
        state.typoNext = false;
        Object.assign(state.draft, { contract: r.contract, verification: r.verification, attempts: r.attempts || [], source: r.source, compiledText: state.draft.text });
        renderPreview('verified'); updateBtn();
        return r;
      } catch (e) {
        if (mine !== seq) return null;
        renderPreview('error', { message: e.message });
        return null;
      }
    })();
    inflight = { text, p }; p.finally(() => { if (inflight && inflight.p === p) inflight = null; }); return p;
  }
  let ct = null;
  const compileSoon = () => { clearTimeout(ct); ct = setTimeout(compileNow, 1100); };

  function updateBtn() {
    const ok = state.draft.parsed && state.draft.parsed.milestones.length > 0;
    go.disabled = !ok;
  }

  function onInput(animate) {
    const text = ta.value; state.draft.text = text;
    state.draft.parsed = text.trim() ? parseDeal(text) : null;
    state.draft.contract = null; state.draft.compiledText = null; state.draft.attempts = [];
    seq++;
    renderPreview('drafting', { animate: animate === true });
    updateBtn();
    compileSoon();
  }
  ta.addEventListener('input', () => onInput(false));
  ta.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') go.click(); });

  go.addEventListener('click', async () => {
    go.classList.add('busy');
    clearTimeout(ct);
    const d = state.draft;
    if (!(d.contract && d.compiledText === d.text)) await compileNow();
    go.classList.remove('busy');
    if (state.draft.contract) nav('#/review');
    else err.replaceChildren(h('div', { class: 'err' }, 'Add a price and a few milestones, then try again.'));
  });

  // restore draft when coming back from review
  if (state.draft.text) { ta.value = state.draft.text; state.draft.parsed = parseDeal(state.draft.text); }
  renderPreview(state.draft.contract ? 'verified' : 'drafting'); updateBtn();
  if (!RM()) setTimeout(() => ta.focus({ preventScroll: true }), 120); else ta.focus({ preventScroll: true });

  return { destroy() { typers.forEach((t) => t.cancel()); seq++; clearTimeout(ct); } };
}
