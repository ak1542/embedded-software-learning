#!/usr/bin/env node
// Load pages of the real site in a headless browser and report what each one contains.
//   node check-pages.mjs [--only id1,id2] [--shots dir]        (run inside the repo)
// Fails (exit 1) when a page has console errors or a diagram that did not draw.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFileSync, mkdirSync } from 'node:fs';
import { serve, findRoot } from './serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');

const args = process.argv.slice(2);
const val = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const site = val('--site') ? resolve(val('--site')) : findRoot();
const only = val('--only') ? new Set(val('--only').split(',')) : null;
const shots = val('--shots') && resolve(val('--shots'));
if (shots) mkdirSync(shots, { recursive: true });

const nb = JSON.parse(readFileSync(resolve(site, 'content/notebook.json'), 'utf8'));
const pages = [];
(function walk(list) { for (const s of list) { pages.push([s.id, s.title]); walk(s.children || []); } })(nb.sections);

const { url, close } = await serve(site);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => !/sandboxed/.test(e.message) && errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/sandboxed|ERR_|Failed to load resource/.test(m.text()) && errors.push(m.text()));
let bad = 0;
for (const [id, title] of pages.filter(([id]) => !only || only.has(id))) {
  errors.length = 0;
  await page.goto(`${url}/#/${id}`);
  await page.waitForSelector('.doc .ProseMirror', { timeout: 15000 });
  await page.waitForTimeout(1500);
  const m = await page.evaluate(() => ({
    headings: document.querySelectorAll('.doc h1,.doc h2,.doc h3,.doc h4').length,
    tables: document.querySelectorAll('.doc table').length,
    code: document.querySelectorAll('.doc pre').length,
    callouts: document.querySelectorAll('.doc .callout').length,
    animations: document.querySelectorAll('.doc .html-anim iframe').length,
    images: document.querySelectorAll('.doc .media-img img').length,
    diagrams: document.querySelectorAll('.doc .diagram-out svg').length,
    diagramErrors: document.querySelectorAll('.doc .diagram-out .block-unknown').length,
  }));
  const fail = errors.length || m.diagramErrors;
  if (fail) bad++;
  console.log(`${fail ? 'FAIL' : 'ok  '} ${title.padEnd(38)} ${JSON.stringify(m)}${errors.length ? ' ERRORS ' + JSON.stringify(errors) : ''}`);
  if (shots) {
    for (const f of await page.$$('.html-anim iframe')) await f.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    await page.screenshot({ path: resolve(shots, `${id}.png`), fullPage: true });
  }
}
await browser.close();
close();
process.exit(bad ? 1 : 0);
