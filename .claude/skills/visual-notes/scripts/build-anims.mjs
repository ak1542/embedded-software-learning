#!/usr/bin/env node
// Turn animation sources into finished single-file animations.
//   node build-anims.mjs <srcDir> <outDir>
// Each source .html contains the markers /*BASE_CSS*/ and /*BASE_JS*/, which are replaced by templates/base.css and base.js.
// (Function replacers are used on purpose: a plain string replacement would mangle `$$` in the helper code.)
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const [src, out] = process.argv.slice(2).map((p) => p && resolve(p));
if (!src || !out) {
  console.error('usage: build-anims.mjs <srcDir> <outDir>');
  process.exit(2);
}
const here = new URL('../templates/', import.meta.url);
const css = readFileSync(new URL('base.css', here), 'utf8');
const js = readFileSync(new URL('base.js', here), 'utf8');
mkdirSync(out, { recursive: true });
for (const f of readdirSync(src).filter((n) => n.endsWith('.html') && !n.startsWith('_'))) {
  const html = readFileSync(resolve(src, f), 'utf8').replace('/*BASE_CSS*/', () => css).replace('/*BASE_JS*/', () => js);
  if (/https?:\/\/(?!www\.w3\.org)/.test(html.replace(/<a [^>]*>/g, ''))) console.warn(`warning: ${f} mentions an external URL; animations must be self-contained`);
  writeFileSync(resolve(out, f), html);
  console.log(`built ${f} (${Math.round(html.length / 1024)} KB)`);
}
