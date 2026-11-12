import { h, ic, $, clear } from './util.js';
import { engine, api } from './api.js';
import { state, nav } from './state.js';
import * as compose from './views/compose.js';
import * as review from './views/review.js';
import * as hold from './views/hold.js';
import * as deal from './views/deal.js';
import * as ledger from './views/ledger.js';
import { startDemo, stopDemo, toggleDemo, demoActive } from './demo.js';
import { DEMO_TEXT, parseDeal } from './parse.js';

const params = new URLSearchParams(location.search);
const view = $('#view');
if (params.get('still')) document.documentElement.classList.add('still'); // dev: freeze motion for screenshots
let current = null, unsub = null;

const STEPS = [['compose', 'Describe'], ['review', 'Review'], ['hold', 'Hold'], ['deal', 'Live']];

function paintSteps(name) {
  const idx = STEPS.findIndex((s) => s[0] === name);
  $('#steps').replaceChildren(...STEPS.map(([k, label], i) => h('span', { class: 's ' + (idx === i ? 'on' : idx > i || name === 'ledger' ? 'done' : ''), 'aria-current': idx === i ? 'step' : null }, h('i'), h('span', null, label))));
}
function paintStatus() {
  const p = $('#status-pill');
  const live = engine.mode === 'real' && engine.api.statusInfo && engine.api.statusInfo.paypal === 'live';
  p.className = 'pill status ' + (state.demo ? 'demo' : live ? 'live' : '');
  p.replaceChildren(h('i', { class: 'dot' }), h('span', null, state.demo ? 'Demo mode · simulated' : live ? 'PayPal sandbox' : engine.mode === 'real' ? 'PayPal mock' : 'Offline preview'));
}
function paintTheme() {
  const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  $('#theme-btn').replaceChildren(ic(dark ? 'sun' : 'moon', 18));
}
function paintDemoBtn() {
  const b = $('#demo-btn'); b.setAttribute('aria-pressed', String(state.demo));
  b.replaceChildren(ic(state.demo ? 'pause' : 'play', 14), state.demo ? 'Stop demo' : 'Demo', h('kbd', null, 'D'));
}
export function refreshChrome() { paintStatus(); paintDemoBtn(); }

const routes = {
  compose: (m) => compose.mount(m),
  review: (m) => review.mount(m),
  hold: (m, p) => hold.mount(m, p),
  deal: (m, p) => deal.mount(m, p),
  ledger: (m, p) => ledger.mount(m, p),
};

function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [seg, id] = hash.split('/');
  let name = 'compose', p = {};
  if (seg === 'review') name = 'review';
  else if (seg === 'hold' && id) { name = 'hold'; p = { id }; }
  else if (seg === 'deal' && id) { name = 'deal'; p = { id }; }
  else if (seg === 'ledger') { name = 'ledger'; p = { id }; }
  if (current && current.destroy) current.destroy();
  clear(view);
  window.scrollTo(0, 0);
  paintSteps(name);
  $('#ledger-link').hidden = !(state.deal || name === 'ledger');
  $('#ledger-link').href = '#/ledger' + (state.deal ? '/' + state.deal.id : '');
  current = routes[name](view, p) || {};
  document.title = { compose: 'Describe the deal', review: 'Review contract', hold: 'Hold funds', deal: 'Live deal', ledger: 'Audit trail' }[name] + ' · Pactline';
  view.focus({ preventScroll: true });
}

export function subscribeEvents() {
  if (unsub) unsub();
  unsub = engine.api.onEvent((e) => { if (current && current.onEvent) current.onEvent(e); });
}
export const getCurrent = () => current;

async function boot() {
  await engine.init();
  state.info = await api.status().catch(() => null);
  if (params.get('typo') === '1') state.typoNext = true;
  if (params.get('role') === 'freelancer') state.role = 'freelancer';

  // Returning from PayPal (full redirect) or from a popup.
  if (params.get('funded') && params.get('deal')) {
    const did = params.get('deal');
    if (window.opener && window.opener !== window) { try { window.opener.postMessage({ pactline: 'funded', deal: did }, location.origin); } catch { /* ignore */ } window.close(); }
    state.justFunded = did;
    history.replaceState(null, '', location.pathname); location.hash = '#/hold/' + did;
  } else if (params.get('seed')) {
    const d = await api.seed(params.get('seed'));
    state.deal = d; if (params.get('view')) state.ledgerView = params.get('view'); history.replaceState(null, '', location.pathname);
    location.hash = params.get('then') === 'ledger' ? '#/ledger/' + d.id : d.status === 'AWAITING_FUNDING' || d.status === 'DRAFT' ? '#/hold/' + d.id : '#/deal/' + d.id;
  } else if (params.get('deal')) {
    location.hash = '#/deal/' + params.get('deal');
  }

  const scr = params.get('screen'); // dev helper: ?screen=filled|review|hold
  if (scr) {
    const r = await api.compile(DEMO_TEXT, { typo: params.get('typo') === '1' });
    Object.assign(state.draft, { text: DEMO_TEXT, parsed: parseDeal(DEMO_TEXT), contract: r.contract, verification: r.verification, attempts: r.attempts || [], source: r.source, compiledText: DEMO_TEXT });
    if (scr === 'review') location.hash = '#/review';
    if (scr === 'hold') { state.pendingContract = r.contract; location.hash = '#/hold/new'; }
  }

  subscribeEvents();
  refreshChrome();
  window.addEventListener('hashchange', route);
  route();
  if (params.get('demo') === '1') setTimeout(() => startDemo(), 400);
}

$('#theme-btn').addEventListener('click', () => {
  const root = document.documentElement;
  const dark = root.dataset.theme === 'dark' || (!root.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('pl-theme', root.dataset.theme); } catch { /* private mode */ }
  paintTheme();
});
$('#demo-btn').addEventListener('click', () => toggleDemo());
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return;
  if (e.key === 'd' || e.key === 'D') { e.preventDefault(); toggleDemo(); }
  if (e.key === 'Escape' && demoActive()) stopDemo();
});
paintTheme(); paintDemoBtn();
boot();
