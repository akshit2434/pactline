// Approve a PayPal sandbox order as the sandbox PERSONAL buyer using headless Chrome (test/QA helper only).
// Usage: node scripts/approve.mjs "<approve_url>"   (reads PAYPAL_SANDBOX_BUYER_EMAIL/PASSWORD from env/keys file)
import { chromium } from 'playwright-core';
import '../src/config.js';

export async function approve(url, { headless = true, log = () => {} } = {}) {
  const email = process.env.PAYPAL_SANDBOX_BUYER_EMAIL, pw = process.env.PAYPAL_SANDBOX_BUYER_PASSWORD;
  if (!email || !pw) throw new Error('buyer credentials missing');
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    log('opened', page.url().slice(0, 80));
    // email step
    const emailBox = page.locator('input[name="login_email"], #email').first();
    await emailBox.waitFor({ timeout: 40000 });
    await emailBox.fill(email);
    const next = page.locator('#btnNext, button:has-text("Next")').first();
    if (await next.isVisible().catch(() => false)) { await next.click(); }
    const pwBox = page.locator('input[name="login_password"], #password').first();
    await pwBox.waitFor({ timeout: 40000 });
    await pwBox.fill(pw);
    await page.locator('#btnLogin, button:has-text("Log In")').first().click();
    log('logged in');
    // review page: consent / complete purchase / authorize
    const btn = page.locator('#payment-submit-btn, button:has-text("Complete Purchase"), button:has-text("Authorize"), button:has-text("Continue"), button:has-text("Pay Now"), [data-testid="submit-button-initial"], button:has-text("Agree")').first();
    await btn.waitFor({ timeout: 60000 });
    await page.waitForTimeout(2500);
    try { await btn.click({ timeout: 15000 }); } catch (e) {
      await page.screenshot({ path: '/tmp/approve-fail.png' });
      const btns = await page.locator('button, [role=button]').evaluateAll((els) => els.map((x) => (x.innerText || '').trim().slice(0, 30) + '|' + (x.disabled ? 'disabled' : 'ok')).filter(Boolean).slice(0, 20));
      throw new Error('click failed; url=' + page.url().slice(0, 90) + ' buttons=' + JSON.stringify(btns));
    }
    log('clicked', (await btn.innerText().catch(() => '?')).slice(0, 30));
    await page.waitForURL((u) => !/paypal\.com/.test(u.hostname) || /return/.test(u.href), { timeout: 60000 }).catch(() => {});
    log('final', page.url().slice(0, 100));
    return page.url();
  } finally { await browser.close(); }
}

if (process.argv[1] && process.argv[1].endsWith('approve.mjs')) {
  approve(process.argv[2], { log: (...a) => console.log('[approve]', ...a) }).then((u) => console.log('done', u.slice(0, 120))).catch((e) => { console.error('approve failed:', e.message.slice(0, 300)); process.exit(1); });
}
