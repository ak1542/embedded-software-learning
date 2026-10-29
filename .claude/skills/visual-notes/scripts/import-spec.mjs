#!/usr/bin/env node
// Merge a spec file into the notebook.
//   node import-spec.mjs <spec.mjs> [--notebook content/notebook.json] [--update] [--dry]
// The spec exports default { parent?: 'existing-page-id', sections: [S(...), ...] }.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mergeSections, ids } from './notes-dsl.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const specPath = args.find((a) => !a.startsWith('--') && a !== val('--notebook'));
if (!specPath) {
  console.error('usage: import-spec.mjs <spec.mjs> [--notebook path] [--update] [--dry]');
  process.exit(2);
}
const nbPath = resolve(val('--notebook', 'content/notebook.json'));
const spec = (await import(pathToFileURL(resolve(specPath)).href)).default;
const nb = JSON.parse(readFileSync(nbPath, 'utf8'));
const before = nb.sections.length;
mergeSections(nb, spec.sections, { parent: spec.parent || null, update: flag('--update') });
if (!flag('--dry')) writeFileSync(nbPath, JSON.stringify(nb, null, 2) + '\n');
console.log(`${flag('--dry') ? '[dry run] ' : ''}added ${ids(spec.sections).length} pages${spec.parent ? ` under "${spec.parent}"` : ''}; top-level sections ${before} -> ${nb.sections.length}`);
