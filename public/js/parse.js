// Instant, offline parse of a plain-English deal: powers the live preview and the mock compiler.
export const DEMO_TEXT =
  'Landing page, $1,200: 30% when the staging URL is live, 50% when the design matches the mockup, 20% after 7 days with no open bugs; refund if not delivered by 30 Nov.';

export const EXAMPLES = [
  { label: 'Landing page, $1,200', text: DEMO_TEXT },
  { label: 'Logo kit, $800', text: 'Logo and brand kit, $800: 50% when the first concepts are shared, 50% when the final files are approved; void the rest if not delivered by 21 Nov.' },
  { label: 'App MVP, $4,500', text: 'Mobile app MVP, $4,500: 20% when the wireframes are approved, 25% when the pull request northwind/app#42 is merged, 35% when the beta build matches the designs, 20% after 14 days with no open bugs.' },
];

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function inferOracle(t) {
  const s = t.toLowerCase();
  if (/\burl\b|\blive\b|\bwebsite\b|\bsite is\b/.test(s)) return { type: 'url', url: 'https://staging.example.com', contains: 'Northwind' };
  if (/pull request|\bpr\b|merged/.test(s)) return { type: 'github_pr', repo: 'northwind/app', number: 42 };
  const d = s.match(/(\d+)\s*days?/);
  if (d) return { type: 'deadline', after_days: +d[1], after: null };
  if (/approve|sign.?off|manual/.test(s) && !/design|mockup|screens?/.test(s)) return { type: 'manual' };
  return { type: 'evidence' };
}

export function parseDeal(text) {
  const money = text.match(/\$\s?([\d,]+(?:\.\d{1,2})?)\s*(k\b)?/i);
  if (!money) return null;
  let amt = parseFloat(money[1].replace(/,/g, ''));
  if (money[2]) amt *= 1000;
  const total = Math.round(amt * 100);
  const titleRaw = text.slice(0, money.index).replace(/[,:\s-]+$/, '').trim();
  const title = cap(titleRaw || 'Untitled deal');
  const after = text.slice(money.index + money[0].length);
  const body = after.replace(/^\s*[:,-]?\s*/, '');
  const parts = body.split(/;|\bthen\b|,(?=\s*\d+\s*%)/i).map((p) => p.trim()).filter(Boolean);
  const milestones = [];
  let timeout = null;
  for (const p of parts) {
    const m = p.match(/(\d+(?:\.\d+)?)\s*%\s*(?:when|after|on|upon|once|if)?\s*(.*)$/i);
    if (m && m[2]) {
      let t = m[2].replace(/[.,]+$/, '').replace(/^the\s+/i, '').trim();
      milestones.push({ title: cap(t), share_pct: +m[1], oracle: inferOracle(t) });
    } else {
      const d = p.match(/by\s+(\d{1,2})\s*([A-Za-z]{3,})/);
      if (d) timeout = { day: +d[1], label: `${d[1]} ${cap(d[2].slice(0, 3))}` };
    }
  }
  return { title, total_cents: total, milestones, timeout };
}

export function toContract(p, { client = 'Northwind Traders', freelancer = 'Ava Designer' } = {}) {
  let after = null;
  const ms = p.milestones.map((m, i) => {
    const o = { ...m.oracle };
    if (o.type === 'deadline') o.after = after;
    const id = 'm' + (i + 1);
    const out = {
      id, title: m.title, share_pct: m.share_pct,
      amount_cents: Math.round((p.total_cents * m.share_pct) / 100),
      depends_on: i ? ['m' + i] : [], oracle: o,
      criteria: criteriaFor(m.title, o),
    };
    after = id;
    return out;
  });
  return {
    title: p.title, currency: 'USD',
    client: { name: client, email: 'ap@northwind.example' },
    freelancer: { name: freelancer, email: 'ava@studio.example' },
    hold: { amount_cents: p.total_cents, window_days: 29 },
    deadline: { day: p.timeout ? p.timeout.day : 30, on_timeout: 'void_remainder' },
    milestones: ms,
  };
}

function criteriaFor(title, o) {
  if (o.type === 'url') return `${o.url} answers 200 and shows "${o.contains}".`;
  if (o.type === 'deadline') return `${o.after_days} days pass with nothing reported.`;
  if (o.type === 'github_pr') return `Pull request ${o.repo}#${o.number} is merged.`;
  if (o.type === 'manual') return 'The client confirms it is done.';
  return `Photo or screenshot shows: ${title.toLowerCase()}.`;
}

export const ORACLE_LABEL = {
  url: 'URL check', evidence: 'AI vision', deadline: 'Timer', github_pr: 'GitHub PR', manual: 'Client approves',
};
export const ORACLE_ICON = { url: 'link', evidence: 'image', deadline: 'hour', github_pr: 'github', manual: 'hand' };
