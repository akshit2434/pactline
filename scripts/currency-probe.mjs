import { chromium } from 'playwright-core';
import { config } from '../src/config.js';
import { LivePayPal } from '../src/paypal/live.js';
const pp = new LivePayPal({ ...config.paypal, currency: 'USD' });
const email = process.env.PAYPAL_SANDBOX_BUYER_EMAIL, pw = process.env.PAYPAL_SANDBOX_BUYER_PASSWORD;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
let loggedIn = false;
for (const cur of (process.argv[2] || 'USD,EUR,GBP,AUD,CAD,SGD,JPY,HKD,CHF,MXN,BRL,SEK,PLN,NZD,THB,ILS').split(',')) {
  try {
    const o = await pp.createHoldOrder({ dealId: 'cur-' + cur, title: 'currency probe', amountCents: cur === 'JPY' ? 100000 : 1000, currency: cur, returnUrl: 'http://127.0.0.1:3100/ok', cancelUrl: 'http://127.0.0.1:3100/no' });
    await page.goto(o.approveUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (!loggedIn) {
      const e = page.locator('input[name="login_email"], #email').first(); await e.waitFor({ timeout: 40000 }); await e.fill(email);
      const n = page.locator('#btnNext').first(); if (await n.isVisible().catch(() => false)) await n.click();
      const p = page.locator('input[name="login_password"], #password').first(); await p.waitFor({ timeout: 40000 }); await p.fill(pw);
      await page.locator('#btnLogin').first().click(); loggedIn = true;
    }
    await page.waitForTimeout(9000);
    const u = page.url();
    const err = /genericError/.test(u);
    const btn = await page.locator('#payment-submit-btn, button:has-text("Complete Purchase"), button:has-text("Authorize"), button:has-text("Continue"), button:has-text("Agree")').count();
    console.log(cur.padEnd(4), err ? 'ERROR page' : btn ? 'REVIEW page (usable)' : 'unknown', u.slice(0, 90));
  } catch (e) { console.log(cur, 'ERR', e.message.slice(0, 120)); }
}
await browser.close();
