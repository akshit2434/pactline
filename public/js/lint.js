// Terms check: flags deal wording that nobody can verify, with an exact rewrite the user can apply in one click.
// Pure and deterministic (no model call), so it is free, instant and safe to run in the demo and the public site.
const RULES = [
  { re: /\b(?:when|once|after)\s+(?:it(?:'s| is)|the work is|everything is|all is)\s+(?:done|finished|complete)\b/i,
    problem: '"Done" cannot be checked.', fix: () => 'when the final files are delivered and the client approves them' },
  { re: /\b(?:when|once)\s+(?:the client is |client is )?(?:happy|satisfied|pleased)\b/i,
    problem: '"Happy" is a feeling, not a check.', fix: () => 'when the client approves the delivery in writing' },
  { re: /\blooks? (?:good|great|nice|right)\b/i,
    problem: '"Looks good" has no clear bar.', fix: () => 'shows every section listed in the brief' },
  { re: /\b(?:asap|as soon as possible|soon|when ready|whenever)\b/i,
    problem: 'No date means no deadline for the hold.', fix: () => 'within 14 days' },
  { re: /\bmatch(?:es)? the (?:mockup|mockups|design|designs)\b(?![^;,.]*\b(?:hero|pricing|footer|screens?|pages?)\b)/i,
    problem: 'Which parts must match? Name them so a screenshot can prove it.', fix: (m) => `${m[0]} (hero, pricing table and footer)` },
];

export function lintDeal(text) {
  const t = String(text || '');
  const issues = [];
  for (const r of RULES) {
    const m = t.match(r.re);
    if (m) issues.push({ phrase: m[0], problem: r.problem, replace: r.fix(m) });
  }
  if (/\$\s?\d/.test(t) && /%|\$\s?\d[^$]*\$\s?\d/.test(t) && !/\b(?:by|before|within|deadline|until)\b\s+\S/i.test(t)) {
    issues.push({ phrase: null, problem: 'No end date: unreleased money has no point at which it goes back.', append: '; refund if not delivered within 30 days' });
  }
  return issues;
}

/** Apply one suggestion to the text and return the new text. */
export function applyFix(text, issue) {
  if (issue.append) return String(text).replace(/[\s.;]*$/, '') + issue.append + '.';
  return String(text).replace(issue.phrase, issue.replace);
}
