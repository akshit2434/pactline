// Screenshot of the SOW upload preview in Describe at 1920 and 390 (server on :3102, offline mode).
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const OUT = '/home/akshit/devos-host/desk/screenshots/pactline/v3/';
const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test/ai-fixtures/sow-sample.txt');
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu'] });
for (const [w, hh] of [[1920, 1080], [390, 844]]) {
  const p = await browser.newPage({ viewport: { width: w, height: hh } });
  await p.goto('http://127.0.0.1:3102/?still=1'); await p.waitForTimeout(1500);
  await p.setInputFiles('#sow-file', FIX); await p.waitForSelector('.sow-preview, .sow-box .field-error', { timeout: 20000 }); await p.waitForTimeout(1200);
  const over = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  console.log(w, 'sow-extracted', over ? 'PAGE OVERFLOW' : 'ok', await p.$eval('.sow-box', (e) => e.innerText.slice(0, 160)));
  await p.screenshot({ path: `${OUT}sow-extracted-${w}.png`, fullPage: true }); await p.close();
}
await browser.close();
