export const demoContract = () => ({
  title: 'Landing page', currency: 'USD',
  client: { name: 'Northwind Traders', email: 'ap@northwind.example' }, freelancer: { name: 'Ava Designer', email: 'ava@studio.example' },
  hold: { amount_cents: 120000, window_days: 29 }, deadline: { day: 28, on_timeout: 'void_remainder' },
  milestones: [
    { id: 'm1', title: 'Staging URL live', share_pct: 30, amount_cents: 36000, depends_on: [], oracle: { type: 'url', url: 'https://staging.example.com', contains: 'Northwind' }, criteria: 'Site returns 200' },
    { id: 'm2', title: 'Design matches mockup', share_pct: 50, amount_cents: 60000, depends_on: ['m1'], oracle: { type: 'evidence' }, criteria: 'Screenshot matches mockup' },
    { id: 'm3', title: '7 days no bugs', share_pct: 20, amount_cents: 24000, depends_on: ['m2'], oracle: { type: 'deadline', after_days: 7, after: 'm2' }, criteria: 'No bugs for 7 days' },
  ],
});
export const parallelContract = () => ({
  ...demoContract(), hold: { amount_cents: 100001, window_days: 29 },
  milestones: [
    { id: 'a', share_pct: 25, amount_cents: 25000, depends_on: [], oracle: { type: 'manual' } },
    { id: 'b', share_pct: 25, amount_cents: 25000, depends_on: [], oracle: { type: 'manual' } },
    { id: 'c', share_pct: 25, amount_cents: 25000, depends_on: ['a'], oracle: { type: 'manual' } },
    { id: 'd', share_pct: 25, amount_cents: 25001, depends_on: ['b', 'c'], oracle: { type: 'manual' } },
  ],
});
// small seeded PRNG for reproducible property tests
export function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
