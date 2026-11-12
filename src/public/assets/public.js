// Public judge demo additions (served only when PACTLINE_PUBLIC=1; injected by the server, the app code is unchanged).
// 1) Shows the PayPal sandbox test buyer on the hold step so a judge can approve the real sandbox hold.
// 2) Surfaces server notices (rate limits, Claude budget fallback) as a visible note.

let cfg = null;
const cfgP = fetch('/api/public/config', { credentials: 'same-origin' }).then((r) => r.json()).then((c) => (cfg = c)).catch(() => null);

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'onclick') e.addEventListener('click', v); else e.setAttribute(k, v); }
  for (const k of kids) if (k != null) e.append(k);
  return e;
}

let noticeTimer = null;
function notice(text) {
  let n = document.querySelector('.pl-notice');
  if (!n) { n = el('div', { class: 'pl-notice', role: 'status', 'aria-live': 'polite' }); document.body.append(n); }
  n.textContent = text; n.hidden = false;
  clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { n.hidden = true; }, 9000);
}

// Server notices travel in a response header; show them without touching the app's own code.
const realFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const res = await realFetch(...args);
  try {
    const n = res.headers.get('x-pactline-notice');
    if (n) notice(n);
    else if (res.status === 429) { const b = await res.clone().json().catch(() => null); notice((b && b.error) || 'Too many requests. Please wait a few minutes.'); }
  } catch { /* ignore */ }
  return res;
};

function copyBtn(value, label) {
  return el('button', { type: 'button', 'aria-label': `Copy ${label}`, onclick: async (e) => {
    try { await navigator.clipboard.writeText(value); e.target.textContent = 'Copied'; setTimeout(() => (e.target.textContent = 'Copy'), 1500); } catch { /* clipboard blocked */ }
  } }, 'Copy');
}

function buyerBox() {
  const b = cfg && cfg.sandbox_buyer;
  const box = el('section', { class: 'pl-buyer', 'aria-label': 'PayPal sandbox test buyer' },
    el('h2', {}, b ? 'Approve as the PayPal sandbox test buyer' : 'Approve in the PayPal sandbox'),
    el('p', {}, b ? 'PayPal Sandbox: no real money. Log in on the PayPal page with this test account:' : 'PayPal Sandbox: no real money. Log in with any PayPal sandbox personal account, or use the simulated demo below.'));
  if (b) {
    box.append(el('dl', {},
      el('dt', {}, 'Email'), el('dd', {}, b.email), copyBtn(b.email, 'email'),
      el('dt', {}, 'Password'), el('dd', {}, b.password), copyBtn(b.password, 'password')));
  }
  box.append(el('p', { class: 'pl-alt' }, 'No PayPal login? ', el('a', { href: cfg ? cfg.try_demo_url : '/?demo=1' }, 'Try the simulated demo'), '.'));
  return box;
}

function decorate() {
  const card = document.querySelector('.card.hold');
  if (!card || card.querySelector('.pl-buyer')) return;
  const realPayPal = /PayPal sandbox/i.test(document.querySelector('#status-pill')?.textContent || '');
  const approving = card.querySelector('#continue-pp') || card.querySelector('.waiting');
  if (!realPayPal || !approving) return;
  card.append(buyerBox());
}

cfgP.then(() => {
  decorate();
  new MutationObserver(() => decorate()).observe(document.getElementById('view') || document.body, { childList: true, subtree: true });
  new MutationObserver(() => decorate()).observe(document.getElementById('status-pill') || document.body, { childList: true, subtree: true, characterData: true });
});
