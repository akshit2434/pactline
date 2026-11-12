// Oracles decide whether a milestone's condition is met. Every one returns
// { verdict: 'pass'|'fail'|'unclear', confidence, reasons[], by }.
import { checkProof } from '../ai/index.js';

const T = 8000;
async function fetchWithTimeout(url, opts = {}) { const c = new AbortController(); const t = setTimeout(() => c.abort(), opts.timeoutMs || T); try { return await fetch(url, { redirect: 'follow', signal: c.signal, headers: { 'user-agent': 'pactline-oracle/1.0', ...(opts.headers || {}) } }); } finally { clearTimeout(t); } }

export async function urlOracle(o) {
  try {
    const r = await fetchWithTimeout(o.url); const body = (await r.text()).slice(0, 400000);
    if (r.status !== 200) return { verdict: 'fail', confidence: 0.95, reasons: [`${o.url} returned HTTP ${r.status}`], by: 'url-oracle' };
    if (o.contains && !body.toLowerCase().includes(String(o.contains).toLowerCase())) return { verdict: 'fail', confidence: 0.9, reasons: [`${o.url} is up (200) but does not contain "${o.contains}"`], by: 'url-oracle' };
    return { verdict: 'pass', confidence: 0.98, reasons: [`${o.url} returned 200${o.contains ? ` and contains "${o.contains}"` : ''}`], by: 'url-oracle' };
  } catch (e) { return { verdict: 'unclear', confidence: 0.4, reasons: [`Could not reach ${o.url}: ${e.name === 'AbortError' ? 'timed out' : e.message}`], by: 'url-oracle' }; }
}

export async function githubPrOracle(o) {
  try {
    const r = await fetchWithTimeout(`https://api.github.com/repos/${o.repo}/pulls/${o.number}`, { headers: { accept: 'application/vnd.github+json' } });
    if (r.status === 404) return { verdict: 'fail', confidence: 0.9, reasons: [`PR ${o.repo}#${o.number} not found`], by: 'github-oracle' };
    if (!r.ok) return { verdict: 'unclear', confidence: 0.4, reasons: [`GitHub returned HTTP ${r.status}`], by: 'github-oracle' };
    const pr = await r.json();
    return pr.merged ? { verdict: 'pass', confidence: 0.99, reasons: [`${o.repo}#${o.number} is merged`], by: 'github-oracle' }
      : { verdict: 'fail', confidence: 0.9, reasons: [`${o.repo}#${o.number} is ${pr.state}, not merged`], by: 'github-oracle' };
  } catch (e) { return { verdict: 'unclear', confidence: 0.4, reasons: [`GitHub check failed: ${e.message}`], by: 'github-oracle' }; }
}

/** Run the oracle for a milestone. `evidence` = { text, url, image_data_url }. */
export async function runOracle(milestone, evidence = {}, hooks = {}) {
  const o = milestone.oracle || {};
  if (o.type === 'url') return urlOracle({ ...o, url: o.url || evidence.url });
  if (o.type === 'github_pr') return githubPrOracle(o);
  if (o.type === 'manual') return { verdict: 'unclear', confidence: 0.5, reasons: ['Waiting for the client to approve'], by: 'human' };
  if (o.type === 'deadline') return { verdict: 'unclear', confidence: 0.5, reasons: ['Released automatically when the waiting period ends'], by: 'timer' };
  // "staging URL is live"-style milestone whose contract carried no URL: check the URL supplied at submission time
  const urlish = milestone.proof_type === 'url' || /\b(url|staging|site|website|link|live)\b/i.test(`${milestone.title} ${milestone.criteria || ''}`);
  if (evidence.url && !evidence.image_data_url && urlish) return urlOracle({ url: evidence.url, contains: o.contains });
  const files = evidence.image_data_url ? [{ data_url: evidence.image_data_url }] : undefined;
  const v = await (hooks.checkProof || checkProof)({ milestone, text: evidence.text, url: evidence.url, files });
  return { verdict: v.verdict, confidence: v.confidence, reasons: v.reasons?.length ? v.reasons : [v.reason], by: v.by, injection_detected: v.injection_detected, evidence: v.evidence, model: v.model };
}
