#!/usr/bin/env node
// Render a DRAFT before anything is published: a throw-away copy of the site with the draft merged in.
//   node preview.mjs --spec spec.mjs [--anims builtAnimationsDir] --out shotsDir
// The real notebook and media folders are never modified. Writes one PNG per new page and one per new animation.
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, cpSync, mkdtempSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { serve, findRoot } from './serve.mjs';
import { mergeSections, ids } from './notes-dsl.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');

const args = process.argv.slice(2);
const val = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
if (!val('--spec') || !val('--out')) { console.error('usage: preview.mjs --spec spec.mjs [--anims dir] --out dir'); process.exit(2); }
const root = findRoot();
const out = resolve(val('--out'));
mkdirSync(out, { recursive: true });

// 1. stage a copy of just what the site needs
const stage = mkdtempSync(join(tmpdir(), 'visual-notes-preview-'));
for (const f of ['index.html']) cpSync(join(root, f), join(stage, f));
for (const d of ['css', 'js', 'vendor']) cpSync(join(root, d), join(stage, d), { recursive: true });
mkdirSync(join(stage, 'content/media/animations'), { recursive: true });
if (existsSync(join(root, 'content/media/animations'))) cpSync(join(root, 'content/media/animations'), join(stage, 'content/media/animations'), { recursive: true });
const newAnims = [];
if (val('--anims')) {
  for (const f of readdirSync(resolve(val('--anims'))).filter((n) => n.endsWith('.html'))) {
    cpSync(join(resolve(val('--anims')), f), join(stage, 'content/media/animations', f));
    newAnims.push(f);
  }
}
const spec = (await import(pathToFileURL(resolve(val('--spec'))).href)).default;
const nb = JSON.parse(readFileSync(join(root, 'content/notebook.json'), 'utf8'));
mergeSections(nb, spec.sections, { parent: spec.parent || null });
writeFileSync(join(stage, 'content/notebook.json'), JSON.stringify(nb));

// 2. render
const { url, close } = await serve(stage);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1300, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => !/sandboxed/.test(e.message) && errors.push(e.message));
for (const id of ids(spec.sections)) {
  await page.goto(`${url}/#/${id}`);
  await page.waitForSelector('.doc .ProseMirror', { timeout: 15000 });
  await page.waitForTimeout(1200);
  // sandboxed frames only paint once visible: scroll through the page
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 600) { await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(250); }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, `page-${id}.png`), fullPage: true });
  console.log(`page ${id} -> page-${id}.png`);
}
for (const f of newAnims) {
  await page.goto(`${url}/content/media/animations/${f}`);
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(out, `anim-${f.replace('.html', '')}.png`), fullPage: true });
  console.log(`animation ${f} -> anim-${f.replace('.html', '')}.png`);
}
console.log(errors.length ? `ERRORS: ${JSON.stringify(errors)}` : 'no page errors');
await browser.close();
close();
rmSync(stage, { recursive: true, force: true });
process.exit(errors.length ? 1 : 0);
