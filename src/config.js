import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Parse a dotenv-style file into process.env without overriding existing vars. */
function loadEnvFile(file, only) {
  if (!file || !fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (only && !only.test(m[1])) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (v !== '' && process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

loadEnvFile(path.join(root, '.env'));
loadEnvFile(path.join(root, '.env.local'));
// KEYS_FILE may be a shared secrets file: only pick up the names this app needs.
loadEnvFile(process.env.KEYS_FILE, /^(PAYPAL_(US_)?SANDBOX_[A-Z_]+|PAYPAL_WEBHOOK_ID|ANTHROPIC_API_KEY)$/);

const env = process.env;
// Optional override for hosts that keep several sandbox apps in one keys file (e.g. an India-based default app plus a US one).
if (env.PAYPAL_US_SANDBOX_CLIENT_ID && env.PAYPAL_US_SANDBOX_CLIENT_SECRET) {
  env.PAYPAL_SANDBOX_CLIENT_ID = env.PAYPAL_US_SANDBOX_CLIENT_ID; env.PAYPAL_SANDBOX_CLIENT_SECRET = env.PAYPAL_US_SANDBOX_CLIENT_SECRET;
  if (env.PAYPAL_US_SANDBOX_BUYER_EMAIL) { env.PAYPAL_SANDBOX_BUYER_EMAIL = env.PAYPAL_US_SANDBOX_BUYER_EMAIL; env.PAYPAL_SANDBOX_BUYER_PASSWORD = env.PAYPAL_US_SANDBOX_BUYER_PASSWORD; }
}
const hasPayPalKeys = Boolean(env.PAYPAL_SANDBOX_CLIENT_ID && env.PAYPAL_SANDBOX_CLIENT_SECRET);
const mode = (env.PAYPAL_MODE || 'auto').toLowerCase();

export const config = {
  root,
  port: Number(env.PORT || 3100),
  host: '127.0.0.1',
  publicBaseUrl: env.PUBLIC_BASE_URL || `http://127.0.0.1:${env.PORT || 3100}`,
  paypal: {
    mode: mode === 'mock' ? 'mock' : mode === 'live' ? 'live' : hasPayPalKeys ? 'live' : 'mock',
    clientId: env.PAYPAL_SANDBOX_CLIENT_ID,
    clientSecret: env.PAYPAL_SANDBOX_CLIENT_SECRET,
    baseUrl: 'https://api-m.sandbox.paypal.com',
  },
  preferredCurrency: (env.CURRENCY || 'USD').toUpperCase(),
  llm: {
    provider: (env.LLM_PROVIDER || 'auto').toLowerCase(),
    anthropicKey: env.ANTHROPIC_API_KEY,
    model: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
    cliModel: env.CLAUDE_CLI_MODEL || 'claude-sonnet-5-5',
  },
  dataDir: path.join(root, 'data'),
};
