import test from 'node:test';
import assert from 'node:assert/strict';
import { lintDeal, applyFix } from '../public/js/lint.js';
import { parseDeal } from '../public/js/parse.js';

const DEMO = 'Landing page, $1,200: 30% when the staging URL is live, 50% when the design matches the mockup, 20% after 7 days with no open bugs; refund if not delivered by 30 Nov.';

test('terms check: vague acceptance wording is flagged with an exact rewrite', () => {
  const t = 'Website, $900: 50% when the client is happy, 50% when it is done; by 30 Nov.';
  const issues = lintDeal(t);
  assert.equal(issues.length, 2);
  let fixed = t; for (const i of issues) fixed = applyFix(fixed, i);
  assert.equal(lintDeal(fixed).length, 0);
  assert.equal(parseDeal(fixed).milestones.length, 2, 'the rewrite keeps the deal parseable');
});

test('terms check: unnamed mockup parts are flagged, and the fix names them', () => {
  const issues = lintDeal(DEMO);
  assert.equal(issues.length, 1);
  assert.match(applyFix(DEMO, issues[0]), /matches the mockup \(hero, pricing table and footer\)/);
});

test('terms check: a missing end date suggests one; a precise deal is clean', () => {
  const t = 'Logo, $500: 50% when concepts are shared, 50% when the final files are approved.';
  const issues = lintDeal(t);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].phrase, null);
  assert.match(applyFix(t, issues[0]), /refund if not delivered within 30 days\.$/);
  assert.deepEqual(lintDeal('Logo, $500: 50% when concepts are shared, 50% when the final files are approved; by 21 Nov.'), []);
});
