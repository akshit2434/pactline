// Ledger as an AG Grid Community table. Vendored (public/vendor/ag-grid), no CDN, loaded only when the Grid view opens.
// Community has no master/detail, so row expansion uses full-width rows: an open record adds one detail row right under it.
import { h, ic, money, fmtTime, toast, RM } from '../util.js';
import { srSay } from '../components.js';

const SRC = 'vendor/ag-grid/ag-grid-community.min.js';
let loading = null;
const DISABLED = new URLSearchParams(location.search).get('nogrid') === '1'; // read at import: the app clears the query string later

// Resolves with the agGrid global, or rejects so the caller can fall back to the plain table.
export function loadAgGrid() {
  if (DISABLED) return Promise.reject(new Error('AG Grid disabled with ?nogrid=1'));
  if (window.agGrid && window.agGrid.createGrid) return Promise.resolve(window.agGrid);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SRC; s.async = true;
      s.onload = () => (window.agGrid && window.agGrid.createGrid ? resolve(window.agGrid) : reject(new Error('AG Grid loaded without agGrid global')));
      s.onerror = () => reject(new Error('Could not load ' + SRC));
      document.head.append(s);
    }).catch((e) => { loading = null; throw e; });
  }
  return loading;
}

// Status chip: icon + word + tone. Tones follow the palette: hold = blue, released = lime (the only lime in the UI), voided = hatched slate.
function statusOf(r) {
  const bad = /FAIL|REJECT|DENIED|ERROR/i.test(r.status || '');
  switch (r.kind) {
    case 'order.create': return { label: 'Created', tone: 'plain', icon: 'doc' };
    case 'order.authorize': case 'reauthorize': return { label: 'Held', tone: 'held', icon: 'lock' };
    case 'capture': return { label: 'Released', tone: 'released', icon: 'check' };
    case 'void': return { label: 'Voided', tone: 'voided', icon: 'undo' };
    case 'refund': return { label: 'Refunded', tone: 'voided', icon: 'undo' };
    case 'invoice.create': case 'invoice.send': case 'invoice.payment': return { label: 'Receipt', tone: 'plain', icon: 'doc' };
    case 'webhook': return { label: 'Webhook', tone: 'plain', icon: 'link' };
    case 'oracle': case 'judge': return bad ? { label: 'Rejected', tone: 'bad', icon: 'x' } : { label: 'Checked', tone: 'check', icon: 'shield' };
    default: return bad ? { label: 'Rejected', tone: 'bad', icon: 'x' } : { label: 'State', tone: 'plain', icon: 'clock' };
  }
}

function fmtDur(ms, derived) {
  if (ms == null || (derived && ms < 2)) return '–';
  const v = ms < 1000 ? Math.round(ms) + ' ms' : ms < 60000 ? (ms / 1000).toFixed(1) + ' s' : Math.round(ms / 60000) + ' min';
  return derived ? '+' + v : v;
}

function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  return new Promise((ok, no) => {
    const t = h('textarea', { style: { position: 'fixed', opacity: '0' }, 'aria-hidden': 'true' }); t.value = text; document.body.append(t); t.select();
    try { document.execCommand('copy') ? ok() : no(new Error('copy blocked')); } catch (e) { no(e); } finally { t.remove(); }
  });
}
function copyBtn(id, label) {
  const b = h('button', { type: 'button', class: 'pl-copy', 'aria-label': `Copy ${label} ${id}`, title: 'Copy' }, ic('copy', 15));
  b.addEventListener('click', async (e) => {
    e.stopPropagation();
    try { await copyText(id); b.replaceChildren(ic('check', 15)); b.classList.add('done'); toast(`${label} copied`, 'ok'); srSay(`${label} copied`); setTimeout(() => { b.replaceChildren(ic('copy', 15)); b.classList.remove('done'); }, 1500); }
    catch { toast('Copy blocked by the browser'); }
  });
  return b;
}

// opts: { rows, deal, helpers: { TITLE, grp, rawBlocks }, group, quick, open, onQuick }
export async function mountLedgerGrid(host, opts) {
  const ag = await loadAgGrid();
  const { TITLE, grp, rawBlocks } = opts.helpers;
  const open = opts.open;
  let rows = opts.rows.slice(), group = opts.group || 'all', fresh = new Set(), freshTimer = null, dead = false, api = null;

  const decorate = (list) => list.map((r, i) => {
    const prev = list[i - 1];
    const derived = r.duration_ms == null;
    return { ...r, _key: 'r' + r.id, _title: TITLE[r.kind] || r.kind, _status: statusOf(r), _dur: derived ? (prev ? Math.max(0, new Date(r.ts) - new Date(prev.ts)) : null) : r.duration_ms, _derived: derived };
  });
  const flat = () => decorate(rows).reverse().flatMap((d) => (open.has(d.id) ? [d, { ...d, _key: 'd' + d.id, _detail: true }] : [d]));
  const totals = () => {
    const last = rows[rows.length - 1] || {};
    const sum = (k) => rows.filter((r) => r.kind === k).reduce((a, r) => a + (r.amount_cents || 0), 0);
    const cap = sum('capture');
    return { held: last.balance_cents || 0, captured: cap, released: Math.max(0, cap - sum('refund')), voided: sum('void'), calls: rows.filter((r) => r.http_status).length };
  };
  const pinned = () => [{ _key: 'totals', _totals: true }];

  // DOM shell: toolbar + grid, inside the same .card the plain table used.
  const qf = h('input', { type: 'search', class: 'pl-qf', placeholder: 'Filter calls, IDs, notes', 'aria-label': 'Quick filter the ledger', value: opts.quick || '', autocomplete: 'off', spellcheck: 'false' });
  const count = h('span', { class: 'pl-count', 'aria-live': 'polite' });
  const gridEl = h('div', { class: 'pl-grid', role: 'region', 'aria-label': 'Ledger grid. Arrow keys move between cells, Enter opens the raw record.' });
  const el = h('div', { class: 'card pl-gridcard enter' },
    h('div', { class: 'pl-bar' }, h('label', { class: 'pl-search' }, ic('search', 16), qf), count, h('span', { class: 'pl-hint' }, 'Arrow keys move · Enter opens the raw record · click a header to sort')),
    gridEl);
  host.replaceChildren(el);

  const narrow = () => gridEl.clientWidth < 640;
  const detailHeight = (d) => {
    const cols = rawBlocks(d, opts.deal).res ? 3 : 2;
    return narrow() ? 74 + cols * 196 : 292;
  };

  const theme = ag.themeQuartz.withParams({
    accentColor: 'var(--blue)', backgroundColor: 'var(--surface)', foregroundColor: 'var(--ink)', borderColor: 'var(--line)',
    chromeBackgroundColor: 'var(--surface-2)', headerBackgroundColor: 'var(--surface-2)', headerTextColor: 'var(--ink-3)',
    headerFontSize: 11, headerFontWeight: 700, fontFamily: 'var(--font)', fontSize: 14, rowHoverColor: 'var(--blue-50)',
    wrapperBorder: false, wrapperBorderRadius: 0, columnBorder: false, headerColumnBorder: false, rowBorder: { color: 'var(--line)' },
    spacing: 7, iconSize: 14, cellHorizontalPaddingScale: 1.1, textColor: 'var(--ink)',
  });

  const toggle = (id) => {
    const fc = api.getFocusedCell(), key = 'r' + id;
    if (open.has(id)) open.delete(id); else open.add(id);
    api.setGridOption('rowData', flat());
    api.refreshCells({ rowNodes: [api.getRowNode(key)].filter(Boolean), columns: ['chev'], force: true });
    // keep keyboard focus on the same cell after the row set changes
    const node = api.getRowNode(key);
    if (fc && node && node.rowIndex != null) setTimeout(() => api && !dead && api.setFocusedCell(node.rowIndex, fc.column), 0);
  };

  function eventCell(p) {
    const d = p.data;
    return h('div', { class: 'pl-ev' },
      h('span', { class: 'pl-ttl' }, h('span', null, d._title), d.milestone_id ? h('span', { class: 'pl-tag' }, d.milestone_id) : null),
      h('span', { class: 'pl-sub' }, h('span', { class: 'pl-t' }, fmtTime(d.ts) + ' · '), d.note || d.call || ''));
  }
  function chipCell(p) { const s = p.data._status; return h('span', { class: 'pl-chip ' + s.tone }, ic(s.icon, 13), s.label, p.data.http_status && !['state', 'webhook', 'oracle', 'judge'].includes(p.data.kind) ? h('i', { class: 'pl-http' }, p.data.http_status) : null); }
  function callCell(p) { const c = p.data.call || ''; const m = c.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(.*)$/); return h('span', { class: 'pl-call', title: c }, m ? [h('b', null, m[1]), ' ' + m[2]] : c); }
  function debugCell(p) { const id = p.data.debug_id; return id ? h('span', { class: 'pl-dbg' }, h('code', null, id), copyBtn(id, 'PayPal debug ID')) : h('span', { class: 'pl-dash' }, '–'); }
  function chevCell(p) {
    const on = open.has(p.data.id);
    const b = h('button', { type: 'button', class: 'pl-chev' + (on ? ' on' : ''), tabindex: '-1', 'aria-expanded': String(on), 'aria-label': (on ? 'Hide' : 'Show') + ' raw record for ' + p.data._title }, ic('chev', 16));
    b.addEventListener('click', (e) => { e.stopPropagation(); toggle(p.data.id); });
    return b;
  }

  function fullWidth(p) {
    if (p.node.rowPinned) {
      const t = totals();
      const stat = (cls, lab, val, sub) => h('div', { class: 'pl-stat ' + cls }, h('small', null, lab), h('b', null, money(val)), h('em', null, sub));
      return h('div', { class: 'pl-totals', role: 'group', 'aria-label': 'Totals for this deal' },
        stat('held', 'Held now', t.held, 'still with PayPal'), stat('captured', 'Captured', t.captured, 'PayPal captures'),
        stat('released', 'Released', t.released, 'to the freelancer'), stat('voided', 'Voided', t.voided, 'back to the buyer'));
    }
    const d = p.data, raw = rawBlocks(d, opts.deal);
    const pre = (title, text) => h('section', null, h('h4', null, title), h('pre', { tabindex: '0', 'aria-label': title, html: opts.helpers.hl(text) }));
    return h('div', { class: 'pl-raw' + (narrow() ? ' stack' : ''), 'data-cols': raw.res ? 3 : 2 },
      h('div', { class: 'pl-rawhead' }, h('span', null, d._title), d.paypal_id ? h('span', { class: 'pl-pid' }, 'PayPal ID ', h('code', null, d.paypal_id), copyBtn(d.paypal_id, 'PayPal ID')) : null,
        d.debug_id ? h('span', { class: 'pl-pid' }, 'Debug ID ', h('code', null, d.debug_id), copyBtn(d.debug_id, 'PayPal debug ID')) : null),
      pre(raw.label, raw.req), raw.res ? pre('Response', raw.res) : null, pre('Ledger record', raw.rec));
  }

  const gridOptions = {
    theme, rowData: flat(), pinnedBottomRowData: pinned(), quickFilterText: opts.quick || '', cacheQuickFilter: true,
    getRowId: (p) => p.data._key, animateRows: !RM(), ensureDomOrder: true, enableCellTextSelection: true, suppressCellFocus: false,
    rowHeight: 58, headerHeight: 42, tooltipShowDelay: 500,
    defaultColDef: { sortable: true, resizable: true, suppressMovable: true, minWidth: 70 },
    columnDefs: [
      { colId: 'chev', headerName: '', headerTooltip: 'Open raw record', field: 'id', width: 52, minWidth: 52, maxWidth: 52, sortable: false, resizable: false, cellRenderer: chevCell, cellClass: 'pl-c-chev', suppressHeaderMenuButton: true },
      { colId: 'ts', headerName: 'Time', field: 'ts', width: 88, valueFormatter: (p) => fmtTime(p.value), sort: 'desc', sortingOrder: ['desc', 'asc'], cellClass: 'pl-c-time' },
      { colId: 'event', headerName: 'Event', flex: 3, minWidth: 200, valueGetter: (p) => p.data._title, getQuickFilterText: (p) => [p.data._title, p.data.note, p.data.milestone_id, p.data.paypal_id, p.data.kind].filter(Boolean).join(' '), cellRenderer: eventCell },
      { colId: 'amount', headerName: 'Amount', field: 'amount_cents', width: 100, valueFormatter: (p) => (p.value ? money(p.value) : '–'), cellClass: 'pl-c-amt', headerClass: 'pl-h-right' },
      { colId: 'status', headerName: 'Status', width: 144, valueGetter: (p) => p.data._status.label, cellRenderer: chipCell },
      { colId: 'call', headerName: 'PayPal call', field: 'call', flex: 1.4, minWidth: 170, cellRenderer: callCell, tooltipField: 'call' },
      { colId: 'debug', headerName: 'PayPal debug ID', field: 'debug_id', width: 168, cellRenderer: debugCell },
      { colId: 'dur', headerName: 'Duration', headerTooltip: 'Call latency when recorded, otherwise time since the previous row', field: '_dur', width: 96, headerClass: 'pl-h-right', valueFormatter: (p) => fmtDur(p.value, p.data && p.data._derived), cellClass: 'pl-c-amt' },
    ],
    isFullWidthRow: (p) => !!(p.rowNode.data && (p.rowNode.data._detail || p.rowNode.data._totals)),
    fullWidthCellRenderer: fullWidth,
    getRowHeight: (p) => (p.data && p.data._detail ? detailHeight(p.data) : p.data && p.data._totals ? 72 : undefined),
    getRowClass: (p) => (p.data && (p.data._detail ? 'pl-detail-row' : p.data._totals ? 'pl-total-row' : fresh.has(p.data._key) ? 'pl-new' : '')) || undefined,
    // A detail row sorts with its parent's values; put it right behind its parent whatever the sort.
    postSortRows: ({ nodes }) => {
      const det = new Map(), rest = [];
      for (const n of nodes) { if (n.data && n.data._detail) det.set(n.data.id, n); else rest.push(n); }
      if (!det.size) return;
      nodes.length = 0;
      for (const n of rest) { nodes.push(n); const d = det.get(n.data.id); if (d) nodes.push(d); }
    },
    isExternalFilterPresent: () => group !== 'all',
    doesExternalFilterPass: (n) => group === 'all' || !n.data || grp(n.data.kind) === group,
    onRowClicked: (e) => {
      if (!e.data || e.data._detail || e.data._totals || (e.event && e.event.target.closest('button, a, code, pre'))) return;
      if (String(window.getSelection && window.getSelection()).length) return;
      toggle(e.data.id);
    },
    onCellKeyDown: (e) => {
      const k = e.event;
      if (!e.data || e.data._detail || e.data._totals || !k || k.target.closest('button')) return;
      if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); const was = open.has(e.data.id); toggle(e.data.id); srSay(was ? 'Raw record hidden' : 'Raw record shown below'); }
      else if (k.key === 'c' && e.data.debug_id && !k.metaKey && !k.ctrlKey) { copyText(e.data.debug_id).then(() => toast('PayPal debug ID copied', 'ok')).catch(() => {}); }
    },
    onModelUpdated: () => { if (api) paintCount(); },
  };

  function paintCount() {
    let shown = 0; api.forEachNodeAfterFilter((n) => { if (n.data && !n.data._detail && !n.data._totals) shown++; });
    count.textContent = `${shown} of ${rows.length} rows` + (rows.some((r) => r.mock) ? ' · simulated PayPal' : '');
  }
  function fit() {
    if (!api) return;
    const n = narrow();
    gridEl.classList.toggle('is-narrow', n);
    api.setColumnsVisible(['call', 'dur', 'ts'], !n);
    api.setColumnsPinned(['chev'], n ? 'left' : null);
    if (n) api.setColumnWidths([{ key: 'event', newWidth: 200 }]); else api.applyColumnState({ state: [{ colId: 'event', flex: 3 }] });
    api.resetRowHeights();
  }

  api = ag.createGrid(gridEl, gridOptions);
  paintCount(); fit();
  let lastW = gridEl.clientWidth;
  const ro = new ResizeObserver(() => { const w = gridEl.clientWidth; if ((w < 640) !== (lastW < 640)) fit(); lastW = w; });
  ro.observe(gridEl);
  qf.addEventListener('input', () => { api.setGridOption('quickFilterText', qf.value); opts.onQuick && opts.onQuick(qf.value); });

  return {
    el,
    // New rows from the live stream: they drop in at the top with a highlight; the totals refresh.
    setRows(next) {
      if (dead) return;
      const had = new Set(rows.map((r) => r.id));
      const added = next.filter((r) => !had.has(r.id));
      rows = next.slice();
      fresh = new Set(added.map((r) => 'r' + r.id));
      api.setGridOption('rowData', flat());
      api.setGridOption('pinnedBottomRowData', [{ _key: 'totals', _totals: true, _v: rows.length }]);
      api.redrawRows({ rowNodes: [api.getPinnedBottomRow(0)].filter(Boolean) });
      clearTimeout(freshTimer); freshTimer = setTimeout(() => { fresh = new Set(); }, 2500);
      if (added.length) srSay(`${added.length} new PayPal call${added.length > 1 ? 's' : ''} in the ledger`);
    },
    setGroup(g) { group = g; api.onFilterChanged(); },
    destroy() { dead = true; clearTimeout(freshTimer); ro.disconnect(); try { api.destroy(); } catch { /* already gone */ } },
  };
}
