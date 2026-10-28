import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { migrate, SCHEMA_VERSION, DEFAULT_SETTINGS } from '../js/schema.js';
import * as model from '../js/model.js';

const fresh = () =>
  migrate({
    schemaVersion: 1,
    sections: [
      { id: 'a', title: 'A', children: [{ id: 'a1', title: 'A1' }, { id: 'a2', title: 'A2' }] },
      { id: 'b', title: 'B' },
    ],
  });

test('the shipped notebook loads', () => {
  const nb = migrate(JSON.parse(readFileSync(new URL('../content/notebook.json', import.meta.url))));
  assert.equal(nb.schemaVersion, SCHEMA_VERSION);
  assert.ok(model.flatten(nb).length > 5);
});

test('v0 notebooks are upgraded: a markdown `content` string becomes a text block', () => {
  const nb = migrate({ sections: [{ title: 'Old', content: '# hi', blocks: [{ type: 'code', data: { code: 'x' } }] }] });
  const [node] = nb.sections;
  assert.equal(nb.schemaVersion, SCHEMA_VERSION);
  assert.equal(node.content, undefined);
  assert.deepEqual(node.blocks.map((b) => b.type), ['text', 'code']);
  assert.equal(node.blocks[0].data.md, '# hi');
  assert.ok(node.id && node.blocks.every((b) => b.id));
});

test('missing settings get current defaults, saved ones are kept', () => {
  const nb = migrate({ schemaVersion: 1, settings: { theme: 'dark' }, sections: [] });
  assert.equal(nb.settings.theme, 'dark');
  assert.equal(nb.settings.fontSize, DEFAULT_SETTINGS.fontSize);
});

test('unknown fields and block types survive a load', () => {
  const nb = migrate({
    schemaVersion: 1,
    sections: [{ id: 's', title: 'S', future: 1, blocks: [{ id: 'x', type: 'hologram', data: { z: 1 }, extra: true }] }],
  });
  assert.equal(nb.sections[0].future, 1);
  assert.deepEqual(nb.sections[0].blocks[0], { id: 'x', type: 'hologram', data: { z: 1 }, extra: true });
});

test('a notebook from a newer site version is refused instead of being damaged', () => {
  assert.throws(() => migrate({ schemaVersion: SCHEMA_VERSION + 1, sections: [] }), /Hard-reload/);
});

test('add, find and remove sections and subsections', () => {
  const nb = fresh();
  const c = model.addNode(nb, null, 'C');
  const a3 = model.addNode(nb, 'a', 'A3');
  assert.deepEqual(model.locate(nb, a3.id).path.map((n) => n.id), ['a', a3.id]);
  assert.equal(nb.sections.at(-1), c);
  model.removeNode(nb, 'a');
  assert.equal(model.locate(nb, 'a1'), null);
  assert.deepEqual(nb.sections.map((n) => n.id), ['b', c.id]);
});

test('move, indent and outdent sections', () => {
  const nb = fresh();
  assert.equal(model.moveNode(nb, 'a', -1), false);
  assert.ok(model.moveNode(nb, 'a2', -1));
  assert.deepEqual(nb.sections[0].children.map((n) => n.id), ['a2', 'a1']);
  assert.ok(model.indentNode(nb, 'b'));
  assert.deepEqual(nb.sections[0].children.map((n) => n.id), ['a2', 'a1', 'b']);
  assert.ok(model.outdentNode(nb, 'a1'));
  assert.deepEqual(nb.sections.map((n) => n.id), ['a', 'a1']);
  assert.equal(model.outdentNode(nb, 'a'), false);
  assert.deepEqual(model.flatten(nb).map((n) => n.id), ['a', 'a2', 'b', 'a1']);
});

test('block insert, move, duplicate, remove and counts', () => {
  const nb = fresh();
  const node = model.locate(nb, 'a').node;
  const t = model.insertBlock(node, 0, 'text', { md: 'one' });
  const c = model.insertBlock(node, 99, 'code', { code: 'x' });
  assert.ok(model.moveBlock(node, c.id, -1));
  assert.deepEqual(node.blocks.map((b) => b.id), [c.id, t.id]);
  const copy = model.duplicateBlock(node, t.id);
  assert.notEqual(copy.id, t.id);
  assert.deepEqual(copy.data, t.data);
  copy.data.md = 'changed';
  assert.equal(t.data.md, 'one');
  assert.ok(model.removeBlock(node, c.id));
  model.insertBlock(model.locate(nb, 'a1').node, 0, 'divider');
  assert.deepEqual(model.countContents(node), { sections: 2, blocks: 3 });
});
