// Screenshots of every screen at 1920, 1280 and 390 wide plus an overflow check. Needs a server on :3101 (PAYPAL_MODE=mock PACTLINE_AI_OFFLINE=1 PORT=3101 npm start).
import { chromium } from 'playwright-core';
const OUT = '/home/akshit/devos-host/desk/screenshots/pactline/v2/';
const B = 'http://127.0.0.1:3101/';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
const sizes = [[1920, 1080], [1280, 720], [390, 844]];
const pages = [['compose', '?still=1'], ['filled', '?still=1&screen=filled'], ['review', '?still=1&screen=review'], ['hold', '?still=1&screen=hold'], ['deal-midway', '?still=1&seed=midway'], ['deal-done', '?still=1&seed=done'], ['ledger', '?still=1&seed=done&then=ledger']];
for (const [w, hgt] of sizes) {
  const ctx = await browser.newContext({ viewport: { width: w, height: hgt } });
  for (const [name, q] of pages) {
    const p = await ctx.newPage();
    await p.goto(B + q); await p.waitForTimeout(1800);
    if (name === 'filled') { await p.click('.chip >> nth=2'); await p.waitForTimeout(1500); }
    const over = await p.evaluate(() => {
      const bad = []; const vw = document.documentElement.clientWidth;
      if (document.documentElement.scrollWidth > vw + 1) bad.push('page scrollX ' + document.documentElement.scrollWidth + '>' + vw);
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('.sr-only,.ag-root-wrapper')) continue;
        const r = el.getBoundingClientRect(); if (!r.width) continue;
        if (r.right > vw + 1 && cs.position !== 'fixed') bad.push((el.id || el.className || el.tagName).toString().slice(0, 40) + ' right=' + Math.round(r.right));
        if (el.scrollWidth > el.clientWidth + 2 && ['visible'].includes(cs.overflowX) && el.children.length === 0 && el.textContent.trim()) bad.push('text overflow: ' + (el.className || el.tagName) + ' "' + el.textContent.trim().slice(0, 30) + '"');
      }
      return [...new Set(bad)].slice(0, 8);
    });
    console.log(w, name, over.length ? over.join(' | ') : 'ok');
    await p.screenshot({ path: `${OUT}${name}-${w}.png`, fullPage: true });
    await p.close();
  }
  await ctx.close();
}
await browser.close();
