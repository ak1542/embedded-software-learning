import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collect } from '../scripts/stamp.mjs';

test('version.json matches the current code (run "node scripts/stamp.mjs" after changing code)', () => {
  const stored = JSON.parse(readFileSync(new URL('../version.json', import.meta.url), 'utf8'));
  assert.deepEqual(stored, collect());
});
