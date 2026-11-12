// Shared UI state + tiny pub/sub. Views read from here, never from each other.
export const state = {
  deal: null,          // current Deal (API shape)
  ledger: [],          // rows for current deal
  role: 'client',      // 'client' | 'freelancer' (view only)
  draft: { text: '', parsed: null, contract: null, verification: null, attempts: [], source: null, compiledText: null },
  pendingContract: null,
  justFunded: null,
  demo: false,
  info: null,          // /api/status
  typoNext: false,
};
const subs = new Set();
export const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };
export const notify = (what) => subs.forEach((f) => f(what));
export const nav = (hash) => { if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = hash; };
