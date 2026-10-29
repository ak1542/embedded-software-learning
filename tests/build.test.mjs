import test from 'node:test';
import assert from 'node:assert/strict';
import { preprocess } from '../js/build/preprocess.js';
import { parseScript } from '../js/build/ldscript.js';
import { compile } from '../js/build/compile.js';
import { build } from '../js/build/pipeline.js';
import { SAMPLES } from '../js/build/samples.js';

const obj = (src, opts = {}) => compile(preprocess({ 'a.c': src }, 'a.c', { cpp: !!opts.cpp }).text, { name: 'a.o', ...opts });
const sec = (o, n) => o.sections.find((s) => s.name === n);

test('preprocessor: macros, conditionals and includes', () => {
  const r = preprocess({ 'a.c': '#include "a.h"\n#define SQ(x) ((x)*(x))\n#if defined(ON) && N > 1\nint a = SQ(3);\n#else\nint b = LEN;\n#endif', 'a.h': '#ifndef H\n#define H\n#define LEN 4\n#endif' }, 'a.c', { defines: { N: 2 } });
  assert.match(r.text, /int b = 4;/);
  assert.doesNotMatch(r.text, /int a/);
  const on = preprocess({ 'a.c': '#if defined(ON) && N > 1\nint a = SQ(3);\n#endif\n#define SQ(x) ((x)*(x))\nint c = SQ(3);' }, 'a.c', { defines: { ON: 1, N: 2 } });
  assert.match(on.text, /int a = SQ\(3\);/);
  assert.match(on.text, /int c = \(\(3\)\*\(3\)\);/);
});

test('compiler: data goes to the right sections with the right sizes', () => {
  const o = obj('#include <stdint.h>\nuint32_t a = 5;\nuint8_t b[10];\nconst char s[] = "hi";\nstatic int z = 0;\nconst uint16_t t[3] = {1,2,3};\ntypedef struct { uint8_t x; uint32_t y; uint16_t z; } S;\nS cfg = {1, 2, 3};');
  assert.equal(sec(o, '.data.a').size, 4);
  assert.equal(sec(o, '.bss.b').size, 10);
  assert.equal(sec(o, '.bss.b').type, 'NOBITS');
  assert.equal(sec(o, '.rodata.s').size, 3);
  assert.equal(sec(o, '.bss.z').size, 4);
  assert.equal(sec(o, '.rodata.t').size, 6);
  assert.equal(sec(o, '.data.cfg').size, 12); // 1 + 3 padding + 4 + 2 + 2 padding
  assert.deepEqual([...sec(o, '.data.a').bytes], [5, 0, 0, 0]);
});

test('compiler: custom section attribute and function sections', () => {
  const o = obj('void f(void) {}\nint g __attribute__((section(".mydata"))) = 3;');
  assert.ok(sec(o, '.text.f'));
  assert.ok(sec(o, '.mydata'));
});

test('linker script parser reads MEMORY and SECTIONS', () => {
  const s = parseScript('ENTRY(start)\nMEMORY { A (rx): ORIGIN = 0x1000, LENGTH = 4K\n B (rw): ORIGIN = 0x2000, LENGTH = 1K }\nSECTIONS { .text : { *(.text*) } > A\n .data : { *(.data*) } > B AT> A }');
  assert.equal(s.entry, 'start');
  assert.equal(s.memory.length, 2);
  const secs = s.items.filter((i) => i.kind === 'section');
  assert.equal(secs[1].lmaRegion, 'A');
});

test('linker places sections, resolves symbols and reports overflow', () => {
  const r = build({ files: SAMPLES.c.files, options: SAMPLES.c.options });
  const L = r.link;
  assert.deepEqual(L.errors, []);
  const data = L.outputs.find((o) => o.name === '.data');
  assert.equal(data.vma, 0x20000000);
  assert.ok(data.lma >= 0x08000000 && data.lma < 0x08100000, '.data is stored in Flash');
  assert.equal(L.linkerSymbols.find((s) => s.name === '_sidata').value, data.lma);
  assert.equal(L.linkerSymbols.find((s) => s.name === '_estack').value, 0x20020000);
  // the first vector word is the stack pointer, the second is Reset_Handler with the Thumb bit set
  const dv = new DataView(L.image.bytes.buffer);
  assert.equal(dv.getUint32(0, true), 0x20020000);
  assert.equal(dv.getUint32(4, true) % 2, 1);
  const tiny = structuredClone(SAMPLES.c.files);
  tiny['link.ld'] = tiny['link.ld'].replace('LENGTH = 512K', 'LENGTH = 64');
  const over = build({ files: tiny, options: SAMPLES.c.options }).link;
  assert.ok(over.errors.some((e) => /overflowed/.test(e)));
});

test('C++ sample: vtables, constructors and duplicate inline code', () => {
  const L = build({ files: SAMPLES.cpp.files, options: SAMPLES.cpp.options }).link;
  assert.deepEqual(L.errors, []);
  assert.ok(L.outputs.find((o) => o.name === '.init_array').size >= 4);
  assert.ok(L.discarded.some((d) => /COMDAT/.test(d.reason)));
  assert.ok(L.symbols.some((s) => /vtable for Led/.test(s.display)));
});

test('--gc-sections removes unreferenced functions', () => {
  const files = { ...SAMPLES.c.files, 'extra.c': 'void unused_function(void) { }\n' };
  const kept = build({ files, options: { ...SAMPLES.c.options, gc: false } }).link;
  const gc = build({ files, options: { ...SAMPLES.c.options, gc: true } }).link;
  assert.ok(kept.symbols.some((s) => s.name === 'unused_function'));
  assert.ok(!gc.symbols.some((s) => s.name === 'unused_function'));
  assert.ok(gc.discarded.some((d) => d.section === '.text.unused_function'));
});

test('broken input never throws', () => {
  for (const src of ['int', 'void f( {', '}}}', 'struct {', '#if\n', 'int a[ = {', '"unterminated']) {
    assert.doesNotThrow(() => build({ files: { 'a.c': src, 'l.ld': 'SECTIONS { .text : { *(.text*) } }' }, options: {} }));
  }
  assert.doesNotThrow(() => build({ files: { 'a.c': 'int x;', 'l.ld': 'SECTIONS {' }, options: {} }));
});
