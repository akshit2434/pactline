// Small DOM + formatting helpers (no framework).
export const RM = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('still');

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const raf = (f) => (document.hidden ? setTimeout(() => f(performance.now()), 16) : requestAnimationFrame(f));
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

const ICONS = {
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  clock: 'M12 7v5l3 2M12 21a9 9 0 100-18 9 9 0 000 18z',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3A4 4 0 0011 18.7l1-1',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M9 9.5a.5.5 0 100-1 .5.5 0 000 1',
  github: 'M9 19c-4 1.3-4-2-6-2.5M15 21v-3.2a2.8 2.8 0 00-.8-2.2c2.7-.3 5.5-1.3 5.5-6a4.6 4.6 0 00-1.3-3.2 4.3 4.3 0 00-.1-3.2s-1-.3-3.3 1.3a11.400 11.400 0 00-6 0C6.700 2.900 5.700 3.200 5.700 3.200a4.300 4.300 0 00-.1 3.200A4.600 4.600 0 004.300 9.600c0 4.600 2.800 5.700 5.500 6a2.800 2.800 0 00-.8 2.200V21',
  hand: 'M8 11V6a1.500 1.500 0 013 0v4m0-1V4.500a1.500 1.500 0 013 0V10m0-3.500a1.500 1.500 0 013 0V14a7 7 0 01-7 7h-1a6 6 0 01-4.500-2L4 15l1-1a1.500 1.500 0 012 0l1 1',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  shield: 'M12 3l7 3v5c0 5-3 8.500-7 10-4-1.500-7-5-7-10V6zM9 12l2.200 2.200L15.500 10',
  lock: 'M6 11h12v9H6zM8.500 11V8a3.500 3.500 0 017 0v3',
  doc: 'M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5',
  pause: 'M9 6v12M15 6v12',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3',
  hour: 'M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9',
  sparkle: 'M12 3l1.800 5.200L19 10l-5.200 1.800L12 17l-1.800-5.200L5 10l5.200-1.800zM18 16l.8 2.200L21 19l-2.200.8L18 22l-.8-2.200L15 19l2.200-.8z',
  play: 'M7 5l12 7-12 7z',
  moon: 'M20 14.500A8 8 0 019.500 4 8 8 0 1020 14.500z',
  sun: 'M12 16a4 4 0 100-8 4 4 0 000 8zM12 2v2M12 20v2M4.900 4.900l1.400 1.400M17.700 17.700l1.400 1.400M2 12h2M20 12h2M4.900 19.100l1.400-1.400M17.700 6.300l1.400-1.400',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  table: 'M3 5h18v14H3zM3 10h18M9 5v14',
  chev: 'M9 6l6 6-6 6',
  copy: 'M9 9h11v11H9zM5 15V4h10',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-4.500-4.500',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  bolt: 'M13 3L5 14h6l-1 7 8-11h-6z',
};
export function ic(name, size = 18, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2');
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
  s.setAttribute('class', 'ic ' + cls);
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', ICONS[name] || ''); s.append(p);
  return s;
}

export const money = (c, opts = {}) => {
  const v = (c || 0) / 100;
  const whole = opts.compact && Number.isInteger(v);
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
};
export const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
export const initials = (n) => (n || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

// Count a numeric element from a to b (cents) with easing.
export function countTo(el, from, to, ms = 700, fmt = money) {
  if (RM() || from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(Math.round(from + (to - from) * e));
    if (p < 1) raf(step);
  };
  raf(step);
}

// Type text into an element, resolving when done. cancel() stops early.
export function typeInto(el, text, cps = 55) {
  if (RM()) { el.textContent = text; return { done: Promise.resolve(), cancel() {} }; }
  let i = 0, stop = false;
  el.textContent = '';
  const done = new Promise((res) => {
    const tick = () => {
      if (stop) return res();
      i += cps > 120 ? 3 : 1;
      el.textContent = text.slice(0, i);
      if (i < text.length) setTimeout(tick, 1000 / cps);
      else res();
    };
    tick();
  });
  return { done, cancel() { stop = true; el.textContent = text; } };
}

export function toast(msg, kind = '') {
  const box = document.getElementById('toasts');
  const t = h('div', { class: 'toast ' + kind, role: 'status' }, kind === 'ok' ? ic('check', 16) : null, msg);
  box.append(t);
  raf(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, 3200);
}

export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
