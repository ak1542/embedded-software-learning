import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../js/schema.js';
import { S, P, H, UL, TABLE, CODE, CALLOUT, ANIM, DIAGRAM, TASKLIST, mergeSections } from '../.claude/skills/visual-notes/scripts/notes-dsl.mjs';

const sample = () => [
  S('s-t', 'Topic', [H(2, 'Intro'), P('Uses `I2C` and **two** wires, see [next](#/s-t-b).'), UL(['a', 'b']), TABLE(['x', 'y'], [['1', '2']]), CODE('c', 'int x;'), CALLOUT('tip', 'hi'), ANIM('demo', 300, 'Demo'), DIAGRAM('flowchart LR\n A-->B'), TASKLIST(['can explain'])], [S('s-t-b', 'Sub', [P('x')])]),
];

test('DSL output survives migrate() unchanged', () => {
  const nb = { schemaVersion: 2, settings: {}, sections: sample() };
  const out = migrate(JSON.parse(JSON.stringify(nb)));
  assert.deepEqual(out.sections, nb.sections);
});

test('merge is additive, refuses existing ids, and leaves others untouched', () => {
  const other = S('s-other', 'Other', [P('keep')]);
  const nb = { schemaVersion: 2, settings: { theme: 'dark' }, sections: [other] };
  const before = JSON.stringify(other);
  mergeSections(nb, sample());
  assert.equal(JSON.stringify(nb.sections[0]), before);
  assert.equal(nb.sections.length, 2);
  assert.throws(() => mergeSections(nb, sample()));
  mergeSections(nb, sample(), { update: true });
  assert.equal(nb.sections.length, 2);
  assert.equal(nb.settings.theme, 'dark');
});

test('parent attaches new sections as children', () => {
  const nb = { schemaVersion: 2, settings: {}, sections: [S('s-p', 'P', [P('x')])] };
  mergeSections(nb, [S('s-c', 'C', [P('y')])], { parent: 's-p' });
  assert.equal(nb.sections[0].children[0].id, 's-c');
});
