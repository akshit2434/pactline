export const DEMO_TEXT = 'Landing page, $1,200: 30% when the staging URL is live, 50% when the design matches the mockup, 20% after 7 days with no open bugs; refund if not delivered by 30 Nov.';
export const demoContract = () => ({
  title: 'Landing page', currency: 'USD',
  client: { name: 'Northwind Traders', email: 'ap@northwind.example' }, freelancer: { name: 'Ava Designer', email: 'ava@studio.example' },
  hold: { amount_cents: 120000, window_days: 29 }, deadline: { day: 18, on_timeout: 'void_remainder' },
  milestones: [
    { id: 'm1', title: 'Staging URL is live', share_pct: 30, amount_cents: 36000, depends_on: [], oracle: { type: 'url', url: 'https://example.com', contains: 'Example Domain' }, criteria: 'The staging site returns 200 and shows the agreed headline.', proof_type: 'url', due_day: 7 },
    { id: 'm2', title: 'Design matches the mockup', share_pct: 50, amount_cents: 60000, depends_on: ['m1'], oracle: { type: 'evidence' }, criteria: 'A screenshot shows the hero, pricing table and footer from the approved mockup.', proof_type: 'screenshot', due_day: 14 },
    { id: 'm3', title: '7 days with no open bugs', share_pct: 20, amount_cents: 24000, depends_on: ['m2'], oracle: { type: 'deadline', after_days: 7, after: 'm2' }, criteria: 'Seven days pass after m2 without a bug being filed.', proof_type: 'time', due_day: 18 },
  ],
});
