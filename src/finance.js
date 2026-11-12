// Pure helpers: dates, money, invoice state and dashboard maths. No I/O, easy to test.

export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => ymd(new Date());

export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return ymd(dt);
}

export function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export const money = (n) => (Math.round(Number(n) * 100) / 100).toFixed(2);

/**
 * Derive a dashboard state from a normalised invoice.
 * draft | cancelled | paid | overdue | outstanding
 */
export function invoiceState(inv, now = today()) {
  const s = String(inv.status || '').toUpperCase();
  if (s === 'DRAFT' || s === 'SCHEDULED') return 'draft';
  if (s === 'CANCELLED' || s === 'REFUNDED' || s === 'MARKED_AS_REFUNDED') return 'cancelled';
  if (s === 'PAID' || s === 'MARKED_AS_PAID') return 'paid';
  if (inv.total > 0 && inv.due <= 0) return 'paid';
  if (inv.dueDate && inv.dueDate < now) return 'overdue';
  return 'outstanding';
}

export function dashboard(invoices, now = today()) {
  const rows = invoices.map((i) => ({ ...i, state: invoiceState(i, now) }));
  const sum = (arr, f) => arr.reduce((t, x) => t + f(x), 0);
  const live = rows.filter((r) => r.state === 'outstanding' || r.state === 'overdue');
  const overdue = rows.filter((r) => r.state === 'overdue');
  const paid = rows.filter((r) => r.state !== 'cancelled' && r.state !== 'draft' && (r.state === 'paid' || r.paid > 0));
  const drafts = rows.filter((r) => r.state === 'draft');

  const buckets = [{ key: 'overdue', label: 'Overdue', from: null, to: -1, amount: 0, count: 0 }];
  for (let w = 0; w < 6; w++) {
    buckets.push({
      key: `w${w}`,
      label: w === 0 ? 'This week' : w === 1 ? 'Next week' : `In ${w} wks`,
      from: w * 7, to: w * 7 + 6, amount: 0, count: 0,
    });
  }
  buckets.push({ key: 'later', label: 'Later', from: 42, to: null, amount: 0, count: 0 });
  for (const inv of live) {
    const off = daysBetween(now, inv.dueDate || now);
    const b = buckets.find((x) => (x.from === null ? off <= x.to : x.to === null ? off >= x.from : off >= x.from && off <= x.to));
    if (b) { b.amount += inv.due; b.count += 1; }
  }
  for (const b of buckets) b.amount = Math.round(b.amount * 100) / 100;

  const next30 = live.filter((i) => daysBetween(now, i.dueDate || now) <= 30).reduce((t, i) => t + i.due, 0);
  return {
    kpis: {
      outstanding: Math.round(sum(live, (i) => i.due) * 100) / 100,
      outstandingCount: live.length,
      overdue: Math.round(sum(overdue, (i) => i.due) * 100) / 100,
      overdueCount: overdue.length,
      paid: Math.round(sum(paid, (i) => i.paid) * 100) / 100,
      paidCount: paid.length,
      drafts: drafts.length,
      draftValue: Math.round(sum(drafts, (i) => i.total) * 100) / 100,
      expected30: Math.round(next30 * 100) / 100,
    },
    forecast: buckets,
    invoices: rows,
  };
}

/** Case-insensitive fuzzy match of a name against a list of {name}. */
export function matchClient(clients, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return null;
  const exact = clients.find((c) => c.name.toLowerCase() === q);
  if (exact) return exact;
  const starts = clients.filter((c) => c.name.toLowerCase().startsWith(q) || q.startsWith(c.name.toLowerCase()));
  if (starts.length === 1) return starts[0];
  const has = clients.filter((c) => c.name.toLowerCase().includes(q) || q.includes(c.name.toLowerCase().split(' ')[0]));
  return has.length === 1 ? has[0] : null;
}
