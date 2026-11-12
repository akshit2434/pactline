// One API object for the whole UI. Real backend when reachable (see ../../API.md), in-browser mock otherwise.
import { createMock } from './mock.js';

async function http(method, path, body, signal) {
  const res = await fetch(path, { method, signal, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    const e = new Error((data && data.error) || res.statusText); e.code = data && data.code; e.status = res.status; e.verification = data && data.verification;
    throw e;
  }
  return data;
}

function createReal() {
  const listeners = new Set();
  let es = null, lastId = 0, pollTimer = null;
  const dispatch = (e) => { lastId = Math.max(lastId, e.id || 0); listeners.forEach((f) => f(e)); };
  function startEvents() {
    if (es || pollTimer) return;
    try {
      es = new EventSource('/api/events');
      es.onmessage = (m) => { try { dispatch(JSON.parse(m.data)); } catch { /* ignore */ } };
      es.onerror = () => { es.close(); es = null; startPoll(); };
    } catch { startPoll(); }
  }
  function startPoll() {
    if (pollTimer) return;
    pollTimer = setInterval(async () => {
      try { const r = await http('GET', '/api/events/poll?since=' + lastId); r.events.forEach(dispatch); } catch { /* offline */ }
    }, 2000);
  }
  return {
    mock: false,
    status: () => http('GET', '/api/status'),
    compile: (text, opts = {}) => http('POST', opts.typo ? '/api/contracts/typo' : '/api/contracts/compile', { text }, opts.signal),
    verify: (contract) => http('POST', '/api/contracts/verify', { contract }),
    createDeal: (contract) => http('POST', '/api/deals', { contract }),
    fund: (id) => http('POST', `/api/deals/${id}/fund`),
    fundComplete: (id, order_id) => http('POST', `/api/deals/${id}/fund/complete`, { order_id }),
    getDeal: (id) => http('GET', `/api/deals/${id}`),
    listDeals: async () => (await http('GET', '/api/deals')).deals,
    submit: (id, mid, payload) => http('POST', `/api/deals/${id}/milestones/${mid}/submit`, payload),
    review: (id, mid, decision, note) => http('POST', `/api/deals/${id}/milestones/${mid}/review`, { decision, note }),
    confirm: (id, mid) => http('POST', `/api/deals/${id}/milestones/${mid}/confirm`, {}),
    dispute: (id, mid, reason, criterion) => http('POST', `/api/deals/${id}/milestones/${mid}/dispute`, { reason, criterion }),
    cancel: (id, reason) => http('POST', `/api/deals/${id}/cancel`, { reason }),
    clock: (id, days) => http('POST', `/api/deals/${id}/clock`, { advance_days: days }),
    seed: (stage) => http('POST', '/api/demo/seed', { stage }),
    ledger: async (id) => (await http('GET', id ? `/api/deals/${id}/ledger` : '/api/ledger')).rows,
    demoContract: () => http('GET', '/api/demo/contract'),
    onEvent(f) { listeners.add(f); startEvents(); return () => listeners.delete(f); },
  };
}

const params = new URLSearchParams(location.search);
let backend = null, mockBackend = null;

export const engine = {
  mode: 'mock',
  async init() {
    mockBackend = createMock();
    if (params.get('mock') === '1') { backend = mockBackend; this.mode = 'mock'; return this; }
    try {
      const real = createReal();
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 1500);
      const r = await fetch('/api/status', { signal: ctl.signal }); clearTimeout(t);
      if (!r.ok) throw new Error('no api');
      real.statusInfo = await r.json();
      backend = real; this.real = real; this.mode = 'real';
    } catch { backend = mockBackend; this.mode = 'mock'; }
    return this;
  },
  // Demo mode always runs on the in-browser engine so it can be auto-played end to end.
  useMock(fast = 1) { mockBackend.reset(); mockBackend.setSpeed(fast); backend = mockBackend; this.mode = 'mock'; },
  get api() { return backend; },
  get mock() { return mockBackend; },
  real: null,
  useReal() { if (this.real) { backend = this.real; this.mode = 'real'; } },
};
export const api = new Proxy({}, { get: (_, k) => (...a) => backend[k](...a) });
