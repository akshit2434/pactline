// Light UI smoke: loads the SPA in headless Chrome against the running server, checks for console errors, saves screenshots.
import { chromium } from 'playwright-core';
const B = process.env.BASE || 'http://127.0.0.1:3100';
const seed = await (await fetch(B + '/api/demo/seed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stage: 'midway' }) })).json();
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = []; page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); }); page.on('pageerror', (e) => errors.push('pageerror ' + e.message.slice(0, 160)));
const shots = [['home', '/'], ['deal', `/#/deal/${seed.id}`], ['ledger', `/#/deal/${seed.id}/ledger`]];
for (const [name, url] of shots) { await page.goto(B + url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {}); await page.waitForTimeout(1500); await page.screenshot({ path: `/tmp/pactline-${name}.png` }); console.log(name, page.url().replace(B, ''), (await page.title())); }
console.log('console errors:', errors.length ? errors : 'none');
await browser.close();
