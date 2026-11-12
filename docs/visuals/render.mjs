#!/usr/bin/env node
// Renders brand PNGs and gallery images at exact sizes with headless Chrome (playwright-core, a dev dependency).
// Usage: node docs/visuals/render.mjs [name ...]     (no args = everything)
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const A = (f) => path.join(root, 'assets', f);
const V = (f) => path.join(here, f);
const JOBS = [
  { name: 'logo-512', src: A('logo-symbol.svg'), out: A('logo-512.png'), w: 512, h: 512, transparent: true, svg: true },
  { name: 'favicon-32', src: A('favicon.svg'), out: A('favicon-32.png'), w: 32, h: 32, transparent: true, svg: true },
  { name: 'favicon-180', src: A('favicon.svg'), out: A('apple-touch-icon.png'), w: 180, h: 180, transparent: true, svg: true },
  { name: 'wordmark', src: A('logo-wordmark.svg'), out: A('logo-wordmark.png'), w: 1200, h: 270, transparent: true, svg: true },
  { name: 'social', src: V('social-preview.html'), out: A('social-preview.png'), w: 1280, h: 640 },
  { name: 'hero', src: V('gallery-1-hero.html'), out: A('gallery-1-hero.png'), w: 1500, h: 1000 },
  { name: 'how', src: V('gallery-2-how-it-works.html'), out: A('gallery-2-how-it-works.png'), w: 1500, h: 1000 },
  { name: 'arch', src: V('gallery-3-architecture.html'), out: A('gallery-3-architecture.png'), w: 1500, h: 1000 },
  { name: 'safety', src: V('gallery-4-safety.html'), out: A('gallery-4-safety.png'), w: 1500, h: 1000 },
  { name: 'sheet', src: V('brand-sheet.html'), out: A('brand-sheet.png'), w: 1500, h: 1000 },
];
const want = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
try {
  for (const j of JOBS.filter((j) => !want.length || want.includes(j.name))) {
    const page = await browser.newPage({ viewport: { width: j.w, height: j.h }, deviceScaleFactor: 1 });
    if (j.svg) {
      const html = `<!doctype html><style>html,body{margin:0;background:transparent}img{display:block;width:${j.w}px;height:${j.h}px;object-fit:contain}</style><img src="${pathToFileURL(j.src)}">`;
      await page.goto('about:blank'); await page.setContent(html); await page.waitForLoadState('networkidle');
    } else {
      await page.goto(pathToFileURL(j.src).href); await page.waitForLoadState('networkidle');
      await page.evaluate(() => document.fonts.ready);
    }
    await page.screenshot({ path: j.out, omitBackground: !!j.transparent, clip: { x: 0, y: 0, width: j.w, height: j.h } });
    await page.close();
    console.log('wrote', path.relative(root, j.out));
  }
} finally { await browser.close(); }
