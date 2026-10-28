import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numberHeadings } from '../editor/src/numbering.js';

test('headings are numbered like an outline', () => {
  assert.deepEqual(numberHeadings([1, 2, 2, 3, 1, 2]), ['1', '1.1', '1.2', '1.2.1', '2', '2.1']);
});

test('numbering starts at the shallowest level used on the page', () => {
  assert.deepEqual(numberHeadings([2, 3, 3, 2]), ['1', '1.1', '1.2', '2']);
});

test('a skipped level still gets a sensible number, and no headings gives none', () => {
  assert.deepEqual(numberHeadings([1, 3, 1]), ['1', '1.1.1', '2']);
  assert.deepEqual(numberHeadings([]), []);
});
