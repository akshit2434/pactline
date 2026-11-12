import { h, ic, money, typeInto, RM } from '../util.js';
import { api } from '../api.js';
import { state, nav } from '../state.js';
import { parseDeal, EXAMPLES } from '../parse.js';
import { verifiedBadge } from '../components.js';
import { lintDeal, applyFix } from '../lint.js';

export const COMPILE_IDLE_MS = 550;

export function mount(root) {
  let seq = 0, inflight = null, typers = [], ctl = null;
  const ta = h('textarea', { class: 'deal-input', id: 'deal-text', rows: 4, 'aria-label': 'Describe the deal', placeholder: 'Landing page, $1,200: 30% when the staging URL is live, 50% when the design matches the mockup…', spellcheck: 'false' });
  const go = h('button', { class: 'btn primary lg', type: 'button', id: 'to-review', disabled: true }, 'Review contract ', ic('arrow', 18, 'arrow'));
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Examples' }, EXAMPLES.map((e) => h('button', { class: 'chip', type: 'button', onclick: () => fill(e.text) }, e.label)));
  const preview = h('div', { class: 'card preview', 'aria-live': 'polite' });
  const err = h('div');
  const terms = h('div', { class: 'terms', 'aria-live': 'polite' });
  // SOW / contract upload: the extracted terms land in the box above for editing; nothing is held until the Hold step.
  const sowBox = h('div', { class: 'sow-box', id: 'sow-box', 'aria-live': 'polite' });
  const sowIn = h('input', { type: 'file', id: 'sow-file', accept: '.pdf,.docx,.txt,.md,application/pdf,text/plain,text/markdown', class: 'sr-only' });
  const sowBtn = h('label', { class: 'chip sow-chip', for: 'sow-file' }, ic('upload', 14), 'Upload SOW');
  chips.append(sowBtn, sowIn);
  sowIn.addEventListener('change', async () => {
    const f = sowIn.files[0]; sowIn.value = '';
    if (!f) return;
    if (!/\.(pdf|docx|txt|md)$/i.test(f.name)) { sowBox.replaceChildren(h('p', { class: 'field-error', role: 'alert' }, 'Upload a PDF, Word (.docx), .txt or .md file.')); return; }
    if (f.size > 2 * 1024 * 1024) { sowBox.replaceChildren(h('p', { class: 'field-error', role: 'alert' }, 'Files up to 2 MB only.')); return; }
    sowBox.replaceChildren(h('p', { class: 'waiting' }, h('span', { class: 'spinner' }), `Reading ${f.name}…`));
    try {
      const bytes = new Uint8Array(await f.arrayBuffer()); let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const r = await api.extract(f.name, btoa(bin));
      const byId = Object.fromEntries((r.quotes || []).map((q) => [q.milestone_id, q.quote]));
      sowBox.replaceChildren(h('div', { class: 'sow-preview' },
        h('h3', null, 'Extracted from your document'),
        h('p', { class: 'hint' }, `${f.name} · ${money(r.contract.hold.amount_cents, { compact: true })} · ${r.verification.ok ? 'verified' : 'needs fixes'}. Edit the terms above before you continue; no money is held yet.`),
        h('ol', null, r.contract.milestones.map((m) => h('li', null, h('strong', null, `${m.title} · ${money(m.amount_cents, { compact: true })}`), byId[m.id] ? h('q', null, byId[m.id]) : h('span', { class: 'hint' }, 'No matching sentence found in the document'))))));
      fill(r.text);
    } catch (e) { sowBox.replaceChildren(h('p', { class: 'field-error', role: 'alert' }, e.message || 'Could not read that file.')); }
  });

  const page = h('section', { class: 'page' },
    h('div', { class: 'compose-head enter' },
      h('h1', null, 'Describe the deal'),
      h('p', { class: 'lede' }, 'Plain English. PayPal holds the money; proof releases it.')),
    h('div', { class: 'compose-grid' },
      h('div', { class: 'card composer enter', style: { animationDelay: '.06s' } }, ta, chips, sowBox, terms, err,
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
    if (!p || !p.milestones.length) {
      if (preview._key === 'empty') return;
      preview._key = 'empty'; preview._els = null; preview._verified = false;
      preview.replaceChildren();
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
    const verified = !!(c && d.verification && d.verification.ok);
    const key = [rows.length, mode, verified, !!(c && d.attempts && d.attempts.length)].join('|');
    // Typing: same structure as last time -> update the text in place (no rebuild, no re-animation, no layout jump).
    if (!extra.animate && preview._key === key && preview._els) {
      const E = preview._els;
      E.title.textContent = c ? c.title : p.title;
      E.amount.firstChild.textContent = money(total).replace(/\.00$/, '');
      rows.forEach((r, i) => { const R = E.rows[i]; R.pct.textContent = r.pct + '%'; R.t.textContent = r.title; R.a.textContent = money(r.amount, { compact: true }); });
      return;
    }
    const wasVerified = preview._verified; preview._key = key; preview._verified = verified;
    preview.replaceChildren();
    const status = mode === 'compiling'
      ? h('span', { class: 'pill' }, h('span', { class: 'spinner', style: { width: '12px', height: '12px', borderWidth: '2px' } }), 'Checking every path…')
      : verified ? (() => { const b = verifiedBadge(d.verification); if (!wasVerified) b.classList.add('anim'); return b; })()
        : mode === 'error' ? h('span', { class: 'pill' }, 'Not readable yet') : h('span', { class: 'pill' }, 'Drafting');
    const list = h('div', { class: 'pv-list' });
    const amountEl = h('div', { class: 'pv-amount' }, document.createTextNode(money(total).replace(/\.00$/, '')), h('small', null, '.00'));
    const titleEl = h('div', { class: 'pv-title' }, c ? c.title : p.title);
    preview.append(
      h('div', { class: 'pv-head' }, h('span', { class: 'kicker' }, 'Contract preview'), status),
      titleEl, amountEl, list);
    const prevRows = preview._els ? preview._els.rows.length : 0;
    preview._els = { title: titleEl, amount: amountEl, rows: [] };
    rows.forEach((r, i) => {
      const t = h('span'), pct = h('span', { class: 'pct' }, r.pct + '%'), a = h('span', { class: 'a' }, money(r.amount, { compact: true }));
      // only rows that are new (or the first reveal from an example chip) rise in; existing rows stay still
      const row = h('div', { class: 'pv-row' + (extra.animate || i >= prevRows ? '' : ' still-row'), style: { animationDelay: extra.animate ? i * 220 + 'ms' : '0ms' } }, pct, t, a);
      preview._els.rows.push({ pct, t, a });
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
    if (ctl) ctl.abort();
    ctl = new AbortController();
    const signal = ctl.signal;
    renderPreview('compiling');
    const p = (async () => {
      try {
        const r = await api.compile(text, { typo: state.typoNext, signal });
        if (mine !== seq) return null;
        state.typoNext = false;
        Object.assign(state.draft, { contract: r.contract, verification: r.verification, attempts: r.attempts || [], source: r.source, compiledText: state.draft.text });
        renderPreview('verified'); updateBtn(); paintTerms();
        return r;
      } catch (e) {
        if (mine !== seq || e.name === 'AbortError') return null;
        renderPreview('error', { message: e.message });
        return null;
      }
    })();
    inflight = { text, p }; p.finally(() => { if (inflight && inflight.p === p) inflight = null; }); return p;
  }
  let ct = null;
  // Debounce: compile (Claude + verifier) once typing has paused for COMPILE_IDLE_MS; earlier requests are aborted.
  const compileSoon = () => { clearTimeout(ct); ct = setTimeout(compileNow, COMPILE_IDLE_MS); };

  // Terms check: refreshed only when typing pauses, and only repainted when the findings actually change.
  let termsSig = '';
  function paintTerms() {
    const issues = state.draft.parsed ? lintDeal(state.draft.text) : [];
    const sig = JSON.stringify(issues);
    if (sig === termsSig) return;
    termsSig = sig;
    if (!issues.length) { terms.replaceChildren(); return; }
    terms.replaceChildren(
      h('div', { class: 'terms-head' }, ic('sparkle', 16), h('b', null, 'Terms check'), h('span', null, issues.length === 1 ? 'One phrase could cause a dispute' : `${issues.length} phrases could cause a dispute`)),
      h('ul', null, issues.map((i) => h('li', null,
        h('span', { class: 'terms-txt' }, i.phrase ? h('q', null, i.phrase) : null, ' ', i.problem, ' ', h('span', { class: 'terms-sug' }, 'Try: ', h('q', null, i.replace || i.append.replace(/^;\s*/, '')))),
        h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { ta.value = applyFix(ta.value, i); onInput(false); ta.focus(); } }, 'Use this')))));
    window.dispatchEvent(new CustomEvent('pactline:terms', { detail: { count: issues.length } }));
  }

  function updateBtn() {
    const ok = state.draft.parsed && state.draft.parsed.milestones.length > 0;
    go.disabled = !ok;
  }

  function onInput(animate) {
    const text = ta.value;
    if (animate !== true && text === state.draft.text && state.draft.parsed) return; // no real change
    state.draft.text = text;
    if (ctl) { ctl.abort(); ctl = null; } inflight = null;
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
  renderPreview(state.draft.contract ? 'verified' : 'drafting'); updateBtn(); paintTerms();
  if (!RM()) setTimeout(() => ta.focus({ preventScroll: true }), 120); else ta.focus({ preventScroll: true });

  return { destroy() { typers.forEach((t) => t.cancel()); seq++; clearTimeout(ct); if (ctl) ctl.abort(); } };
}
