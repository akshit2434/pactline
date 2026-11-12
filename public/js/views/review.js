import { h, ic, money, initials } from '../util.js';
import { state, nav } from '../state.js';
import { ORACLE_LABEL, ORACLE_ICON } from '../parse.js';
import { verifiedBadge } from '../components.js';

export function mount(root) {
  const d = state.draft;
  if (!d.contract) { nav('#/'); return {}; }
  const c = d.contract;
  const err = h('div');
  const hold = h('button', { class: 'btn primary lg', type: 'button', id: 'hold-btn' }, ic('lock', 18), 'Hold funds with PayPal');
  hold.addEventListener('click', () => {
    hold.classList.add('busy');
    state.pendingContract = c;
    nav('#/hold/new');
  });

  const cards = c.milestones.map((m, i) => {
    let open = false;
    const more = h('div', { class: 'ms-more', hidden: true },
      h('span', null, m.criteria),
      h('span', { class: 'mono', style: { fontSize: '12.5px', color: 'var(--ink-3)' } }, oracleLine(m.oracle)));
    const card = h('button', { class: 'ms-card', type: 'button', 'aria-expanded': 'false', style: { animationDelay: 80 + i * 90 + 'ms' } },
      h('span', { class: 'ring', style: { '--p': m.share_pct } }, h('b', null, m.share_pct + '%')),
      h('span', { class: 'ms-main' }, h('span', { class: 't' }, m.title), h('span', { class: 'how' }, ic(ORACLE_ICON[m.oracle.type] || 'check', 15), ORACLE_LABEL[m.oracle.type] || 'Check')),
      h('span', { class: 'ms-amt' }, money(m.amount_cents, { compact: true })));
    const li = h('li', { style: { listStyle: 'none' } }, card, more);
    card.addEventListener('click', () => { open = !open; more.hidden = !open; card.setAttribute('aria-expanded', open); });
    return li;
  });

  root.append(h('section', { class: 'page' }, h('div', { class: 'narrow' },
    h('div', { class: 'review-head enter' },
      h('span', { class: 'kicker' }, 'Review contract'),
      h('h1', null, c.title),
      h('div', { class: 'parties' }, h('span', { class: 'av' }, initials(c.client.name)), c.client.name, h('span', { class: 'arrow' }, ic('arrow', 16)), h('span', { class: 'av alt' }, initials(c.freelancer.name)), c.freelancer.name)),
    h('div', { class: 'total enter', style: { animationDelay: '.05s' } },
      h('div', { class: 'hero-amt' }, money(c.hold.amount_cents).replace(/\.00$/, ''), h('small', null, '.00')),
      h('div', { class: 'sub' }, ic('lock', 18), 'held by PayPal, released milestone by milestone')),
    h('ul', { class: 'ms-list', style: { margin: 0, padding: 0 } }, cards),
    h('div', { class: 'review-foot' },
      h('div', { style: { display: 'flex', justifyContent: 'center' } }, verifiedBadge(d.verification, `Verified · ${d.verification.paths} paths, money always conserved`)),
      err, hold,
      h('div', { class: 'trust' }, 'Nobody but PayPal ever holds the funds.'),
      h('div', { style: { textAlign: 'center' } }, h('a', { class: 'link', href: '#/' }, 'Edit the deal'))))));
  return {};
}

function oracleLine(o) {
  if (o.type === 'url') return `GET ${o.url} · contains "${o.contains || ''}"`;
  if (o.type === 'deadline') return `timer · ${o.after_days} days${o.after ? ' after ' + o.after : ''}`;
  if (o.type === 'github_pr') return `${o.repo}#${o.number} merged`;
  return o.type;
}
