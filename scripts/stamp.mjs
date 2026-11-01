// Writes version.json: a content hash for every code and style file the pages load.
// The pages fetch it fresh on every visit and load each file as "file?v=<hash>", so a changed
// file is always downloaded again and an unchanged one stays cached. Run after changing code:
//   node scripts/stamp.mjs     (npm run stamp)
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function collect() {
  const list = [];
  const addDir = (dir, re) => readdirSync(join(root, dir)).filter((f) => re.test(f)).forEach((f) => list.push(`${dir}/${f}`));
  addDir('js', /\.js$/);
  addDir('js/build', /\.js$/);
  addDir('css', /\.css$/);
  list.push('vendor/editor.bundle.js', 'vendor/export-docx.bundle.js', 'vendor/highlight-github-dark.min.css');
  const files = {};
  for (const p of list.sort()) files[p] = createHash('sha1').update(readFileSync(join(root, p))).digest('hex').slice(0, 10);
  return { files };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(join(root, 'version.json'), JSON.stringify(collect(), null, 1) + '\n');
  console.log('version.json updated');
}
