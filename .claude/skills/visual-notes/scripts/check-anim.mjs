#!/usr/bin/env node
// Open one finished animation in a headless browser: light, dark and phone width.
//   node check-anim.mjs <file.html> [--width 1000] [--script "js to run in the page"] [--out shots-dir]
// Prints the page height and any JavaScript errors; saves screenshots when --out is given.
// --script runs after load (async allowed) and its return value is printed: use it to click controls and read results.
import { createRequire } from 'node:module';
import { resolve, basename } from 'node:path';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');

const args = process.argv.slice(2);
const val = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const file = args.find((a) => a.endsWith('.html'));
if (!file) { console.error('usage: check-anim.mjs <file.html> [--width N] [--script JS] [--out dir]'); process.exit(2); }
const out = val('--out');
if (out) mkdirSync(resolve(out), { recursive: true });
const widths = [Number(val('--width', 1000)), 380];
const browser = await chromium.launch();
let bad = 0;
for (const width of widths) {
  for (const scheme of ['light', 'dark']) {
    const page = await (await browser.newContext({ viewport: { width, height: 700 }, colorScheme: scheme })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('requestfailed', (r) => errors.push('request failed: ' + r.url()));
    await page.goto(pathToFileURL(resolve(file)).href);
    await page.waitForTimeout(500);
    if (val('--script') && width === widths[0] && scheme === 'light') {
      const r = await page.evaluate(`(async()=>{${val('--script')}})()`).catch((e) => 'SCRIPT ERROR: ' + e.message);
      console.log('script ->', JSON.stringify(r));
    }
    await page.waitForTimeout(300);
    const h = await page.evaluate(() => Math.ceil(document.documentElement.getBoundingClientRect().height));
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    if (out) await page.screenshot({ path: resolve(out, `${basename(file, '.html')}-${scheme}-${width}.png`), fullPage: true });
    console.log(`${basename(file)} ${width}px ${scheme}: height ${h}px${sideways ? ', SCROLLS SIDEWAYS' : ''}${errors.length ? ', ERRORS ' + JSON.stringify(errors) : ', no errors'}`);
    if (errors.length) bad++;
    await page.close();
  }
}
await browser.close();
process.exit(bad ? 1 : 0);
