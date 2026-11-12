// Oracles decide whether a milestone's condition is met. Every one returns
// { verdict: 'pass'|'fail'|'unclear', confidence, reasons[], by }.
import dns from 'node:dns/promises';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { checkProof } from '../ai/index.js';
import { config } from '../config.js';

const T = 8000;
async function fetchWithTimeout(url, opts = {}) { const c = new AbortController(); const t = setTimeout(() => c.abort(), opts.timeoutMs || T); try { return await fetch(url, { redirect: 'follow', signal: c.signal, headers: { 'user-agent': 'pactline-oracle/1.0', ...(opts.headers || {}) } }); } finally { clearTimeout(t); } }

const PRIVATE = [/^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^(22[4-9]|2[3-5]\d)\./, /^::$/, /^::1$/, /^f[cd]/i, /^fe80/i];
/** True for loopback, private, link-local, CGNAT, multicast and IPv4-mapped forms of them. */
export function isPrivateAddress(addr) {
  const a = String(addr).toLowerCase().replace(/^\[|\]$/g, '');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  return PRIVATE.some((re) => re.test(mapped ? mapped[1] : a));
}
const allowPrivate = () => process.env.PACTLINE_ALLOW_PRIVATE_URLS === '1';
const ownOrigin = (u) => { try { return u.origin === new URL(config.publicBaseUrl).origin; } catch { return false; } };

/** SSRF guard: the oracle fetches user-supplied URLs, so private/link-local targets are refused (except our own demo origin). */
export async function assertPublicUrl(raw) {
  const u = new URL(raw);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw Object.assign(new Error('Only http and https URLs can be checked'), { private: true });
  if (allowPrivate() || ownOrigin(u)) return;
  const addrs = net.isIP(u.hostname.replace(/^\[|\]$/g, '')) ? [{ address: u.hostname }] : await dns.lookup(u.hostname, { all: true });
  if (addrs.some((a) => isPrivateAddress(a.address))) throw Object.assign(new Error('URL points to a private address'), { private: true });
}

// DNS lookup that refuses private answers at connect time, so a rebinding DNS server cannot swap in 127.0.0.1 after the check.
function guardedLookup(hostname, options, cb) {
  dns.lookup(hostname, { ...options, all: true }).then((list) => {
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad) return cb(Object.assign(new Error('URL points to a private address'), { private: true, code: 'EPRIVATE' }));
    if (options && options.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  }, cb);
}

/**
 * GET a user-supplied URL safely: http(s) only, every redirect hop re-checked (max 3), private addresses refused
 * at connect time, a timeout and a body cap. Returns { status, text }.
 */
export async function safeGet(raw, { timeoutMs = T, maxBytes = 400000, maxRedirects = 3 } = {}) {
  let url = new URL(raw);
  for (let hop = 0; ; hop++) {
    await assertPublicUrl(url.href);
    const trusted = allowPrivate() || ownOrigin(url);
    const r = await getOnce(url, { timeoutMs, maxBytes, lookup: trusted ? undefined : guardedLookup });
    if (r.status >= 300 && r.status < 400 && r.location) {
      if (hop >= maxRedirects) return { status: r.status, text: '' };
      url = new URL(r.location, url); continue;
    }
    return r;
  }
}

function getOnce(url, { timeoutMs, maxBytes, lookup }) {
  const mod = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(url, { method: 'GET', lookup, headers: { 'user-agent': 'pactline-oracle/1.0', accept: 'text/html,*/*;q=0.5' }, timeout: timeoutMs }, (res) => {
      const chunks = []; let n = 0;
      res.on('data', (c) => { if (n < maxBytes) { chunks.push(c); n += c.length; } else res.destroy(); });
      const done = () => resolve({ status: res.statusCode, location: res.headers.location, text: Buffer.concat(chunks).toString('utf8').slice(0, maxBytes) });
      res.on('end', done); res.on('close', done); res.on('error', done);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timed out'), { name: 'AbortError' })));
    req.on('error', reject);
    req.end();
  });
}

export async function urlOracle(o) {
  try {
    const r = await safeGet(o.url); const body = r.text;
    if (r.status !== 200) return { verdict: 'fail', confidence: 0.95, reasons: [`${o.url} returned HTTP ${r.status}`], by: 'url-oracle' };
    if (o.contains && !body.toLowerCase().includes(String(o.contains).toLowerCase())) return { verdict: 'fail', confidence: 0.9, reasons: [`${o.url} is up (200) but does not contain "${o.contains}"`], by: 'url-oracle' };
    return { verdict: 'pass', confidence: 0.98, reasons: [`${o.url} returned 200${o.contains ? ` and contains "${o.contains}"` : ''}`], by: 'url-oracle' };
  } catch (e) { if (e.private) return { verdict: 'fail', confidence: 0.99, reasons: ['That URL points to a private network address; only public sites can be checked'], by: 'url-oracle' }; return { verdict: 'unclear', confidence: 0.4, reasons: [`Could not reach ${o.url}: ${e.name === 'AbortError' ? 'timed out' : e.message}`], by: 'url-oracle' }; }
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
