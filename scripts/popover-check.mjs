// Opens the Verified popover and a verdict popover at many widths and checks they stay inside the viewport.
// Needs a server on :3102 (see ui-shots-v3.mjs). Usage: node scripts/popover-check.mjs [dealId]
import { chromium } from 'playwright-core';
const B = 'http://127.0.0.1:3102';
const OUT = '/home/akshit/devos-host/desk/screenshots/pactline/v3/';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu'] });
let bad = 0;
for (const w of [320, 390, 768, 1024, 1280, 1920]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
  for (const [name, q, sel] of [['verified', '/?still=1&screen=review', '.verified button'], ['verdict', `/?still=1&deal=${process.argv[2] || ''}`, '.verdict button']]) {
    if (name === 'verdict' && !process.argv[2]) continue;
    const p = await ctx.newPage(); await p.goto(B + q); await p.waitForTimeout(1800);
    const btns = await p.$$(sel);
    for (const b of btns) {
      await b.scrollIntoViewIfNeeded(); await b.click(); await p.waitForTimeout(350);
      const r = await p.evaluate(() => { const e = document.querySelector('.pop'); if (!e) return null; const x = e.getBoundingClientRect(); return { l: x.left, r: x.right, vw: document.documentElement.clientWidth, sw: e.scrollWidth, cw: e.clientWidth }; });
      const ok = r && r.l >= 0 && r.r <= r.vw && r.sw <= r.cw + 1;
      if (!ok) bad++;
      console.log(w, name, r ? `left=${Math.round(r.l)} right=${Math.round(r.r)} vw=${r.vw}` : 'no popover', ok ? 'ok' : 'OVERFLOW');
      if (w === 390 || w === 1920) await p.screenshot({ path: `${OUT}popover-${name}-${w}.png` });
      await p.keyboard.press('Escape');
    }
    await p.close();
  }
  await ctx.close();
}
await browser.close();
console.log(bad ? `${bad} overflow(s)` : 'all popovers inside the viewport');
