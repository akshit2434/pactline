// Demo mode: auto-plays the happy path on the in-browser engine, with big captions and a ghost cursor.
// Hotkey D. Add ?demo=1 to start on load, &speed=2 to run faster while testing.
import { $, sleep, RM } from './util.js';
import { engine } from './api.js';
import { state, nav } from './state.js';
import { DEMO_TEXT } from './parse.js';
import { refreshChrome, subscribeEvents, getCurrent } from './app.js';

const params = new URLSearchParams(location.search);
const SPEED = Math.max(0.25, parseFloat(params.get('speed')) || 1);
const TOTAL = 118; // seconds, planned length at speed 1
let run = null;

class Aborted extends Error {}
export const demoActive = () => !!run;
export const toggleDemo = () => (run ? stopDemo() : startDemo());

const cap = () => $('#caption'), ghost = () => $('#ghost');

function say(text) {
  console.debug('[demo]', Math.round(run ? run.t / 1000 : 0) + 's', text);
  const c = cap(); c.hidden = false;
  const html = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
  c.firstElementChild.innerHTML = html;
  c.classList.remove('in'); void c.offsetWidth; c.classList.add('in');
}

async function wait(ms) {
  let left = ms / SPEED;
  while (left > 0) {
    if (!run || run.cancelled) throw new Aborted();
    const step = Math.min(50, left);
    await sleep(step);
    if (!run.paused) { left -= step; run.t += step * SPEED; progress(); }
  }
  if (!run || run.cancelled) throw new Aborted();
}
function progress() { const p = $('#demo-progress').firstElementChild; p.style.width = Math.min(100, (run.t / 1000 / TOTAL) * 100) + '%'; }

async function waitFor(fn, timeout = 15000) {
  const t0 = performance.now();
  for (;;) {
    if (!run || run.cancelled) throw new Aborted();
    const v = fn(); if (v) return v;
    if (performance.now() - t0 > timeout) throw new Error('demo: timed out waiting');
    await sleep(60);
  }
}
const find = (sel) => () => document.querySelector(sel);

async function moveTo(el, ms = 800) {
  const g = ghost(); g.hidden = false;
  el.scrollIntoView({ block: 'center', behavior: RM() ? 'auto' : 'smooth' });
  await wait(RM() ? 0 : 260);
  const r = el.getBoundingClientRect();
  g.style.transitionDuration = (RM() ? 0 : ms / SPEED) + 'ms';
  g.style.transform = `translate(${Math.round(r.left + Math.min(r.width * 0.6, r.width - 8))}px, ${Math.round(r.top + r.height * 0.6)}px)`;
  await wait(RM() ? 0 : ms);
}
async function click(target, { settle = 250 } = {}) {
  const el = typeof target === 'string' ? await waitFor(find(target)) : target;
  await moveTo(el);
  const g = ghost(); g.classList.add('click'); setTimeout(() => g.classList.remove('click'), 520);
  await wait(160);
  el.click();
  await wait(settle);
}

async function typeText(ta, text, cps = 60) {
  await moveTo(ta, 600);
  ta.focus();
  for (let i = 1; i <= text.length; i += RM() ? text.length : 1) {
    ta.value = text.slice(0, i);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(1000 / cps);
  }
}

function fakeScreenshot() {
  const cv = document.createElement('canvas'); cv.width = 960; cv.height = 600;
  const x = cv.getContext('2d');
  x.fillStyle = '#F3F6FA'; x.fillRect(0, 0, 960, 600);
  x.fillStyle = '#fff'; x.fillRect(0, 0, 960, 56); x.fillStyle = '#003087'; x.fillRect(32, 18, 90, 20);
  x.fillStyle = '#C8D3E4'; [520, 620, 720, 820].forEach((px) => x.fillRect(px, 22, 60, 12));
  x.fillStyle = '#0B1B3A'; x.fillRect(64, 110, 520, 34); x.fillRect(64, 158, 380, 34);
  x.fillStyle = '#8A99B3'; x.fillRect(64, 214, 460, 12); x.fillRect(64, 238, 420, 12);
  x.fillStyle = '#0070E0'; x.beginPath(); x.roundRect(64, 276, 180, 48, 24); x.fill();
  x.fillStyle = '#E1E7EF'; x.beginPath(); x.roundRect(640, 96, 260, 240, 24); x.fill();
  [0, 1, 2].forEach((i) => { x.fillStyle = '#fff'; x.beginPath(); x.roundRect(64 + i * 292, 370, 272, 150, 20); x.fill(); x.fillStyle = i === 1 ? '#0070E0' : '#C8D3E4'; x.fillRect(86 + i * 292, 394, 90, 14); x.fillStyle = '#0B1B3A'; x.fillRect(86 + i * 292, 424, 120, 26); x.fillStyle = '#C8D3E4'; x.fillRect(86 + i * 292, 470, 200, 10); x.fillRect(86 + i * 292, 490, 160, 10); });
  x.fillStyle = '#0B1B3A'; x.fillRect(0, 556, 960, 44); x.fillStyle = '#8DB8FF'; x.fillRect(64, 574, 300, 8);
  return new Promise((res) => cv.toBlob((b) => res(new File([b], 'homepage-design.png', { type: 'image/png' })), 'image/png'));
}

async function script() {
  // 1 · hook
  say('Will I get *paid*? Will it get *done*?');
  await wait(4200);
  say('Describe the deal. *Plain English.*');
  state.typoNext = true;
  await typeText($('#deal-text'), DEMO_TEXT, 62);
  await wait(900);

  // 2 · AI contract + verifier
  say('AI drafts the contract. A *verifier* checks every path.');
  await waitFor(find('.fix-note'), 20000);
  await wait(900);
  say('It caught a typo: 30 + 50 + 30 is *110%*. Fixed before anyone saw it.');
  await wait(4600);
  await click('.verified button', { settle: 300 });
  say('*214 paths.* Money is conserved on every one.');
  await wait(3600);
  await click('.verified button', { settle: 200 });

  // 3 · review
  await click('#to-review', { settle: 300 });
  await waitFor(find('#hold-btn'));
  say('Three milestones. Each has a clear *trigger*.');
  await wait(3200);
  await click('.ms-card', { settle: 200 });
  say('A URL check, an AI judge, or a timer decides.');
  await wait(3400);

  // 4 · hold
  say('The client holds *$1,200 with PayPal*. Pactline never touches it.');
  await click('#hold-btn', { settle: 200 });
  await waitFor(find('#continue-pp'), 20000);
  await wait(2200);
  await click('#continue-pp', { settle: 200 });
  await waitFor(find('#pp-approve'));
  say('Approve once. It is a *hold*, not a charge.');
  await wait(2600);
  await click('#pp-approve', { settle: 200 });
  await waitFor(find('#open-deal'), 20000);
  say('*$1,200 held* by PayPal.');
  await wait(3600);
  await click('#open-deal', { settle: 300 });

  // 5 · live deal
  await waitFor(find('#hero-amt'));
  say('Nothing is paid until *proof passes*.');
  await wait(3600);
  const view = () => getCurrent() && getCurrent().api;
  await click('[data-role="freelancer"]', { settle: 300 });
  say('Ava ships the staging site and shares the link.');
  await wait(2400);
  await click('#submit-m1', { settle: 200 });
  say('URL check passes. *30% releases* from the hold.');
  await waitFor(find('li[data-mid="m1"].s-RELEASED'), 15000);
  await wait(3800);

  // 6 · AI proof
  say('Now the design. Ava *drops in a screenshot*.');
  const zone = await waitFor(find('#drop-m2'));
  await moveTo(zone);
  const file = await fakeScreenshot();
  const dt = new DataTransfer(); dt.items.add(file);
  zone.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  await waitFor(find('#drop-m2 img'));
  await wait(1800);
  await click('#submit-m2', { settle: 200 });
  say('Claude reads it against the brief.');
  await waitFor(find('li[data-mid="m2"].s-RELEASED'), 20000);
  await wait(1200);
  say('*94% match.* 50% releases. Tap the chip for the reasons.');
  await click('li[data-mid="m2"] .verdict button', { settle: 200 });
  await wait(4200);
  await click('li[data-mid="m2"] .verdict button', { settle: 200 });

  // 7 · timer + completion
  say('Last 20%: *7 days with no bugs*. Skip ahead.');
  await wait(2400);
  await click('#skip-days', { settle: 200 });
  await waitFor(find('.hero.done'), 15000);
  say('*$1,200 released.* Nothing left held. Receipts sent.');
  await wait(5200);

  // 8 · ledger
  await click('#open-ledger', { settle: 300 });
  await waitFor(find('.tl .item button'));
  say('Every PayPal call, on the record.');
  await wait(3200);
  const cap1 = [...document.querySelectorAll('.tl .item button')].find((b) => /Released to freelancer/.test(b.textContent));
  if (cap1) { await click(cap1, { settle: 300 }); say('Capture IDs. Debug IDs. Webhooks. Receipts.'); await wait(4800); }
  const tbl = [...document.querySelectorAll('.seg button')].find((b) => b.textContent === 'Table');
  if (tbl) { await click(tbl, { settle: 300 }); say('Auditable like a bank statement.'); await wait(3800); }

  // 9 · close
  say('*Pactline.* Deals that pay themselves, held by PayPal.');
  await wait(5200);
}

export async function startDemo() {
  if (run) return;
  run = { cancelled: false, paused: false, t: 0, wall0: performance.now() };
  state.demo = true;
  engine.useMock(SPEED); subscribeEvents();
  Object.assign(state, { deal: null, ledger: [], role: 'client', pendingContract: null, draft: { text: '', parsed: null, contract: null, verification: null, attempts: [], source: null, compiledText: null } });
  document.body.classList.add('demo-on');
  $('#demo-progress').hidden = false; $('#demo-ctl').hidden = false; progress();
  const pb = $('#demo-pause'); pb.textContent = 'Pause';
  pb.onclick = () => { run.paused = !run.paused; pb.textContent = run.paused ? 'Resume' : 'Pause'; };
  $('#demo-stop').onclick = () => stopDemo();
  refreshChrome();
  nav('#/');
  try { await wait(300); await script(); } catch (e) { if (!(e instanceof Aborted)) { console.error(e); say('Demo stopped: ' + e.message); await sleep(2500); } }
  if (run && !run.cancelled) { await sleep(600); endDemo(); }
}

function endDemo() {
  if (!run) return;
  console.info('[demo] finished after', Math.round((performance.now() - run.wall0) / 1000) + 's of wall time');
  run.cancelled = true; run = null;
  state.demo = false;
  document.body.classList.remove('demo-on');
  cap().hidden = true; ghost().hidden = true; $('#demo-progress').hidden = true; $('#demo-ctl').hidden = true;
  engine.useReal(); subscribeEvents();
  refreshChrome();
}
export function stopDemo() {
  const wasRunning = !!run;
  endDemo();
  if (wasRunning) { Object.assign(state, { deal: null }); location.hash = '#/'; window.dispatchEvent(new HashChangeEvent('hashchange')); }
}
