// The "linker": places input sections from the object files according to a linker script,
// resolves symbols and relocations, and builds the memory map, the ELF-style view and the flat .bin image.
import { parseScript, evalExpr, globToRegExp } from './ldscript.js';

const KNOWN_LIB = /^(mem(cpy|set|cmp|move)|str(len|cpy|ncpy|cmp|ncmp|cat|chr)|printf|puts|putchar|getchar|s?n?printf|s?scanf|malloc|calloc|realloc|free|abort|exit|atexit|_exit|_sbrk|__libc_init_array|__libc_fini_array|_init|_fini|__dso_handle|__cxa_.*|__aeabi_.*|__gnu_.*|__stack_chk_.*|_write|_read|_close|_lseek|_fstat|_isatty|_kill|_getpid|__errno|errno|_impure_ptr|_Znwj|_Znaj|_ZdlPv.*|_ZdaPv.*|__gxx_personality_v0|_Unwind_.*)$/;
const hexs = (n) => '0x' + (n >>> 0).toString(16);
const alignUp = (v, a) => (a > 1 ? Math.ceil(v / a) * a : v);
const keyOf = (o, s) => `${o.name}\u0000${s.name}`;

export function link(objects, scriptText, { gc = false } = {}) {
  const result = { ok: true, errors: [], warnings: [], notes: [], regions: [], outputs: [], discarded: [], symbols: [], linkerSymbols: [], entry: null, segments: [], size: { text: 0, data: 0, bss: 0 }, image: null, script: null, orphans: [], map: '' };
  let script;
  try {
    script = parseScript(scriptText);
  } catch (e) {
    result.ok = false;
    result.errors.push(e.message);
    return result;
  }
  result.script = script;
  for (const o of objects) for (const n of o.notes || []) result.notes.push(`${o.name}: ${n}`);
  if (!script.items.some((i) => i.kind === 'section')) {
    result.ok = false;
    result.errors.push('The linker script has no SECTIONS { ... } command, so nothing is placed.');
    return result;
  }

  // ---- which input sections exist; global symbol table ----
  const inputs = [];
  for (const o of objects) for (const s of o.sections) inputs.push({ obj: o, sec: s, key: keyOf(o, s), placed: false });
  const byKey = new Map(inputs.map((x) => [x.key, x]));
  const comdatSeen = new Map();
  const preDiscarded = [];
  for (const x of inputs) {
    if (!x.sec.comdat) continue;
    if (comdatSeen.has(x.sec.name)) {
      x.removed = true;
      x.placed = true;
      preDiscarded.push({ obj: x.obj.name, section: x.sec.name, size: x.sec.size, reason: `duplicate inline/template code (COMDAT): the copy from ${comdatSeen.get(x.sec.name)} is kept` });
    } else comdatSeen.set(x.sec.name, x.obj.name);
  }
  result.discarded.push(...preDiscarded);
  const globalSyms = new Map();
  const dupes = [];
  for (const o of objects)
    for (const sy of o.symbols) {
      if (sy.bind === 'LOCAL') continue;
      if (byKey.get(keyOf(o, { name: sy.section }))?.removed) continue;
      const prev = globalSyms.get(sy.name);
      if (prev && prev.sym.bind !== 'WEAK' && sy.bind !== 'WEAK') dupes.push(`multiple definition of '${sy.name}' (in ${prev.obj.name} and ${o.name})`);
      if (!prev || prev.sym.bind === 'WEAK') globalSyms.set(sy.name, { obj: o, sym: sy });
    }
  result.errors.push(...dupes);

  // ---- --gc-sections ----
  const matchesInput = (item, o, s) => (item.file === '*' || globToRegExp(item.file).test(o.name) || globToRegExp(item.file).test(o.name.replace(/\.o$/, ''))) && item.patterns.some((p) => globToRegExp(p.pat).test(s.name) && !p.exclude.some((x) => globToRegExp(x).test(o.name)));
  const allInputItems = [];
  const collect = (list) => list.forEach((i) => i.kind === 'input' && allInputItems.push(i));
  script.items.filter((i) => i.kind === 'section').forEach((s) => collect(s.contents));
  const removed = new Set();
  if (gc) {
    const roots = new Set();
    for (const it of allInputItems) if (it.keep) for (const x of inputs) if (matchesInput(it, x.obj, x.sec)) roots.add(x.key);
    const entryName = script.entry || '_start';
    const e = globalSyms.get(entryName);
    if (e) {
      const sec = byKey.get(keyOf(e.obj, { name: e.sym.section }));
      if (sec) roots.add(sec.key);
    }
    const seen = new Set();
    const stack = [...roots];
    const secOfSym = (o, name) => {
      const local = o.symbols.find((s) => s.name === name);
      if (local) return byKey.get(keyOf(o, { name: local.section }));
      const g = globalSyms.get(name);
      return g ? byKey.get(keyOf(g.obj, { name: g.sym.section })) : null;
    };
    while (stack.length) {
      const k = stack.pop();
      if (seen.has(k)) continue;
      seen.add(k);
      const x = byKey.get(k);
      if (!x) continue;
      const refs = new Set([...(x.sec.refs || []), ...x.sec.relocs.map((r) => r.sym)]);
      for (const r of refs) {
        const t = secOfSym(x.obj, r);
        if (t && !seen.has(t.key)) stack.push(t.key);
      }
    }
    for (const x of inputs) if (!seen.has(x.key)) removed.add(x.key);
    for (const k of removed) {
      const x = byKey.get(k);
      x.placed = true;
      x.removed = true;
      result.discarded.push({ obj: x.obj.name, section: x.sec.name, size: x.sec.size, reason: 'removed by --gc-sections (nothing reachable from the entry point or KEEP refers to it)' });
    }
  }

  // ---- placement (run until symbol values settle) ----
  let prev = { syms: new Map(), outs: new Map() };
  let state;
  for (let pass = 0; pass < 3; pass++) {
    state = place(prev);
    if (state.fatal) break;
    const same = [...state.syms].every(([k, v]) => prev.syms.get(k) === v) && state.syms.size === prev.syms.size;
    prev = { syms: state.syms, outs: state.outs };
    if (same) break;
  }
  Object.assign(result, { regions: state.regions, outputs: state.outputList, orphans: state.orphans });
  result.errors.push(...state.errors);
  result.warnings.push(...state.warnings);
  result.discarded.push(...state.discarded);
  result.linkerSymbols = [...state.userSyms].map(([name, value]) => ({ name, value })).sort((a, b) => a.value - b.value || a.name.localeCompare(b.name));
  if (state.fatal) {
    result.ok = false;
    return result;
  }

  function place(prevPass) {
    const errors = [], warnings = [], discarded = [], orphans = [];
    for (const x of inputs) {
      x.placed = !!x.removed;
      x.vma = undefined;
      x.out = undefined;
    }
    const userSyms = new Map();
    const outs = new Map();
    const outputList = [];
    const regions = new Map();
    const regionList = [];
    let fatal = false;
    for (const m of script.memory) {
      const ctx0 = { dot: 0, symbol: () => 0, region: () => 0, section: () => 0, defined: () => false };
      try {
        const origin = evalExpr(m.origin, ctx0), length = evalExpr(m.length, { ...ctx0, symbol: (n) => script.symbols.length && userValue(n) });
        const r = { name: m.name, attrs: m.attrs, origin, length, ptr: origin, used: 0, outputs: [] };
        regions.set(m.name, r);
        regionList.push(r);
      } catch (e) {
        errors.push(`MEMORY ${m.name}: ${e.message}`);
      }
    }
    function userValue(n) {
      return userSyms.has(n) ? userSyms.get(n) : prevPass.syms.get(n) ?? 0;
    }
    const symbolAddr = (n) => {
      if (userSyms.has(n)) return userSyms.get(n);
      const g = globalSyms.get(n);
      if (g) {
        const x = byKey.get(keyOf(g.obj, { name: g.sym.section }));
        if (x && x.vma !== undefined) return x.vma + g.sym.value;
        if (prevPass.syms.has(n)) return prevPass.syms.get(n);
      }
      return prevPass.syms.get(n) ?? 0;
    };
    const ctx = {
      dot: 0,
      symbol: symbolAddr,
      region: (name, what) => {
        const r = regions.get(name);
        if (!r) {
          errors.push(`region '${name}' is not defined in MEMORY`);
          return 0;
        }
        return what === 'origin' ? r.origin : r.length;
      },
      section: (name, what) => {
        const o = outs.get(name) || prevPass.outs.get(name);
        return o ? o[what] : 0;
      },
      defined: (n) => userSyms.has(n) || globalSyms.has(n),
    };
    for (const r of regionList) r.ptr = r.origin;
    let dotExplicit = false;
    const assign = (a, local) => {
      if (a.kind === 'assert') {
        let ok = true;
        try {
          ok = !!evalExpr(a.e, ctx);
        } catch (e) {
          ok = true;
        }
        if (!ok) errors.push(`ASSERT failed: ${a.msg}`);
        return;
      }
      let v;
      try {
        v = evalExpr(a.e, ctx);
      } catch (e) {
        errors.push(`${a.name}: ${e.message}`);
        return;
      }
      if (a.name === '.') {
        ctx.dot = a.op === '+=' ? ctx.dot + v : a.op === '-=' ? ctx.dot - v : v;
        if (!local) dotExplicit = true;
        return;
      }
      if (a.provide && globalSyms.has(a.name)) return;
      const cur = userSyms.get(a.name) ?? 0;
      userSyms.set(a.name, a.op === '+=' ? cur + v : a.op === '-=' ? cur - v : v);
    };
    for (const a of script.symbols) assign(a);
    const regionOfAddr = (addr) => regionList.find((r) => addr >= r.origin && addr < r.origin + r.length);

    for (const item of script.items) {
      if (item.kind === 'assign' || item.kind === 'assert') {
        assign(item);
        continue;
      }
      if (item.kind !== 'section') continue;
      if (item.name === '/DISCARD/') {
        for (const inp of item.contents.filter((c) => c.kind === 'input'))
          for (const x of inputs) if (!x.placed && matchesInput(inp, x.obj, x.sec)) {
            x.placed = true;
            discarded.push({ obj: x.obj.name, section: x.sec.name, size: x.sec.size, reason: 'matched /DISCARD/ in the linker script' });
          }
        continue;
      }
      const region = item.region ? regions.get(item.region) : null;
      if (item.region && !region) errors.push(`output section ${item.name}: region '${item.region}' is not defined in MEMORY`);
      const lmaRegion = item.lmaRegion ? regions.get(item.lmaRegion) : null;
      if (item.lmaRegion && !lmaRegion) errors.push(`output section ${item.name}: region '${item.lmaRegion}' is not defined in MEMORY`);
      // start address
      let start;
      if (item.addr) start = evalExpr(item.addr, ctx);
      else if (region && !(dotExplicit && regionOfAddr(ctx.dot) === region)) start = region.ptr;
      else start = ctx.dot;
      dotExplicit = false;
      const out = { name: item.name, vma: start, lma: start, size: 0, region: region?.name || null, lmaRegion: lmaRegion?.name || null, noload: item.noload, type: 'PROGBITS', flags: '', contributions: [], align: 1, symbols: [], keep: false };
      ctx.dot = start;
      outs.set(out.name, out); // so LOADADDR/ADDR of this section resolve while placing
      const place1 = (x, keep) => {
        const al = Math.max(1, x.sec.align);
        ctx.dot = alignUp(ctx.dot, al);
        x.vma = ctx.dot;
        x.out = out;
        x.placed = true;
        out.contributions.push({ kind: 'input', obj: x.obj, sec: x.sec, vma: ctx.dot, size: x.sec.size, align: al, keep: !!keep, key: x.key });
        out.align = Math.max(out.align, al);
        ctx.dot += x.sec.size;
        out.keep ||= !!keep;
      };
      // first contribution decides the section's start alignment (ld aligns the output section to its inputs)
      let firstAligned = false;
      for (const c of item.contents) {
        if (c.kind === 'assign' || c.kind === 'assert') {
          assign(c, true);
          if (c.kind === 'assign' && c.name !== '.' && !outs.has(item.name)) outs.set(item.name, out);
          if (c.kind === 'assign' && c.name !== '.') out.symbols.push({ name: c.name, value: userSyms.get(c.name) });
        } else if (c.kind === 'data') {
          const v = (() => {
            try {
              return evalExpr(c.e, ctx);
            } catch {
              return 0;
            }
          })();
          out.contributions.push({ kind: 'data', size: c.size, vma: ctx.dot, value: v, label: `${{ 1: 'BYTE', 2: 'SHORT', 4: 'LONG', 8: 'QUAD' }[c.size]}(…)`, align: 1 });
          ctx.dot += c.size;
        } else if (c.kind === 'input') {
          let list = inputs.filter((x) => !x.placed && matchesInput(c, x.obj, x.sec));
          if (c.sort) list = list.sort((a, b) => a.sec.name.localeCompare(b.sec.name));
          for (const x of list) {
            if (!firstAligned && item.addr == null && out.contributions.length === 0) {
              ctx.dot = alignUp(ctx.dot, Math.max(1, x.sec.align));
              out.vma = ctx.dot;
              firstAligned = true;
            }
            place1(x, c.keep);
          }
        }
      }
      if (item.alignExpr) {
        // ALIGN(n) in the header: start is aligned
        const al = evalExpr(item.alignExpr, ctx);
        out.align = Math.max(out.align, al);
      }
      out.size = ctx.dot - out.vma;
      if (out.size < 0) {
        errors.push(`section ${out.name}: cannot move the location counter backwards (from ${hexs(out.vma)} to ${hexs(ctx.dot)})`);
        out.size = 0;
        ctx.dot = out.vma;
      }
      const types = out.contributions.filter((c) => c.kind === 'input').map((c) => c.sec.type);
      const hasData = out.contributions.some((c) => c.kind === 'data');
      out.type = item.noload || (!hasData && types.every((t) => t === 'NOBITS')) ? 'NOBITS' : 'PROGBITS';
      const fl = new Set(out.contributions.filter((c) => c.kind === 'input').flatMap((c) => [...c.sec.flags]));
      out.flags = [fl.has('W') ? 'W' : '', 'A', fl.has('X') ? 'X' : ''].join('');
      if (!out.contributions.length && !out.size) out.empty = true;
      // memory accounting
      if (region) {
        const used = out.vma + out.size;
        if (used > region.ptr) region.ptr = used;
      }
      out.lma = out.vma;
      if (out.type === 'PROGBITS') {
        if (item.at) out.lma = evalExpr(item.at, ctx);
        else if (lmaRegion) out.lma = alignUp(lmaRegion.ptr, out.align);
        if (lmaRegion) lmaRegion.ptr = Math.max(lmaRegion.ptr, out.lma + out.size);
      }
      ctx.dot = out.vma + out.size;
      outs.set(out.name, out);
      outputList.push(out);
      if (region) region.outputs.push(out);
      if (lmaRegion && lmaRegion !== region) lmaRegion.outputs.push({ ...out, asLma: true });
    }
    // orphans: sections no statement placed
    const leftover = inputs.filter((x) => !x.placed);
    if (leftover.length) {
      for (const x of leftover) {
        const cls = x.sec.flags.includes('X') ? 'exec' : x.sec.type === 'NOBITS' ? 'bss' : x.sec.flags.includes('W') ? 'data' : 'ro';
        const classOf = (o) => (o.flags.includes('X') ? 'exec' : o.type === 'NOBITS' ? 'bss' : o.flags.includes('W') ? 'data' : 'ro');
        const anchor = [...outputList].reverse().find((o) => !o.empty && classOf(o) === cls);
        if (anchor) {
          const reg = regions.get(anchor.region);
          const base = reg ? reg.ptr : anchor.vma + anchor.size;
          const out = { name: x.sec.name, vma: alignUp(base, x.sec.align), lma: 0, size: x.sec.size, region: anchor.region, lmaRegion: null, noload: false, type: x.sec.type, flags: x.sec.flags, contributions: [], align: x.sec.align, symbols: [], orphan: true };
          out.lma = out.vma;
          out.contributions.push({ kind: 'input', obj: x.obj, sec: x.sec, vma: out.vma, size: x.sec.size, align: x.sec.align, key: x.key });
          x.vma = out.vma;
          x.out = out;
          x.placed = true;
          if (reg) {
            reg.ptr = out.vma + out.size;
            reg.outputs.push(out);
          }
          outputList.push(out);
          outs.set(out.name, out);
          orphans.push({ obj: x.obj.name, section: x.sec.name, placedAfter: anchor.name });
          warnings.push(`${x.obj.name}(${x.sec.name}) matches no input pattern in the linker script. The linker placed it as an orphan section after ${anchor.name}.`);
        } else {
          x.placed = true;
          discarded.push({ obj: x.obj.name, section: x.sec.name, size: x.sec.size, reason: 'no matching output section and no similar section to place it after' });
          warnings.push(`${x.obj.name}(${x.sec.name}) was not placed anywhere.`);
        }
      }
    }
    // region overflow
    const regs = regionList.map((r) => {
      const usedVma = r.outputs.filter((o) => !o.asLma && o.type !== 'NOBITS' || (!o.asLma && o.type === 'NOBITS')).reduce((a, o) => a + o.size, 0);
      const end = r.origin + r.length;
      if (r.ptr > end) errors.push(`region '${r.name}' overflowed by ${r.ptr - end} bytes`);
      return { ...r, used: r.ptr - r.origin };
    });
    for (const o of outputList) {
      const r = regions.get(o.region);
      if (r && !o.addr && (o.vma < r.origin || o.vma + o.size > r.origin + r.length) && o.size && !errors.some((e) => e.includes(`'${r.name}' overflowed`))) errors.push(`section ${o.name} [${o.vma.toString(16)} ... ${(o.vma + o.size - 1).toString(16)}] does not fit in region '${r.name}'`);
    }
    // Final symbol table with values
    for (const x of inputs) x.vma = x.vma;
    return { syms: new Map([...userSyms, ...[...globalSyms].map(([n, g]) => {
      const x = byKey.get(keyOf(g.obj, { name: g.sym.section }));
      return [n, x && x.vma !== undefined ? x.vma + g.sym.value : 0];
    })]), outs, outputList, regions: regs, errors, warnings, discarded, orphans, userSyms, fatal };
  }

  // ---- final symbols, relocations, images ----
  const addrOf = (o, name) => {
    const local = o.symbols.find((s) => s.name === name);
    const sym = local || globalSyms.get(name)?.sym;
    const obj = local ? o : globalSyms.get(name)?.obj;
    if (sym) {
      const x = byKey.get(keyOf(obj, { name: sym.section }));
      if (x && x.vma !== undefined) return { addr: x.vma + sym.value, func: sym.type === 'FUNC' };
      return { addr: null, removed: true };
    }
    if (state.userSyms.has(name)) return { addr: state.userSyms.get(name), func: false };
    return null;
  };
  const undefinedList = new Set();
  const libList = new Set();
  const checkUndef = (o, name) => {
    if (addrOf(o, name)) return;
    if (/^\.LC/.test(name)) return;
    if (KNOWN_LIB.test(name)) libList.add(name);
    else undefinedList.add(`undefined reference to '${name}' (used in ${o.name})`);
  };
  for (const x of inputs) {
    if (x.removed) continue;
    for (const r of x.sec.relocs) checkUndef(x.obj, r.sym);
    for (const r of x.sec.refs) if (x.obj.declared.includes(r)) checkUndef(x.obj, r);
  }
  result.errors.push(...undefinedList);
  if (libList.size) result.notes.push(`Provided by the C/C++ runtime libraries and not simulated: ${[...libList].join(', ')}.`);

  // output contents
  for (const o of result.outputs) {
    o.bytes = o.type === 'NOBITS' ? null : new Uint8Array(o.size);
    o.known = o.type === 'NOBITS' ? null : new Uint8Array(o.size);
    for (const c of o.contributions) {
      const at = c.vma - o.vma;
      if (c.kind === 'data') {
        if (o.bytes) {
          let v = BigInt(Math.trunc(c.value));
          for (let k = 0; k < c.size; k++) {
            o.bytes[at + k] = Number(v & 255n);
            v >>= 8n;
          }
          o.known.fill(1, at, at + c.size);
        }
        continue;
      }
      if (!o.bytes || !c.sec.bytes) continue;
      o.bytes.set(c.sec.bytes, at);
      o.known.set(c.sec.known, at);
      for (const r of c.sec.relocs) {
        const t = addrOf(c.obj, r.sym);
        if (!t || t.addr == null) continue;
        let v = t.addr + r.addend;
        if (t.func && !r.addend) v |= 1; // Thumb bit
        o.bytes[at + r.off] = v & 255;
        o.bytes[at + r.off + 1] = (v >>> 8) & 255;
        o.bytes[at + r.off + 2] = (v >>> 16) & 255;
        o.bytes[at + r.off + 3] = (v >>> 24) & 255;
        o.known.fill(1, at + r.off, at + r.off + 4);
      }
    }
  }

  // symbols with addresses
  for (const o of objects)
    for (const s of o.symbols) {
      if (s.hidden) continue;
      const x = byKey.get(keyOf(o, { name: s.section }));
      if (!x || x.vma === undefined || x.removed) continue;
      result.symbols.push({ name: s.name, display: s.display || s.name, addr: x.vma + s.value, size: s.size, type: s.type, bind: s.bind, kind: s.kind, obj: o.name, input: s.section, output: x.out?.name });
    }
  result.symbols.sort((a, b) => a.addr - b.addr || a.name.localeCompare(b.name));

  // entry
  const entryName = script.entry || '_start';
  const e = addrOf(objects[0] || { symbols: [] }, entryName);
  if (e && e.addr != null) result.entry = { name: entryName, addr: e.addr & ~1 };
  else if (script.entry) result.warnings.push(`cannot find entry symbol ${entryName}; the program has no defined start address.`);

  // size summary (like arm-none-eabi-size)
  for (const o of result.outputs) {
    if (o.flags.includes('W')) result.size[o.type === 'NOBITS' ? 'bss' : 'data'] += o.size;
    else if (o.type !== 'NOBITS') result.size.text += o.size;
  }

  // segments (program headers)
  const alloc = result.outputs.filter((o) => !o.empty && o.size > 0);
  let fileOff = 52 + 32 * 8;
  for (const o of alloc) {
    const last = result.segments[result.segments.length - 1];
    const writable = o.flags.includes('W');
    const sameSeg = last && last.writable === writable && last.region === o.region && (o.type === 'NOBITS' ? last.vend === o.vma : last.pend === o.lma && !last.sawBss);
    if (sameSeg) {
      if (o.type === 'NOBITS') last.sawBss = true;
      else last.filesz = o.lma + o.size - last.paddr;
      last.memsz = o.vma + o.size - last.vaddr;
      last.vend = o.vma + o.size;
      last.pend = o.type === 'NOBITS' ? last.pend : o.lma + o.size;
      last.sections.push(o.name);
    } else {
      fileOff = alignUp(fileOff, 4);
      result.segments.push({ type: 'LOAD', offset: fileOff, vaddr: o.vma, paddr: o.lma, filesz: o.type === 'NOBITS' ? 0 : o.size, memsz: o.size, flags: (writable ? 'RW' : 'R') + (o.flags.includes('X') ? 'E' : writable ? '' : ''), writable, region: o.region, vend: o.vma + o.size, pend: o.type === 'NOBITS' ? o.lma : o.lma + o.size, sawBss: o.type === 'NOBITS', sections: [o.name] });
    }
    if (o.type !== 'NOBITS') {
      o.fileOffset = alignUp(fileOff, 4);
      fileOff = o.fileOffset + o.size;
    }
  }
  for (const s of result.segments) {
    s.flags = s.sections.some((n) => result.outputs.find((o) => o.name === n)?.flags.includes('X')) ? 'R E' : s.writable ? 'RW ' : 'R  ';
  }

  // flat binary image (objcopy -O binary): every output section that has file contents, at its load address
  const loadable = result.outputs.filter((o) => o.bytes && o.size > 0 && !o.noload).sort((a, b) => a.lma - b.lma);
  if (loadable.length) {
    const base = loadable[0].lma;
    const top = Math.max(...loadable.map((o) => o.lma + o.size));
    if (top - base > 16 * 1024 * 1024) {
      result.warnings.push(`The flat .bin would be ${(top - base) / 1048576} MB because loadable sections are far apart; the image view is skipped.`);
    } else {
      const bytes = new Uint8Array(top - base);
      const known = new Uint8Array(top - base);
      const owners = [];
      for (const o of loadable) {
        bytes.set(o.bytes, o.lma - base);
        known.set(o.known, o.lma - base);
        for (const c of o.contributions) {
          const off = c.vma - o.vma + o.lma - base;
          owners.push({ start: off, end: off + c.size, label: c.kind === 'data' ? `${c.label}` : `${c.sec.name}`, obj: c.kind === 'data' ? '(linker script)' : c.obj.name, out: o.name, estimated: c.kind === 'input' && c.sec.estimated, lma: o.lma, vma: o.vma });
        }
      }
      owners.sort((a, b) => a.start - b.start);
      result.image = { base, bytes, known, owners, size: bytes.length };
    }
  }

  result.errors = [...new Set(result.errors)];
  result.ok = result.errors.length === 0;
  result.map = mapText(result, objects);
  return result;
}

function mapText(r, objects) {
  const h = (n, w = 8) => '0x' + (n >>> 0).toString(16).padStart(w, '0');
  const L = ['Memory Configuration', '', 'Name             Origin             Length             Attributes'];
  for (const m of r.regions) L.push(`${m.name.padEnd(16)} ${h(m.origin, 16)} ${h(m.length, 16)} ${m.attrs}`);
  L.push('*default*        0x0000000000000000 0xffffffffffffffff', '', 'Linker script and memory map', '');
  for (const o of r.outputs) {
    L.push(`${o.name.padEnd(16)} ${h(o.vma, 16)} ${h(o.size, 8)}${o.lma !== o.vma ? `  load address ${h(o.lma, 16)}` : ''}`);
    for (const c of o.contributions) {
      if (c.kind === 'data') L.push(` ${c.label.padEnd(15)} ${h(c.vma, 16)} ${h(c.size, 8)}`);
      else L.push(` ${c.sec.name.padEnd(15)} ${h(c.vma, 16)} ${h(c.size, 8)} ${c.obj.name}${c.keep ? '  (KEEP)' : ''}`);
    }
    for (const s of o.symbols || []) L.push(`${' '.repeat(34)}${h(s.value, 16)}  ${s.name}`);
  }
  L.push('', 'Symbols by address', '');
  for (const s of r.symbols) L.push(`${h(s.addr, 8)} ${s.size.toString().padStart(6)} ${s.type === 'FUNC' ? 'T' : s.kind === 'bss' ? 'B' : s.kind === 'rodata' ? 'R' : 'D'}${s.bind === 'LOCAL' ? '(local)' : ''} ${s.display}`);
  return L.join('\n');
}
