// v3 screenshots: confirmation window (client + freelancer), dispute sheet, disputed state, Verified popover.
// Needs: PAYPAL_MODE=mock PACTLINE_AI_OFFLINE=1 PACTLINE_ALLOW_PRIVATE_URLS=1 PORT=3102 npm start
import { chromium } from 'playwright-core';
const OUT = '/home/akshit/devos-host/desk/screenshots/pactline/v3/';
const B = 'http://127.0.0.1:3102';
const j = async (method, url, body) => (await fetch(B + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json();

async function pendingDeal() {
  const { contract } = await j('GET', '/api/demo/contract');
  const d = await j('POST', '/api/deals', { contract });
  const f = await j('POST', `/api/deals/${d.id}/fund`);
  await j('POST', `/api/deals/${d.id}/fund/complete`, { order_id: f.order_id });
  const r = await j('POST', `/api/deals/${d.id}/milestones/m1/submit`, { url: contract.milestones[0].oracle.url });
  if (r.result?.outcome !== 'awaiting_confirmation') console.log('WARN submit outcome', JSON.stringify(r).slice(0, 300));
  return d.id;
}
const overflow = (p) => p.evaluate(() => {
  const bad = []; const vw = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > vw + 1) bad.push('page scrollX');
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect(); if (!r.width) continue;
    if ((r.right > vw + 1 || r.left < -1) && cs.position !== 'fixed') bad.push((el.id || el.className || el.tagName).toString().slice(0, 40) + ` [${Math.round(r.left)},${Math.round(r.right)}]`);
  }
  return [...new Set(bad)].slice(0, 6);
});

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
for (const [w, hgt] of [[1920, 1080], [390, 844]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: hgt } });
  const shot = async (p, name) => { console.log(w, name, (await overflow(p)).join(' | ') || 'ok'); await p.screenshot({ path: `${OUT}${name}-${w}.png`, fullPage: true }); };
  const id = await pendingDeal();
  let p = await ctx.newPage();
  await p.goto(`${B}/?still=1&deal=${id}`); await p.waitForSelector('#confirm-m1', { timeout: 8000 }).catch(() => {}); await p.waitForTimeout(800);
  await shot(p, 'confirm-client');
  await p.click('.verified button').catch(() => {}); await p.waitForTimeout(400); await shot(p, 'verified-popover'); await p.keyboard.press('Escape');
  await p.click('#dispute-m1'); await p.waitForTimeout(500); await shot(p, 'dispute-sheet');
  await p.selectOption('#dispute-criterion', { index: 1 }); await p.fill('#dispute-reason', 'The staging page shows the old headline, not the approved one.');
  await p.click('#confirm-dispute'); await p.waitForTimeout(1200); await shot(p, 'disputed-client');
  await p.close();
  p = await ctx.newPage(); await p.goto(`${B}/?still=1&role=freelancer&deal=${id}`); await p.waitForTimeout(1800); await shot(p, 'disputed-freelancer'); await p.close();
  const id2 = await pendingDeal();
  p = await ctx.newPage(); await p.goto(`${B}/?still=1&role=freelancer&deal=${id2}`); await p.waitForTimeout(1800); await shot(p, 'confirm-freelancer'); await p.close();
  await ctx.close();
}
await browser.close();
