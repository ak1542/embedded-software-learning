// Build Explorer UI: edit C / C++ files and a linker script, see the simulated preprocess, compile, link and image.
import { h, debounce } from '../dom.js';
import { SAMPLES } from './samples.js';
import { build, isSource, isHeader, isScript } from './pipeline.js';
import { hexDump, hx } from './hexview.js';

const KEY = 'esn-build-project-v1';
const $ = (s) => document.querySelector(s);
const hex = (n, w = 8) => '0x' + hx(n, w);
const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(n % 1048576 ? 2 : 0) + ' MB' : n >= 1024 ? (n / 1024).toFixed(n % 1024 ? 1 : 0) + ' KB' : n + ' B');

const TABS = [
  ['map', 'Memory map'],
  ['i', 'Preprocessed (.i)'],
  ['o', 'Object files (.o)'],
  ['link', 'Linker output'],
  ['elf', 'Executable (.axf / .elf)'],
  ['bin', 'Binary (.bin)'],
];

let state = load() || fresh('c');
let result = null;
const ui = { unit: null, section: null, open: new Set(), linkOpen: new Set(), binSection: '', binFrom: 0, symFilter: '' };

function fresh(k) {
  const s = SAMPLES[k];
  return { files: { ...s.files }, active: s.active, options: { ...s.options }, tab: 'map' };
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    return s && s.files && Object.keys(s.files).length ? s : null;
  } catch {
    return null;
  }
}
const save = debounce(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable */
  }
}, 300);

/* ---------- left side ---------- */
function renderFiles() {
  const box = $('#files');
  box.replaceChildren(
    ...Object.keys(state.files).map((n) =>
      h('button', { type: 'button', role: 'tab', class: n === state.active ? 'on' : '', onclick: () => { state.active = n; renderFiles(); } }, n,
        h('span', { class: 'x', title: 'Delete this file', onclick: (e) => { e.stopPropagation(); removeFile(n); } }, '×'))
    ),
    h('button', { type: 'button', class: 'add', title: 'Add a file (name.c, name.cpp, name.h or name.ld)', onclick: addFile }, '+ file')
  );
  const ed = $('#editor');
  ed.value = state.files[state.active] ?? '';
}
function addFile() {
  const n = prompt('File name (for example util.c, util.h, driver.cpp or other.ld):');
  if (!n || !/^[\w.\-/]+$/.test(n)) return;
  if (state.files[n] !== undefined) return alert('That file already exists.');
  state.files[n] = '';
  state.active = n;
  renderFiles();
  changed();
}
function removeFile(n) {
  if (!confirm(`Delete ${n}?`)) return;
  delete state.files[n];
  if (!Object.keys(state.files).length) state.files['main.c'] = '';
  if (state.active === n) state.active = Object.keys(state.files)[0];
  renderFiles();
  changed();
}
function renderOpts() {
  const o = state.options;
  const set = (k, v) => { o[k] = v; changed(); };
  const check = (k, label, title) => h('label', { title }, h('input', { type: 'checkbox', checked: !!o[k], onchange: (e) => set(k, e.target.checked) }), label);
  $('#opts').replaceChildren(
    h('label', { title: 'Compiler optimisation level. It changes the code size estimate.' }, 'Optimise ',
      h('select', { onchange: (e) => set('opt', e.target.value) }, ...['O0', 'O1', 'O2', 'Os', 'O3'].map((v) => h('option', { value: v, selected: o.opt === v }, '-' + v)))),
    h('label', { title: 'Like -D on the compiler command line: NAME or NAME=value, separated by spaces' }, 'Defines ',
      h('input', { type: 'text', size: 18, placeholder: 'DEBUG USE_UART=1', value: o.defines || '', oninput: (e) => set('defines', e.target.value) })),
    check('functionSections', '-ffunction-sections', 'One section per function (.text.name) so the linker can place or remove each one separately'),
    check('dataSections', '-fdata-sections', 'One section per variable (.data.name, .bss.name)'),
    check('gc', '--gc-sections', 'Linker removes sections nothing refers to (KEEP and the entry point are roots)')
  );
}
const changed = () => { save(); run(); };

/* ---------- running ---------- */
const run = debounce(() => {
  try {
    result = build(state);
  } catch (e) {
    console.error(e);
    result = { units: [], objects: [], link: null, diagnostics: [{ level: 'error', file: '', msg: `Internal error in the simulator: ${e.message}` }] };
  }
  renderDiag();
  renderTabs();
  renderView();
}, 350);

function renderDiag() {
  const box = $('#diag');
  const L = result.link;
  const items = [...result.diagnostics.filter((d) => d.level !== 'note')];
  if (L) {
    L.errors.forEach((m) => items.push({ level: 'error', msg: m }));
    L.warnings.forEach((m) => items.push({ level: 'warning', msg: m }));
  }
  const nodes = items.map((d) => h('div', { class: 'msg ' + d.level }, (d.level === 'error' ? '✖ ' : '⚠ ') + (d.file ? d.file + (d.line ? ':' + d.line : '') + ': ' : '') + d.msg));
  const notes = [...result.diagnostics.filter((d) => d.level === 'note').map((d) => d.msg), ...(L?.notes || []), ...result.objects.flatMap((o) => o.notes.map((n) => `${o.name}: ${n}`))];
  const unique = [...new Set(notes)];
  if (L && L.ok) nodes.unshift(h('p', { class: 'ok' }, '✓ Linked. ' + L.regions.map((r) => `${r.name}: ${kb(r.used)} of ${kb(r.length)}`).join(' · ')));
  if (unique.length) nodes.push(h('details', { class: 'msg note' }, h('summary', {}, `${unique.length} note${unique.length > 1 ? 's' : ''} about what the simulator assumed`), ...unique.map((n) => h('div', {}, '• ' + n))));
  box.replaceChildren(...nodes);
}

function renderTabs() {
  $('#tabs').replaceChildren(...TABS.map(([id, label]) => h('button', { type: 'button', role: 'tab', class: state.tab === id ? 'on' : '', onclick: () => { state.tab = id; save(); renderTabs(); renderView(); } }, label)));
}

function renderView() {
  const v = $('#view');
  const fn = { map: viewMap, i: viewPre, o: viewObjects, link: viewLink, elf: viewElf, bin: viewBin }[state.tab];
  const needLink = ['map', 'link', 'elf', 'bin'].includes(state.tab);
  if (needLink && !result.link) return v.replaceChildren(h('p', { class: 'muted' }, 'Nothing was linked yet. Fix the messages above: you need at least one .c / .cpp file and a linker script (.ld).'));
  v.replaceChildren(fn());
}

/* ---------- memory map ---------- */
const kindOf = (o) => (o.name === '.isr_vector' ? 'vec' : o.type === 'NOBITS' ? 'bss' : o.flags.includes('X') ? 'text' : o.flags.includes('W') ? 'data' : 'ro');
const LEGEND = [['vec', 'Vector table'], ['text', 'Code'], ['ro', 'Constants / strings'], ['data', 'Initialised variables'], ['bss', 'Zero-initialised / stack']];

function symbolsIn(contrib) {
  const L = result.link;
  return L.symbols.filter((s) => s.obj === contrib.obj?.name && s.addr >= contrib.vma && s.addr < contrib.vma + Math.max(contrib.size, 1) && s.input === contrib.sec?.name);
}

function viewMap() {
  const L = result.link;
  const wrap = h('div', {});
  wrap.append(h('div', { class: 'legend' }, ...LEGEND.map(([k, t]) => h('span', {}, h('i', { style: `background:var(--k-${k === 'vec' ? 'vec' : k})` }), t)), h('span', {}, h('i', { style: 'background:repeating-linear-gradient(135deg,var(--bg-sunk) 0 3px,var(--fg-muted) 3px 4px)' }), 'Load image: copy kept in Flash')), h('span', { class: 'muted' }, 'Click a block to see which files and symbols it contains. High addresses are at the top.'));
  const maps = h('div', { class: 'maps' });
  for (const r of L.regions) {
    const pct = r.length ? (r.used / r.length) * 100 : 0;
    const items = r.outputs.filter((o) => !o.empty && o.size > 0).map((o) => ({ o, lma: !!o.asLma, start: o.asLma ? o.lma : o.vma })).sort((a, b) => a.start - b.start);
    const stack = h('div', { class: 'stack' });
    items.forEach(({ o, lma, start }) => {
      const id = `${r.name}:${o.name}:${lma}`;
      const open = ui.open.has(id);
      const blk = h('div', { class: `blk k-${kindOf(o)}${lma ? ' lma' : ''}${open ? ' open' : ''}`, style: `min-height:${Math.round(34 + Math.min(150, Math.sqrt(o.size) * 2.2))}px`, onclick: () => { open ? ui.open.delete(id) : ui.open.add(id); renderView(); } },
        h('div', { class: 't' }, h('b', {}, lma ? `${o.name} (load image)` : o.name), h('span', { class: 'mono' }, `${o.size} B`)),
        h('div', { class: 'a mono' }, `${hex(start)} – ${hex(start + o.size - 1)}`));
      if (lma) blk.append(h('div', { class: 'a' }, `Copy of ${o.name}'s initial values. Startup code copies it to RAM at ${hex(o.vma)}.`));
      if (open && !lma) {
        const inn = h('div', { class: 'in', onclick: (e) => e.stopPropagation() });
        for (const c of o.contributions) {
          inn.append(h('div', {}, h('span', {}, c.kind === 'data' ? c.label : `${c.obj.name} :: ${c.sec.name}`, c.sec?.estimated ? h('span', { class: 'pill est' }, 'size estimated') : ''), h('span', { class: 'mono' }, `${hex(c.vma)} · ${c.size} B`)));
          if (c.kind === 'input') for (const s of symbolsIn(c)) inn.append(h('div', { class: 'sym' }, h('span', {}, s.display), h('span', { class: 'mono' }, `${hex(s.addr)} · ${s.size} B`)));
        }
        if (!o.contributions.length) inn.append(h('div', {}, h('span', { class: 'muted' }, 'Reserved by the linker script (no input sections), e.g. stack or heap space.')));
        blk.append(inn);
      }
      stack.append(blk);
    });
    const free = r.length - r.used;
    if (free > 0) stack.append(h('div', { class: 'blk free' }, h('div', { class: 't' }, h('span', {}, 'free'), h('span', { class: 'mono' }, kb(free))), h('div', { class: 'a mono' }, `${hex(r.origin + r.used)} – ${hex(r.origin + r.length - 1)}`)));
    maps.append(h('div', { class: 'region' + (r.used > r.length ? ' over' : '') },
      h('header', {}, h('b', {}, r.name), h('span', { class: 'mono muted' }, `${hex(r.origin)} – ${hex(r.origin + r.length - 1)}`), h('span', {}, `${kb(r.used)} of ${kb(r.length)} (${pct.toFixed(pct < 1 ? 2 : 1)}%)`), h('span', { class: 'pill' }, r.attrs)),
      h('div', { class: 'usage' }, h('i', { style: `width:${Math.min(100, Math.max(pct, 0.6))}%` })), stack));
  }
  wrap.append(maps);
  const data = L.outputs.find((o) => o.lma !== o.vma && o.type === 'PROGBITS' && o.size);
  if (data) wrap.append(h('p', { class: 'muted' }, `Why is ${data.name} in two places? Its variables must live in RAM (${hex(data.vma)}) so they can change, but the initial values must survive power-off, so they are stored in ${data.lmaRegion || 'Flash'} (${hex(data.lma)}). The start-up code copies them from the load address to RAM before main() runs.`));
  wrap.append(h('h2', {}, 'Symbols defined by the linker script'), linkerSymbolsTable(L));
  return wrap;
}

function linkerSymbolsTable(L) {
  if (!L.linkerSymbols.length) return h('p', { class: 'muted' }, 'None.');
  return h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Symbol'), h('th', { class: 'num' }, 'Value'))), h('tbody', {}, ...L.linkerSymbols.map((s) => h('tr', {}, h('td', { class: 'mono' }, s.name), h('td', { class: 'num mono' }, hex(s.value)))))));
}

/* ---------- preprocessed ---------- */
function pickUnit(list, key = 'unit') {
  if (!list.length) return null;
  if (!list.some((u) => u.source === ui[key])) ui[key] = list[0].source;
  return list.find((u) => u.source === ui[key]);
}
function selector(list, key, label) {
  return h('select', { 'aria-label': label, onchange: (e) => { ui[key] = e.target.value; ui.section = null; renderView(); } }, ...list.map((u) => h('option', { value: u.source, selected: u.source === ui[key] }, u.source)));
}
function viewPre() {
  const u = pickUnit(result.units);
  if (!u) return h('p', { class: 'muted' }, 'Add a .c or .cpp file.');
  const src = state.files[u.source].split('\n').length;
  const out = u.pre.text.split('\n').filter((l) => !/^# \d+ "/.test(l)).length;
  return h('div', {},
    h('p', { class: 'muted' }, 'The preprocessor expands #include and #define, removes comments and drops code excluded by #if. This is exactly what the compiler sees (a real .i file also contains marker lines like ', h('code', {}, '# 1 "main.c"'), ').'),
    h('div', { class: 'row' }, selector(result.units, 'unit', 'Source file'), h('span', { class: 'pill' }, `${src} lines in → ${out} lines out`), h('span', { class: 'pill' }, `includes: ${[...new Set(u.pre.includes)].join(', ') || 'none'}`)),
    h('pre', {}, u.pre.text));
}

/* ---------- object files ---------- */
const nmLetter = (s) => { const t = s.kind === 'text' ? 'T' : s.kind === 'bss' ? 'B' : s.kind === 'rodata' ? 'R' : 'D'; return s.bind === 'LOCAL' ? t.toLowerCase() : s.bind === 'WEAK' ? (t === 'T' ? 'W' : 'V') : t; };
function viewObjects() {
  const units = result.units.filter((u) => u.obj);
  const u = pickUnit(units);
  if (!u) return h('p', { class: 'muted' }, 'No object files yet.');
  const o = u.obj;
  if (!ui.section || !o.sections.some((s) => s.name === ui.section)) ui.section = o.sections[0]?.name;
  const sec = o.sections.find((s) => s.name === ui.section);
  const wrap = h('div', {},
    h('p', { class: 'muted' }, `${o.name} is relocatable: every function and variable sits in its own section with offset 0, and addresses are decided later by the linker. Code is shown as `, h('code', {}, '··'), ' because the simulator does not generate machine instructions.'),
    h('div', { class: 'row' }, selector(units, 'unit', 'Object file'), h('span', { class: 'pill' }, `${o.sections.length} sections`), h('span', { class: 'pill' }, `${o.symbols.filter((s) => !s.hidden).length} symbols`)));
  wrap.append(h('h2', {}, 'Sections (readelf -S)'), h('div', { class: 'scroll' }, h('table', {},
    h('thead', {}, h('tr', {}, ...['Name', 'Type', 'Flags', 'Size', 'Align', ''].map((t, i) => h('th', { class: i === 3 || i === 4 ? 'num' : '' }, t)))),
    h('tbody', {}, ...o.sections.map((s) => h('tr', { class: s.name === ui.section ? 'sel' : '', style: 'cursor:pointer', onclick: () => { ui.section = s.name; renderView(); } },
      h('td', { class: 'mono' }, s.name), h('td', {}, s.type), h('td', { class: 'mono' }, s.flags), h('td', { class: 'num' }, s.size), h('td', { class: 'num' }, s.align),
      h('td', {}, s.estimated ? h('span', { class: 'pill est', title: 'Machine code is not generated; the size is an estimate' }, 'size estimated') : '', s.comdat ? h('span', { class: 'pill', title: 'Inline/template code: duplicates in other files are merged by the linker' }, 'COMDAT') : '')))))));
  if (sec) {
    wrap.append(h('h2', {}, `Contents of ${sec.name}`));
    if (sec.type === 'NOBITS') wrap.append(h('p', { class: 'muted' }, `${sec.size} bytes of zero-initialised space. A .bss section takes no room in the file: only its size is stored, and the start-up code (or the loader) clears it at run time.`));
    else {
      wrap.append(hexDump({ bytes: sec.bytes, known: sec.known, rows: 64 }));
      if (sec.name.startsWith('.rodata.str')) wrap.append(h('p', { class: 'muted' }, 'Strings: ' + o.symbols.filter((s) => s.literal).map((s) => JSON.stringify(String.fromCharCode(...s.literal))).join(', ')));
    }
    if (sec.relocs.length) wrap.append(h('h3', {}, 'Relocations (the linker fills these in with final addresses)'), h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Offset'), h('th', {}, 'Refers to'))), h('tbody', {}, ...sec.relocs.map((r) => h('tr', {}, h('td', { class: 'mono' }, '+' + r.off), h('td', { class: 'mono' }, r.sym + (r.addend ? ` + ${r.addend}` : ''))))))));
  }
  wrap.append(h('h2', {}, 'Symbols (nm)'), h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ['Offset', 'Size', 'Type', 'Section', 'Name'].map((t, i) => h('th', { class: i < 2 ? 'num' : '' }, t)))),
    h('tbody', {}, ...o.symbols.filter((s) => !s.hidden).map((s) => h('tr', {}, h('td', { class: 'num mono' }, hex(s.value, 4)), h('td', { class: 'num' }, s.size), h('td', { class: 'mono' }, nmLetter(s)), h('td', { class: 'mono' }, s.section), h('td', { class: 'mono' }, s.display !== s.name ? `${s.display}  [${s.name}]` : s.name)))))));
  if (o.declared.length) wrap.append(h('p', { class: 'muted' }, 'Undefined here (resolved by the linker, shown as U in nm): ', h('code', {}, o.declared.join(', '))));
  return wrap;
}

/* ---------- linker output ---------- */
function viewLink() {
  const L = result.link;
  const wrap = h('div', {}, h('p', { class: 'muted' }, 'The linker walks the SECTIONS commands in order. For each output section it collects the matching input sections from the .o files (in file order), aligns them, and advances the location counter.'));
  wrap.append(h('div', { class: 'scroll' }, h('table', {},
    h('thead', {}, h('tr', {}, ['Output section', 'Address (VMA)', 'Load address (LMA)', 'Size', 'Region', 'Type'].map((t, i) => h('th', { class: i === 3 ? 'num' : '' }, t)))),
    h('tbody', {}, ...L.outputs.flatMap((o) => {
      const open = ui.linkOpen.has(o.name);
      const rows = [h('tr', { style: 'cursor:pointer', onclick: () => { open ? ui.linkOpen.delete(o.name) : ui.linkOpen.add(o.name); renderView(); } },
        h('td', { class: 'mono' }, (open ? '▾ ' : '▸ ') + o.name, o.orphan ? h('span', { class: 'pill est' }, 'orphan') : ''), h('td', { class: 'mono' }, hex(o.vma)), h('td', { class: 'mono' }, o.lma !== o.vma ? hex(o.lma) : '–'), h('td', { class: 'num' }, o.size), h('td', {}, o.region + (o.lmaRegion ? ` (load: ${o.lmaRegion})` : '')), h('td', {}, o.type === 'NOBITS' ? 'NOBITS (not in image)' : 'PROGBITS'))];
      if (open) for (const c of o.contributions) rows.push(h('tr', {}, h('td', { class: 'mono muted', style: 'padding-left:24px' }, c.kind === 'data' ? c.label : `${c.obj.name}(${c.sec.name})`), h('td', { class: 'mono' }, hex(c.vma)), h('td', {}), h('td', { class: 'num' }, c.size), h('td', { class: 'muted' }, c.keep ? 'KEEP' : ''), h('td', {})));
      return rows;
    })))));
  if (L.discarded.length) wrap.append(h('h2', {}, 'Removed / not placed'), h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Input section'), h('th', { class: 'num' }, 'Size'), h('th', {}, 'Why'))), h('tbody', {}, ...L.discarded.map((d) => h('tr', {}, h('td', { class: 'mono' }, `${d.obj}(${d.section})`), h('td', { class: 'num' }, d.size), h('td', {}, d.reason)))))));
  wrap.append(h('h2', {}, 'Symbols defined by the linker script'), linkerSymbolsTable(L));
  wrap.append(h('h2', {}, 'Map file'), h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => download('output.map', L.map) }, 'Download .map')), h('pre', {}, L.map));
  return wrap;
}
function download(name, text) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })), download: name });
  document.body.append(a);
  a.click();
  a.remove();
}

/* ---------- ELF ---------- */
function viewElf() {
  const L = result.link;
  const outs = L.outputs.filter((o) => !o.empty && o.size > 0);
  const total = L.size.text + L.size.data + L.size.bss;
  const symCount = L.symbols.length + L.linkerSymbols.length + 1;
  const wrap = h('div', {}, h('p', { class: 'muted' }, 'The .axf / .elf file is the linked program plus a table of contents. The loader or debugger uses the program headers; tools use the section headers and symbol table. Offsets below are illustrative.'));
  wrap.append(h('h2', {}, 'ELF header (readelf -h)'), h('table', {}, h('tbody', {},
    ...[['Class', 'ELF32'], ['Data', '2’s complement, little endian'], ['Machine', 'ARM (Thumb-2)'], ['Type', 'EXEC (executable file)'], ['Entry point', L.entry ? `${hex(L.entry.addr)}  (${L.entry.name}${L.entry.addr % 2 ? '' : ', Thumb bit added at run time'})` : 'not defined'], ['Program headers', L.segments.length], ['Section headers', outs.length + 5]].map(([k, v]) => h('tr', {}, h('th', {}, k), h('td', { class: 'mono' }, String(v)))))));
  wrap.append(h('h2', {}, 'Program headers (what the loader copies)'), h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ['Type', 'Offset', 'VirtAddr', 'PhysAddr', 'FileSiz', 'MemSiz', 'Flags', 'Sections'].map((t) => h('th', {}, t)))),
    h('tbody', {}, ...L.segments.map((s) => h('tr', {}, h('td', {}, s.type), h('td', { class: 'mono' }, hex(s.offset, 6)), h('td', { class: 'mono' }, hex(s.vaddr)), h('td', { class: 'mono' }, hex(s.paddr)), h('td', {}, s.filesz), h('td', {}, s.memsz), h('td', { class: 'mono' }, s.flags), h('td', { class: 'mono' }, s.sections.join(' '))))))));
  wrap.append(h('p', { class: 'muted' }, 'VirtAddr is where the bytes live at run time; PhysAddr is where they are stored in the file / Flash. They differ for .data (stored in Flash, used in RAM). MemSiz larger than FileSiz means .bss: zero space the loader or start-up code must clear.'));
  let idx = 1;
  const rows = outs.map((o) => [idx++, o.name, o.type === 'NOBITS' ? 'NOBITS' : 'PROGBITS', hex(o.vma), o.fileOffset != null ? hex(o.fileOffset, 6) : '', o.size, o.flags, o.align]);
  const strtab = L.symbols.reduce((a, s) => a + s.name.length + 1, 1);
  rows.push([idx++, '.symtab', 'SYMTAB', '', '', 16 * symCount, '', 4], [idx++, '.strtab', 'STRTAB', '', '', strtab, '', 1], [idx++, '.shstrtab', 'STRTAB', '', '', outs.reduce((a, o) => a + o.name.length + 1, 40), '', 1]);
  wrap.append(h('h2', {}, 'Section headers (readelf -S)'), h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ['Nr', 'Name', 'Type', 'Addr', 'Offset', 'Size', 'Flags', 'Align'].map((t) => h('th', {}, t)))), h('tbody', {}, ...rows.map((r) => h('tr', {}, r.map((c, i) => h('td', { class: i === 1 || i === 3 || i === 4 ? 'mono' : '' }, String(c)))))))));
  wrap.append(h('h2', {}, 'Size (arm-none-eabi-size)'), h('pre', {}, `   text    data     bss     dec     hex filename\n${String(L.size.text).padStart(7)} ${String(L.size.data).padStart(7)} ${String(L.size.bss).padStart(7)} ${String(total).padStart(7)} ${total.toString(16).padStart(7)} firmware.elf`),
    h('p', { class: 'muted' }, 'text = code + constants (stored in Flash). data = initialised variables (RAM, plus a copy in Flash). bss = zero-initialised variables (RAM only). Flash used ≈ text + data; RAM used ≈ data + bss (+ stack/heap you reserved).'));
  const filter = h('input', { type: 'search', placeholder: 'Find a function or variable…', value: ui.symFilter, oninput: (e) => { ui.symFilter = e.target.value; drawSyms(); } });
  const holder = h('div', { class: 'scroll' });
  const drawSyms = () => {
    const f = ui.symFilter.toLowerCase();
    const list = L.symbols.filter((s) => !f || s.display.toLowerCase().includes(f) || s.name.toLowerCase().includes(f));
    holder.replaceChildren(h('table', {}, h('thead', {}, h('tr', {}, ['Address', 'Size', 'Type', 'Output section', 'File', 'Name'].map((t, i) => h('th', { class: i < 2 ? 'num' : '' }, t)))), h('tbody', {}, ...list.slice(0, 400).map((s) => h('tr', {}, h('td', { class: 'num mono' }, hex(s.addr)), h('td', { class: 'num' }, s.size), h('td', { class: 'mono' }, nmLetter(s)), h('td', { class: 'mono' }, s.output), h('td', {}, s.obj), h('td', { class: 'mono' }, s.display))))));
  };
  drawSyms();
  wrap.append(h('h2', {}, 'Symbol table (nm -n)'), h('div', { class: 'row' }, filter), holder);
  return wrap;
}

/* ---------- binary ---------- */
function viewBin() {
  const L = result.link;
  const img = L.image;
  if (!img) return h('p', { class: 'muted' }, 'No flat image: there is nothing loadable, or the loadable sections are too far apart (see the warnings).');
  const PAGE = 256 * 16;
  const loadable = L.outputs.filter((o) => o.bytes && o.size > 0 && !o.noload);
  const wrap = h('div', {}, h('p', { class: 'muted' }, 'A .bin is the raw bytes that get programmed into Flash: no headers, starting at the lowest load address. .bss never appears (it has no contents), and .data appears at its load address (LMA). ', h('code', {}, '··'), ' marks machine-code bytes the simulator cannot generate (they are placeholders); everything else (vector table, constants, strings, initial values) is real.'));
  wrap.append(h('div', { class: 'row' }, h('span', { class: 'pill hot' }, `starts at ${hex(img.base)}`), h('span', { class: 'pill' }, `${img.size} bytes (${kb(img.size)})`), h('span', { class: 'pill' }, `${img.known.reduce((a, b) => a + b, 0)} bytes with real contents`)));
  wrap.append(h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ['Offset in file', 'Load address', 'Size', 'Output section'].map((t) => h('th', {}, t)))),
    h('tbody', {}, ...loadable.map((o) => h('tr', { style: 'cursor:pointer', onclick: () => { ui.binFrom = Math.floor((o.lma - img.base) / PAGE) * PAGE; renderView(); } }, h('td', { class: 'mono' }, hex(o.lma - img.base, 6)), h('td', { class: 'mono' }, hex(o.lma)), h('td', {}, o.size), h('td', { class: 'mono' }, o.name + (o.lma !== o.vma ? `  (runs at ${hex(o.vma)} in RAM)` : ''))))))));
  if (ui.binFrom >= img.size) ui.binFrom = 0;
  const go = (d) => { ui.binFrom = Math.max(0, Math.min(Math.max(0, img.size - 1), ui.binFrom + d)); renderView(); };
  wrap.append(h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => go(-PAGE), disabled: ui.binFrom === 0 }, '◀ Previous 4 KB'), h('span', { class: 'mono' }, `${hex(img.base + ui.binFrom)} – ${hex(img.base + Math.min(img.size, ui.binFrom + PAGE) - 1)}`), h('button', { class: 'btn', type: 'button', onclick: () => go(PAGE), disabled: ui.binFrom + PAGE >= img.size }, 'Next 4 KB ▶'), h('span', { class: 'muted' }, '* = size estimated')));
  wrap.append(hexDump({ bytes: img.bytes, known: img.known, base: img.base, from: ui.binFrom, rows: 256, owners: img.owners }));
  return wrap;
}

/* ---------- start ---------- */
function init() {
  const sel = $('#sample');
  sel.replaceChildren(...Object.entries(SAMPLES).map(([k, s]) => h('option', { value: k }, s.label)));
  $('#reset').addEventListener('click', () => {
    if (!confirm('Replace your current files with this example?')) return;
    state = fresh(sel.value);
    renderFiles(); renderOpts(); changed();
  });
  const ed = $('#editor');
  ed.addEventListener('input', () => { state.files[state.active] = ed.value; changed(); });
  ed.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const { selectionStart: a, selectionEnd: b } = ed;
      ed.setRangeText('  ', a, b, 'end');
      ed.dispatchEvent(new Event('input'));
    }
  });
  if (!state.options) state.options = { ...SAMPLES.c.options };
  if (!state.files[state.active]) state.active = Object.keys(state.files)[0];
  renderFiles();
  renderOpts();
  result = { units: [], objects: [], link: null, diagnostics: [] };
  run();
}
init();
