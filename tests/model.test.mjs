import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { migrate, SCHEMA_VERSION, DEFAULT_SETTINGS } from '../js/schema.js';
import * as model from '../js/model.js';

const fresh = () =>
  migrate({
    schemaVersion: SCHEMA_VERSION,
    sections: [
      { id: 'a', title: 'A', children: [{ id: 'a1', title: 'A1' }, { id: 'a2', title: 'A2' }] },
      { id: 'b', title: 'B' },
    ],
  });

test('the shipped notebook loads', () => {
  const nb = migrate(JSON.parse(readFileSync(new URL('../content/notebook.json', import.meta.url))));
  assert.equal(nb.schemaVersion, SCHEMA_VERSION);
  assert.ok(Array.isArray(nb.sections));
});

test('v1 notebooks (typed blocks) are converted to a rich-text document', () => {
  const nb = migrate({
    schemaVersion: 1,
    sections: [
      {
        id: 's',
        title: 'Old',
        blocks: [
          { id: 'x', type: 'heading', data: { text: 'Intro', level: 2 } },
          { id: 'y', type: 'text', data: { md: 'Some words\n\n- one\n- two\n\n```c\nint x;\n```' } },
          { id: 'z', type: 'image', data: { src: 'content/media/p.png', alt: 'pic', size: 'medium' } },
          { id: 'u', type: 'hologram', data: { q: 1 } },
        ],
      },
    ],
  });
  const [node] = nb.sections;
  assert.equal(nb.schemaVersion, SCHEMA_VERSION);
  assert.equal(node.blocks, undefined);
  assert.deepEqual(node.doc.content.map((n) => n.type), ['heading', 'paragraph', 'bulletList', 'codeBlock', 'image', 'codeBlock']);
  assert.deepEqual(node.doc.content[4].attrs, { src: 'content/media/p.png', alt: 'pic', width: 50 });
  assert.match(node.doc.content[5].content[0].text, /hologram/, 'unknown block types are kept as readable data');
});

test('v0 drafts (markdown `content`) are upgraded through every version', () => {
  const nb = migrate({ sections: [{ title: 'Old', content: '# hi' }] });
  const [node] = nb.sections;
  assert.equal(nb.schemaVersion, SCHEMA_VERSION);
  assert.equal(node.content, undefined);
  assert.equal(node.doc.content[0].type, 'heading');
  assert.ok(node.id);
});

test('missing settings get current defaults, saved ones are kept', () => {
  const nb = migrate({ schemaVersion: SCHEMA_VERSION, settings: { theme: 'dark' }, sections: [] });
  assert.equal(nb.settings.theme, 'dark');
  assert.equal(nb.settings.fontSize, DEFAULT_SETTINGS.fontSize);
});

test('every section gets a valid document, and unknown fields survive a load', () => {
  const nb = migrate({ schemaVersion: SCHEMA_VERSION, sections: [{ id: 's', title: 'S', future: 1 }] });
  assert.equal(nb.sections[0].future, 1);
  assert.deepEqual(nb.sections[0].doc, { type: 'doc', content: [{ type: 'paragraph' }] });
  const doc = { type: 'doc', content: [{ type: 'hologram', attrs: { z: 1 } }] };
  assert.deepEqual(migrate({ schemaVersion: SCHEMA_VERSION, sections: [{ id: 's', title: 'S', doc }] }).sections[0].doc, doc);
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
  assert.ok(model.isEmptyDoc(c.doc));
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
  assert.equal(model.countSubsections(nb.sections[0]), 2);
});

test('document text for search, and the empty-page check', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'UART basics' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Start bit' }, { type: 'text', text: ' then data', marks: [{ type: 'bold' }] }] },
      { type: 'diagram', attrs: { code: 'flowchart LR\n A-->B' } },
    ],
  };
  const text = model.docText(doc);
  assert.match(text, /UART basics/);
  assert.match(text, /Start bit then data/);
  assert.match(text, /flowchart LR/);
  assert.equal(model.isEmptyDoc(doc), false);
  assert.equal(model.isEmptyDoc({ type: 'doc', content: [{ type: 'paragraph' }] }), true);
});

test('sections are numbered 1, 1.1, 1.2, 2 ...', () => {
  const nb = fresh();
  const nums = model.sectionNumbers(nb);
  assert.deepEqual([...nums], [['a', '1'], ['a1', '1.1'], ['a2', '1.2'], ['b', '2']]);
});
