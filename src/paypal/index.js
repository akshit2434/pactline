import { config } from '../config.js';
import { LivePayPal } from './live.js';

/** Live PayPal sandbox client (verified by fetching a token), or null when keys are missing / mode=mock. */
export async function createPayPal(log = console.log) {
  if (config.paypal.mode === 'mock') return null;
  const pp = new LivePayPal({ ...config.paypal, currency: 'USD' });
  await pp.accessToken();
  pp.currencyNote = 'USD (the sandbox merchant must be a US business account; India-based sandbox merchants reject every currency at checkout).';
  log('[paypal] live sandbox OK');
  return pp;
}
