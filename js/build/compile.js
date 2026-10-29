// "Compiler" for the build simulator. It does NOT generate machine code. It reads the preprocessed C / C++ text,
// finds functions and variables, and produces what an object file (.o) is made of: sections, sizes,
// alignment, symbols, the real bytes of initialised data, and relocations. Function (.text) sizes are estimates.
import { tokenize, numValue, charValue, stringBytes } from './lex.js';

const OPEN = { '(': ')', '[': ']', '{': '}' };
const QUALS = new Set(['const', 'volatile', 'restrict', '__restrict', '__restrict__', 'register', 'auto']);
const STORAGE = new Set(['static', 'extern', 'inline', '__inline', '__inline__', 'constexpr', 'virtual', 'explicit', 'friend', 'typedef', 'mutable', 'thread_local', '_Noreturn', 'consteval', 'constinit']);
const WORDS = new Set(['unsigned', 'signed', 'short', 'long', 'int', 'char', 'float', 'double', 'void', 'bool', '_Bool', 'wchar_t', 'char16_t', 'char32_t']);
const KEYWORDS = new Set(['if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'return', 'break', 'continue', 'goto', 'sizeof', 'alignof', 'new', 'delete', 'throw', 'try', 'catch', 'static_cast', 'reinterpret_cast', 'const_cast', 'dynamic_cast', 'asm', '__asm__', '__asm', 'volatile', 'typeof', 'decltype', 'noexcept']);
const OPT = { O0: 2.4, O1: 1.3, O2: 1, O3: 1.35, Os: 0.85 };
const MANGLE = { 'int': 'i', 'unsigned': 'j', 'unsigned int': 'j', 'char': 'c', 'signed char': 'a', 'unsigned char': 'h', 'short': 's', 'unsigned short': 't', 'long': 'l', 'unsigned long': 'm', 'long long': 'x', 'unsigned long long': 'y', 'float': 'f', 'double': 'd', 'bool': 'b', '_Bool': 'b', 'void': 'v' };
const sc = (size, name) => ({ kind: 'scalar', size, align: Math.min(size, 8), name });

const baseOf = (words) => {
  const w = [...words];
  const longs = w.filter((x) => x === 'long').length;
  const uns = w.includes('unsigned');
  let core = w.includes('char') ? 'char' : w.includes('short') ? 'short' : w.includes('double') ? 'double' : w.includes('float') ? 'float' : w.includes('void') ? 'void' : w.includes('bool') || w.includes('_Bool') ? 'bool' : longs >= 2 ? 'long long' : longs === 1 ? 'long' : 'int';
  const size = { char: 1, short: 2, int: 4, long: 4, 'long long': 8, float: 4, double: 8, bool: 1, void: 0 }[core];
  const key = (uns ? 'unsigned ' : w.includes('signed') && core === 'char' ? 'signed ' : '') + core;
  return { type: core === 'void' ? { kind: 'void', size: 0, align: 1, name: 'void' } : sc(size, key), key };
};

export function compile(text, opts = {}) {
  return new Compiler(text, opts).run();
}

class Compiler {
  constructor(text, { name = 'file.o', cpp = false, opt = 'O2', functionSections = true, dataSections = true } = {}) {
    const lines = text.split('\n').filter((l) => !/^\s*#/.test(l));
    this.toks = tokenize(lines.join('\n'));
    this.name = name;
    this.cpp = cpp;
    this.opt = OPT[opt] ?? 1;
    this.optName = opt;
    this.fs = functionSections;
    this.ds = dataSections;
    this.match = new Array(this.toks.length).fill(-1);
    const st = [];
    this.toks.forEach((t, i) => {
      if (t.t !== 'p') return;
      if (OPEN[t.v]) st.push(i);
      else if (')]}'.includes(t.v) && st.length) this.match[st.pop()] = i;
    });
    if (st.length) {
      this.unbalanced = true;
      for (const o of st) this.match[o] = Math.max(o, this.toks.length - 1);
    }
    this.steps = 0;
    this.types = new Map();
    this.alias = new Map(); // typedef name -> canonical words for mangling
    this.consts = new Map();
    this.sections = new Map();
    this.symbols = [];
    this.notes = [];
    this.strings = new Map();
    this.funcs = [];
    this.defined = new Set();
    this.declared = new Set();
    this.declFuncs = new Map();
    this.idSyms = new Map(); // identifier -> [symbol names]
    this.dyn = [];
    this.classes = new Map();
    this.lc = 0;
  }

  note(msg) {
    if (!this.notes.includes(msg)) this.notes.push(msg);
  }
  tk(i) {
    return this.toks[i];
  }
  is(i, v) {
    const t = this.toks[i];
    return !!t && t.t === 'p' && t.v === v;
  }
  isId(i, v) {
    const t = this.toks[i];
    return !!t && t.t === 'id' && (v === undefined || t.v === v);
  }
  skipTo(i, end, stops) {
    // index of the first top-level token in `stops` (or end)
    while (i < end) {
      if (this.toks[i].t === 'p') {
        if (stops.includes(this.toks[i].v)) return i;
        if (OPEN[this.toks[i].v] && this.match[i] > i) {
          i = this.match[i] + 1;
          continue;
        }
      }
      i++;
    }
    return end;
  }

  /* ---------- sections ---------- */
  section(name, { type = 'PROGBITS', flags = 'A', align = 1 } = {}) {
    if (!this.sections.has(name)) this.sections.set(name, { name, type, flags, align, size: 0, chunks: [], relocs: [], refs: new Set() });
    const s = this.sections.get(name);
    s.align = Math.max(s.align, align);
    return s;
  }
  place(sec, size, align, bytes = null, known = true) {
    const off = Math.ceil(sec.size / align) * align;
    sec.chunks.push({ off, size, bytes, known });
    sec.size = off + size;
    sec.align = Math.max(sec.align, align);
    return off;
  }
  addSymbol(s) {
    this.symbols.push(s);
    if (s.bind !== 'LOCAL') this.defined.add(s.name);
  }

  /* ---------- types ---------- */
  lookupType(name) {
    return this.types.get(name);
  }
  arrayOf(t, n) {
    return { kind: 'array', elem: t, count: n, size: t.size * (n ?? 0), align: t.align };
  }
  ptrTo(t) {
    return { kind: 'ptr', to: t, size: 4, align: 4 };
  }
  isTypeStart(i) {
    const t = this.toks[i];
    if (!t || t.t !== 'id') return false;
    return WORDS.has(t.v) || QUALS.has(t.v) || ['struct', 'union', 'enum', 'class', 'typename'].includes(t.v) || this.types.has(t.v) || this.alias.has(t.v);
  }

  // Parses declaration specifiers starting at i.
  specs(i, end, ctx) {
    const r = { type: null, const: false, volatile: false, storage: {}, attrs: {}, words: [], cname: null, i };
    const words = [];
    for (;;) {
      const t = this.toks[i];
      if (!t || i >= end) break;
      if (t.t === 'id') {
        if (QUALS.has(t.v)) {
          if (t.v === 'const') r.const = true;
          if (t.v === 'volatile') r.volatile = true;
          i++;
        } else if (STORAGE.has(t.v)) {
          r.storage[t.v === '__inline' || t.v === '__inline__' ? 'inline' : t.v] = true;
          i++;
        } else if (t.v === '__attribute__' || t.v === '__attribute' || t.v === 'alignas') {
          const o = i + 1;
          this.readAttrs(o, r.attrs, t.v === 'alignas');
          i = this.match[o] + 1;
        } else if (t.v === '__declspec' || t.v === '__extension__') {
          i = t.v === '__extension__' ? i + 1 : this.match[i + 1] + 1;
        } else if (WORDS.has(t.v)) {
          words.push(t.v);
          i++;
        } else if (['struct', 'union', 'class', 'enum'].includes(t.v)) {
          const kw = t.v;
          i++;
          if (kw === 'enum' && this.isId(i) && (this.isId(i, 'class') || this.isId(i, 'struct'))) i++;
          while (this.isId(i, '__attribute__')) {
            this.readAttrs(i + 1, r.attrs);
            i = this.match[i + 1] + 1;
          }
          let tag = null;
          if (this.isId(i) && !this.is(i + 1, '(')) tag = this.toks[i++].v;
          let bases = [];
          if (this.is(i, ':') && kw !== 'enum') {
            const bs = this.skipTo(i + 1, end, ['{', ';']);
            bases = this.toks.slice(i + 1, bs).filter((x) => x.t === 'id' && !['public', 'private', 'protected', 'virtual'].includes(x.v)).map((x) => x.v);
            i = bs;
          }
          let underlying = null;
          if (this.is(i, ':') && kw === 'enum') {
            i++;
            const k = i;
            while (this.isId(i) && !this.is(i, '{')) i++;
            underlying = baseOf(this.toks.slice(k, i).map((x) => x.v));
          }
          if (this.is(i, '{')) {
            const close = this.match[i];
            const key = tag ? `${kw === 'class' ? 'struct' : kw} ${tag}` : null;
            const type = kw === 'enum' ? this.defineEnum(i + 1, close, underlying) : this.defineRecord(kw, tag, bases, i + 1, close, r.attrs, ctx);
            if (key) this.types.set(key, type);
            if (tag && this.cpp) this.types.set(tag, type);
            if (tag && this.cpp) this.alias.set(tag, tag);
            r.type = type;
            i = close + 1;
          } else {
            const key = tag ? `${kw === 'class' ? 'struct' : kw} ${tag}` : '';
            r.type = this.types.get(key) || (tag && this.types.get(tag)) || (kw === 'enum' ? sc(4) : { kind: 'struct', size: 0, align: 1, members: [], incomplete: true, name: tag });
            if (tag) r.cname = tag;
          }
          break;
        } else if (!r.type && !words.length && (this.types.has(t.v) || this.alias.has(t.v))) {
          // possibly qualified:  ns::Type
          let name = t.v;
          // `Class::Class(` or `Class::~Class(` is a constructor / destructor definition: no return type
          if (this.cpp && this.is(i + 1, '::') && ((this.isId(i + 2, t.v) && this.is(i + 3, '(')) || (this.is(i + 2, '~') && this.isId(i + 3, t.v)))) {
            r.type = { kind: 'void', size: 0, align: 1, name: 'void' };
            break;
          }
          i++;
          while (this.is(i, '::') && this.isId(i + 1) && !(this.is(i + 2, '(') && this.isId(i + 1, name))) {
            name = this.toks[i + 1].v;
            i += 2;
          }
          r.type = this.types.get(name) || sc(4, name);
          r.cname = name;
        } else if (!r.type && !words.length && this.cpp && this.is(i + 1, '::') && this.isId(i + 2) && this.types.has(this.toks[i + 2].v)) {
          i += 2; // ns::Type where ns is unknown here
        } else if (!r.type && !words.length && this.isId(i) && (this.isId(i + 1) || this.is(i + 1, '*') || this.is(i + 1, '&')) && !KEYWORDS.has(t.v) && !(this.is(i + 1, '*') && !this.isId(i + 2) && !this.is(i + 2, '*'))) {
          // unknown type name (declared in a header the simulator does not expand)
          this.note(`Type "${t.v}" is not defined in the files given; assuming it is 4 bytes.`);
          r.type = sc(4, t.v);
          r.cname = t.v;
          i++;
        } else break;
      } else if (t.t === 'p' && t.v === '[' && this.is(i + 1, '[')) {
        i = this.match[i] + 1; // [[attribute]]
      } else break;
    }
    if (!r.type && words.length) {
      const b = baseOf(words);
      r.type = b.type;
      r.words = words;
      r.cname = b.key;
    }
    r.i = i;
    return r;
  }

  readAttrs(open, attrs, alignas = false) {
    const close = this.match[open];
    if (alignas) {
      const v = this.evalConst(open + 1, close);
      if (v && v.n) attrs.aligned = v.n;
      return;
    }
    for (let j = open + 1; j < close; j++) {
      const t = this.toks[j];
      if (t.t !== 'id') continue;
      const n = t.v.replace(/^__|__$/g, '');
      if (n === 'section' || n === 'aligned' || n === 'alias') {
        const o = j + 1;
        if (this.is(o, '(')) {
          const c = this.match[o];
          if (n === 'section') attrs.section = this.toks[o + 1]?.t === 'str' ? this.toks[o + 1].v.slice(1, -1) : null;
          else if (n === 'aligned') attrs.aligned = this.evalConst(o + 1, c)?.n || 8;
          j = c;
        } else if (n === 'aligned') attrs.aligned = 8;
      } else if (['weak', 'used', 'packed', 'naked', 'noreturn', 'unused', 'interrupt', 'noinline', 'always_inline', 'constructor', 'destructor'].includes(n)) {
        attrs[n] = true;
        if (this.is(j + 1, '(')) j = this.match[j + 1];
      }
    }
  }

  defineEnum(i, end, underlying) {
    let v = 0;
    while (i < end) {
      if (!this.isId(i)) {
        i++;
        continue;
      }
      const name = this.toks[i].v;
      i++;
      if (this.is(i, '=')) {
        const e = this.skipTo(i + 1, end, [',']);
        const r = this.evalConst(i + 1, e);
        if (r && r.n !== undefined && !r.sym) v = r.n;
        i = e;
      }
      this.consts.set(name, v);
      v++;
      if (this.is(i, ',')) i++;
    }
    return underlying ? underlying.type : sc(4, 'enum');
  }

  defineRecord(kw, tag, bases, i, end, attrs, outer) {
    const isUnion = kw === 'union';
    const rec = { kind: 'struct', ns: outer?.ns || [], name: tag, size: 0, align: 1, members: [], union: isUnion, virtuals: [], bases: [], hasCtor: false, hasVptr: false };
    if (tag) this.classes.set(tag, rec);
    const packed = attrs.packed;
    let off = 0, align = 1;
    for (const b of bases) {
      const bt = this.types.get(b);
      if (!bt) continue;
      rec.bases.push(bt);
      if (bt.hasVptr) {
        rec.hasVptr = true;
        rec.virtuals = [...bt.virtuals];
      }
      if (bt.hasCtor) rec.hasCtor = true;
    }
    const add = (t, name) => {
      const al = packed ? 1 : t.align || 1;
      if (isUnion) {
        rec.members.push({ name, type: t, offset: 0 });
        off = Math.max(off, t.size);
      } else {
        off = Math.ceil(off / al) * al;
        rec.members.push({ name, type: t, offset: off });
        off += t.size;
      }
      align = Math.max(align, al);
    };
    const first = rec.bases[0];
    if (first) {
      off = first.size;
      align = Math.max(align, first.align);
    }
    const ctx = { cls: rec, ns: outer?.ns || [], clsName: tag || '', access: kw === 'class' ? 'private' : 'public' };
    // class body: pre-scan for virtual methods so a vptr is allocated first
    const body = this.parseClassBody(i, end, ctx, rec, add, () => {
      if (!rec.hasVptr) {
        rec.hasVptr = true;
        if (!first || !first.hasVptr) {
          off = Math.ceil(off / 4) * 4;
          rec.members.unshift({ name: '__vptr', type: this.ptrTo({ kind: 'void', size: 0, align: 1 }), offset: 0 });
          for (const m of rec.members.slice(1)) m.offset += 4;
          off += 4;
          align = Math.max(align, 4);
        }
      }
    });
    rec.align = align;
    rec.size = off === 0 ? (this.cpp ? 1 : 0) : packed ? off : Math.ceil(off / align) * align;
    return rec;
  }

  parseClassBody(i, end, ctx, rec, add, needVptr) {
    while (i < end) {
      if (this.is(i, ';')) {
        i++;
        continue;
      }
      if (this.isId(i) && ['public', 'private', 'protected'].includes(this.toks[i].v) && this.is(i + 1, ':')) {
        i += 2;
        continue;
      }
      const start = i;
      // constructors / destructors:  Name(  or  ~Name(
      const isDtor = this.is(i, '~') && this.isId(i + 1, ctx.clsName);
      const isCtor = this.isId(i, ctx.clsName) && this.is(i + 1, '(') && !!ctx.clsName;
      const virtualCtor = (this.isId(i, 'explicit') || this.isId(i, 'constexpr') || this.isId(i, 'inline')) && this.isId(i + 1, ctx.clsName) && this.is(i + 2, '(');
      if (isDtor || isCtor || virtualCtor) {
        if (virtualCtor) i++;
        const nameAt = isDtor ? i + 1 : i;
        const open = nameAt + 1;
        const pEnd = this.match[open];
        let j = pEnd + 1;
        rec.hasCtor = true;
        j = this.skipTo(j, end, ['{', ';']);
        const kind = isDtor ? 'dtor' : 'ctor';
        if (this.is(j, '{')) {
          this.funcs.push({ name: ctx.clsName, parts: [...ctx.ns, ctx.clsName, isDtor ? '~' + ctx.clsName : ctx.clsName], cls: ctx.clsName, kind, params: this.paramList(open + 1, pEnd), body: [j + 1, this.match[j]], local: false, mem: true, inline: true });
          j = this.match[j] + 1;
        } else this.declareMethod(kind, ctx, this.paramList(open + 1, pEnd));
        i = this.is(j, ';') ? j + 1 : j;
        if (isDtor && this.toks.slice(start, i).some((x) => x.v === 'virtual')) needVptr();
        continue;
      }
      if (this.isId(i, 'virtual') && this.is(i + 1, '~')) {
        needVptr();
        rec.virtuals ||= [];
        const dn = '~' + ctx.clsName;
        if (!rec.virtuals.some((v) => v.name.startsWith('~'))) {
          rec.virtuals.push({ sig: dn + '#1', name: dn, params: [], dtor: true }, { sig: dn + '#0', name: dn, params: [], dtor: true });
        }
        i++;
        continue;
      }
      if (this.isId(i, 'friend') || this.isId(i, 'using') || this.isId(i, 'template') || this.isId(i, 'static_assert')) {
        i = this.skipDecl(i, end);
        if (this.isId(start, 'template')) this.note('C++ templates are not instantiated by the simulator; their code is not counted.');
        continue;
      }
      if (this.isId(i, 'typedef')) {
        i = this.declaration(i, end, ctx, rec, add, needVptr);
        continue;
      }
      i = this.declaration(i, end, ctx, rec, add, needVptr);
      if (i === start) i++;
    }
  }

  declareMethod(kind, ctx, params) {
    /* declaration only: defined elsewhere */
  }

  skipDecl(i, end) {
    let j = this.skipTo(i, end, [';', '{']);
    if (this.is(j, '{')) {
      j = this.match[j] + 1;
      if (this.is(j, ';')) j++;
      return j;
    }
    return j + 1;
  }

  paramList(i, end) {
    const out = [];
    let s = i;
    for (let j = i; j <= end; j++) {
      if (j === end || (this.is(j, ',') )) {
        if (j > s) out.push(this.toks.slice(s, j));
        s = j + 1;
      } else if (this.toks[j].t === 'p' && OPEN[this.toks[j].v]) j = this.match[j];
    }
    return out.filter((p) => !(p.length === 1 && p[0].v === 'void'));
  }

  /* ---------- const-expression evaluation ---------- */
  // returns { n, sym?, add? } or null
  evalConst(i, end, toks = null) {
    const T = toks || this.toks;
    const m = toks ? null : this.match;
    let p = i;
    const self = this;
    const peekV = () => (p < end ? T[p].v : undefined);
    const closeOf = (k) => {
      let d = 0;
      for (let q = k; q < end; q++) {
        if (OPEN[T[q].v] && T[q].t === 'p') d++;
        else if (')]}'.includes(T[q].v) && T[q].t === 'p' && --d === 0) return q;
      }
      return end;
    };
    const prim = () => {
      const t = T[p];
      if (!t || p >= end) throw 0;
      if (t.t === 'num') {
        p++;
        if (/[.eE]/.test(t.v) && !/^0[xX]/.test(t.v)) throw 0;
        return { n: numValue(t.v) };
      }
      if (t.t === 'chr') {
        p++;
        return { n: charValue(t.v) };
      }
      if (t.t === 'str') {
        p++;
        return { n: 0, sym: self.stringSymbol(t.v), add: 0, str: true };
      }
      if (t.t === 'p') {
        if (t.v === '(') {
          const c = closeOf(p);
          // cast?
          const first = T[p + 1];
          if (first && first.t === 'id' && (WORDS.has(first.v) || self.types.has(first.v) || self.alias.has(first.v) || ['struct', 'union', 'enum', 'const', 'volatile'].includes(first.v)) && c + 1 < end && !(T[c + 1].t === 'p' && [')', ',', ';', '+', '-', '*', '/', '%', '|', '&&', '||', '?', ':', '<', '>', '=='].includes(T[c + 1].v) && !['&', '-', '*', '~', '!', '('].includes(T[c + 1].v))) {
            const castType = self.typeFromTokens(T.slice(p + 1, c));
            p = c + 1;
            const v = unary();
            if (castType && castType.size === 1 && v.n !== undefined && !v.sym) return { n: v.n & 255 };
            return v;
          }
          p++;
          const v = tern();
          if (peekV() === ')') p++;
          return v;
        }
        if (t.v === '-') {
          p++;
          const v = unary();
          if (v.sym) throw 0;
          return { n: -v.n };
        }
        if (t.v === '+') {
          p++;
          return unary();
        }
        if (t.v === '~') {
          p++;
          return { n: ~unary().n >>> 0 };
        }
        if (t.v === '!') {
          p++;
          return { n: +!unary().n };
        }
        if (t.v === '&') {
          p++;
          const v = unary();
          if (!v.sym) {
            // &name
            throw 0;
          }
          return v;
        }
      }
      if (t.t === 'id') {
        if (t.v === 'sizeof' || t.v === 'alignof' || t.v === '_Alignof') {
          p++;
          let ty;
          if (peekV() === '(') {
            const c = closeOf(p);
            ty = self.typeFromTokens(T.slice(p + 1, c)) || self.exprType(T.slice(p + 1, c));
            p = c + 1;
          } else {
            ty = self.exprType([T[p]]);
            p++;
          }
          if (!ty) throw 0;
          return { n: t.v === 'sizeof' ? ty.size : ty.align };
        }
        if (['static_cast', 'reinterpret_cast', 'const_cast'].includes(t.v) && T[p + 1]?.v === '<') {
          let q = p + 2;
          while (q < end && T[q].v !== '>') q++;
          p = q + 1;
          return prim();
        }
        p++;
        if (self.consts.has(t.v)) return { n: self.consts.get(t.v) };
        if (t.v === 'nullptr' || t.v === 'NULL') return { n: 0 };
        if (t.v === 'true') return { n: 1 };
        if (t.v === 'false') return { n: 0 };
        // postfix [..]
        let r = { n: 0, sym: t.v, add: 0 };
        self.markRef(t.v);
        while (peekV() === '[') {
          const c = closeOf(p);
          const idx = self.evalConst(p + 1, c, T);
          const v = self.vars?.get?.(t.v);
          if (!idx || idx.sym || !v || !v.type.elem) throw 0;
          r = { n: 0, sym: t.v, add: r.add + idx.n * v.type.elem.size };
          p = c + 1;
        }
        while (peekV() === '::' && T[p + 1]?.t === 'id') {
          r = { n: 0, sym: T[p + 1].v, add: 0 };
          p += 2;
        }
        if (peekV() === '(') throw 0; // function call: not a constant
        return r;
      }
      throw 0;
    };
    const unary = () => prim();
    const BIN = [['*', '/', '%'], ['+', '-'], ['<<', '>>'], ['<', '>', '<=', '>='], ['==', '!='], ['&'], ['^'], ['|'], ['&&'], ['||']];
    const lvl = (k) => {
      if (k < 0) return unary();
      let l = lvl(k - 1);
      while (BIN[k].includes(peekV())) {
        const op = T[p++].v;
        const r = lvl(k - 1);
        if (op === '+' && (l.sym || r.sym)) {
          if (l.sym && r.sym) throw 0;
          const s = l.sym ? l : r, o = l.sym ? r : l;
          l = { n: 0, sym: s.sym, add: (s.add || 0) + o.n };
          continue;
        }
        if (op === '-' && l.sym && !r.sym) {
          l = { n: 0, sym: l.sym, add: (l.add || 0) - r.n };
          continue;
        }
        if (l.sym || r.sym) throw 0;
        const a = l.n, b = r.n;
        l = { n: { '*': a * b, '/': b ? Math.trunc(a / b) : 0, '%': b ? a % b : 0, '+': a + b, '-': a - b, '<<': a * 2 ** b, '>>': Math.floor(a / 2 ** b), '<': +(a < b), '>': +(a > b), '<=': +(a <= b), '>=': +(a >= b), '==': +(a === b), '!=': +(a !== b), '&': Number(BigInt(a) & BigInt(b)), '^': Number(BigInt(a) ^ BigInt(b)), '|': Number(BigInt(a) | BigInt(b)), '&&': +(a && b), '||': +(a || b) }[op] };
      }
      return l;
    };
    const tern = () => {
      const c = lvl(BIN.length - 1);
      if (peekV() === '?') {
        p++;
        const a = tern();
        if (peekV() === ':') p++;
        const b = tern();
        return c.n ? a : b;
      }
      return c;
    };
    try {
      const v = tern();
      return p >= end ? v : null;
    } catch {
      return null;
    }
  }

  markRef() {}

  typeFromTokens(toks) {
    if (!toks.length) return null;
    const words = [];
    let type = null, stars = 0, arrays = [];
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      if (t.t === 'id') {
        if (WORDS.has(t.v)) words.push(t.v);
        else if (['const', 'volatile', 'struct', 'union', 'enum', 'class', 'unsigned', 'signed'].includes(t.v)) {
          if (['struct', 'union', 'enum', 'class'].includes(t.v) && toks[k + 1]) {
            type = this.types.get(`${t.v === 'class' ? 'struct' : t.v} ${toks[k + 1].v}`) || this.types.get(toks[k + 1].v) || sc(4);
            k++;
          }
        } else if (this.types.has(t.v)) type = this.types.get(t.v);
        else if (k === 0) return null;
      } else if (t.v === '*') stars++;
      else if (t.v === '(') return stars ? this.ptrTo(sc(4)) : null; // function pointer cast
      else if (t.v === '[') arrays.push(1);
    }
    if (!type && words.length) type = baseOf(words).type;
    if (!type) return null;
    if (stars) type = this.ptrTo(type);
    return type;
  }

  exprType(toks) {
    if (toks.length === 1 && toks[0].t === 'id') {
      const v = this.vars?.get(toks[0].v);
      return v ? v.type : null;
    }
    if (toks.length === 1 && toks[0].t === 'str') return this.arrayOf(sc(1), stringBytes(toks[0].v).length + 1);
    return null;
  }

  stringSymbol(lit) {
    const key = stringBytes(lit).join(',');
    if (!this.strings.has(key)) this.strings.set(key, { id: this.strings.size, bytes: stringBytes(lit) });
    return `.LC${this.strings.get(key).id}`;
  }

  /* ---------- initialisers -> bytes ---------- */
  splitItems(i, end) {
    const items = [];
    let s = i;
    for (let j = i; j <= end; j++) {
      if (j === end || this.is(j, ',')) {
        if (j > s) items.push([s, j]);
        s = j + 1;
      } else if (this.toks[j].t === 'p' && OPEN[this.toks[j].v]) j = this.match[j];
    }
    return items;
  }

  initBytes(type, i, end, out) {
    // out: { bytes:[], relocs:[], known:true }. Writes at out.base
    const base = out.base;
    const zero = () => {};
    if (i >= end) return;
    if (type.kind === 'array') {
      const elem = type.elem;
      if (!this.is(i, '{')) {
        if (this.toks[i].t === 'str' && elem.size === 1) {
          let b = [];
          for (let k = i; k < end && this.toks[k].t === 'str'; k++) b = b.concat(stringBytes(this.toks[k].v));
          b.forEach((v, k) => (k < type.size || type.count == null) && (out.bytes[base + k] = v));
          return;
        }
        out.known = false;
        return;
      }
      const items = this.splitItems(i + 1, this.match[i]);
      let idx = 0;
      for (const [a, b] of items) {
        if (this.is(a, '[') ) {
          const c = this.match[a];
          const d = this.evalConst(a + 1, c);
          idx = d && !d.sym ? d.n : idx;
          const eq = this.is(c + 1, '=') ? c + 2 : c + 1;
          out.base = base + idx * elem.size;
          this.initElem(elem, eq, b, out);
        } else {
          out.base = base + idx * elem.size;
          this.initElem(elem, a, b, out);
        }
        idx++;
      }
      out.maxIdx = Math.max(out.maxIdx || 0, idx);
      out.base = base;
      return;
    }
    this.initElem(type, i, end, out);
  }

  initElem(type, a, b, out) {
    const base = out.base;
    if (type.kind === 'array') return this.initBytes(type, a, b, out);
    if (type.kind === 'struct') {
      if (!this.is(a, '{')) {
        out.known = false;
        return;
      }
      const items = this.splitItems(a + 1, this.match[a]);
      let mi = type.union ? 0 : type.members[0]?.name === '__vptr' ? 1 : 0;
      for (const [x, y] of items) {
        let m;
        let s = x;
        if (this.is(x, '.') && this.isId(x + 1) && this.is(x + 2, '=')) {
          m = type.members.find((q) => q.name === this.toks[x + 1].v);
          s = x + 3;
        } else m = type.members[mi++];
        if (!m) {
          out.known = false;
          continue;
        }
        out.base = base + m.offset;
        this.initElem(m.type, s, y, out);
      }
      out.base = base;
      return;
    }
    if (this.is(a, '{')) {
      const inner = this.splitItems(a + 1, this.match[a]);
      if (inner.length) return this.initElem(type, inner[0][0], inner[0][1], out);
      return;
    }
    if (type.kind === 'scalar' && type.size && /^(float|double)$/.test(type.name || '')) {
      const v = Number(this.toks.slice(a, b).map((t) => t.v).join('').replace(/[fF]$/, ''));
      if (!Number.isNaN(v)) {
        const buf = new DataView(new ArrayBuffer(8));
        type.size === 4 ? buf.setFloat32(0, v, true) : buf.setFloat64(0, v, true);
        for (let k = 0; k < type.size; k++) out.bytes[base + k] = buf.getUint8(k);
        return;
      }
    }
    const v = this.evalConst(a, b);
    if (!v) {
      out.known = false;
      return;
    }
    if (v.sym) {
      out.relocs.push({ off: base, sym: v.sym, addend: v.add || 0 });
      return;
    }
    let n = BigInt(Math.trunc(v.n));
    for (let k = 0; k < type.size; k++) {
      out.bytes[base + k] = Number(n & 255n);
      n >>= 8n;
    }
  }

  /* ---------- declarations ---------- */
  declarator(i, end, base, ctx) {
    const r = { ptr: 0, ptrConst: false, name: null, parts: [], dims: [], fn: null, i, isFnPtr: false, ref: false };
    for (;;) {
      if (this.is(i, '*')) {
        r.ptr++;
        r.ptrConst = false;
        i++;
      } else if (this.is(i, '&') || this.is(i, '&&')) {
        r.ref = true;
        i++;
      } else if (this.isId(i) && (QUALS.has(this.toks[i].v) || ['__restrict__'].includes(this.toks[i].v))) {
        if (this.toks[i].v === 'const') r.ptrConst = true;
        i++;
      } else if (this.isId(i, '__attribute__')) i = this.match[i + 1] + 1;
      else break;
    }
    let named = false;
    if (this.is(i, '(') && this.is(i + 1, '*')) {
      const c = this.match[i];
      const inner = this.toks.slice(i + 1, c).filter((t) => t.t === 'id' && !QUALS.has(t.v));
      r.name = inner.length ? inner[inner.length - 1].v : null;
      r.parts = r.name ? [r.name] : [];
      r.ptrConst = this.toks.slice(i + 1, c).some((t) => t.t === 'id' && t.v === 'const');
      for (let k = i + 1; k < c; k++) {
        if (this.is(k, '[')) {
          const cc = this.match[k];
          const v = cc > k + 1 ? this.evalConst(k + 1, cc) : null;
          r.dims.push(cc === k + 1 ? null : v && !v.sym ? v.n : undefined);
          k = cc;
        }
      }
      i = c + 1;
      if (this.is(i, '(')) i = this.match[i] + 1;
      r.isFnPtr = true;
      r.ptr = 1;
      named = true;
    }
    // name:  a::b::c  | operator X | ~Name
    if (named) {
      /* function pointer: name already read */
    } else if (this.isId(i, 'operator')) {
      let j = i + 1;
      while (j < end && !this.is(j, '(')) j++;
      r.parts = ['operator' + this.toks.slice(i + 1, j).map((t) => t.v).join('')];
      r.name = r.parts[0];
      i = j;
    } else if (this.is(i, '~') && this.isId(i + 1)) {
      r.parts = ['~' + this.toks[i + 1].v];
      r.name = r.parts[0];
      i += 2;
    } else if (this.isId(i) && !STORAGE.has(this.toks[i].v)) {
      r.parts = [this.toks[i++].v];
      while (this.is(i, '::') && (this.isId(i + 1) || this.is(i + 1, '~'))) {
        if (this.is(i + 1, '~')) {
          r.parts.push('~' + this.toks[i + 2].v);
          i += 3;
        } else if (this.isId(i + 1, 'operator')) {
          let j = i + 2;
          while (j < end && !this.is(j, '(')) j++;
          r.parts.push('operator' + this.toks.slice(i + 2, j).map((t) => t.v).join(''));
          i = j;
        } else {
          r.parts.push(this.toks[i + 1].v);
          i += 2;
        }
      }
      r.name = r.parts[r.parts.length - 1];
    }
    while (this.is(i, '[')) {
      const c = this.match[i];
      const v = c > i + 1 ? this.evalConst(i + 1, c) : null;
      r.dims.push(c === i + 1 ? null : v && !v.sym ? v.n : undefined);
      i = c + 1;
    }
    r.attrs = {};
    while (this.isId(i, '__attribute__')) {
      this.readAttrs(i + 1, r.attrs);
      i = this.match[i + 1] + 1;
    }
    if (this.is(i, ':') && !this.is(i, '::')) {
      const e = this.skipTo(i + 1, end, [',', ';', '=']);
      const w = this.evalConst(i + 1, e);
      r.bits = w ? w.n : 1;
      i = e;
    }
    if (this.is(i, '(') && !this.is(i - 1, '=')) {
      r.fn = { open: i, close: this.match[i] };
      i = this.match[i] + 1;
      // trailing: const noexcept override final = 0 / default / delete, attributes, -> ret, ctor-init list
      for (;;) {
        if (this.isId(i) && ['const', 'noexcept', 'override', 'final', 'volatile', 'throw'].includes(this.toks[i].v)) {
          if (this.toks[i].v === 'const') r.constMethod = true;
          i++;
          if (this.is(i, '(') && this.toks[i - 1].v !== 'const') i = this.match[i] + 1;
        } else if (this.isId(i, '__attribute__')) i = this.match[i + 1] + 1;
        else if (this.is(i, '=') && (this.isId(i + 1, 'default') || this.isId(i + 1, 'delete') || (this.toks[i + 1]?.t === 'num' && this.toks[i + 1].v === '0'))) {
          if (this.toks[i + 1].v === '0') r.pure = true;
          if (this.toks[i + 1].v === 'default' || this.toks[i + 1].v === 'delete') r.deleted = true;
          i += 2;
        } else if (this.is(i, '->')) i = this.skipTo(i, end, ['{', ';', ',']);
        else if (this.is(i, ':') && !this.is(i, '::')) i = this.skipTo(i, end, ['{', ';']);
        else break;
      }
    }
    r.i = i;
    return r;
  }

  applyDeclType(base, d) {
    let t = base;
    for (let k = 0; k < d.ptr; k++) t = this.ptrTo(t);
    if (d.ref) t = this.ptrTo(t);
    for (let k = d.dims.length - 1; k >= 0; k--) t = this.arrayOf(t, d.dims[k] === undefined ? 0 : d.dims[k]);
    return t;
  }

  // Parses one declaration starting at i; returns index after it.
  declaration(i, end, ctx, rec, add, needVptr) {
    if (++this.steps > 400000) throw new Error('the file is too complicated for the simulator');
    const specs = this.specs(i, end, ctx);
    i = specs.i;
    const inClass = !!rec;
    if (specs.storage.typedef) {
      for (;;) {
        const d = this.declarator(i, end, specs.type, ctx);
        if (d.name && specs.type) {
          const t = this.applyDeclType(specs.type, d);
          this.types.set(d.name, d.isFnPtr ? this.ptrTo(sc(4)) : t);
          this.alias.set(d.name, d.ptr || d.isFnPtr ? d.name : specs.cname || specs.words.join(' ') || d.name);
          if (!d.ptr && !d.isFnPtr && specs.words.length) this.alias.set(d.name, baseOf(specs.words).key);
        }
        i = d.i;
        if (this.is(i, ',')) {
          i++;
          continue;
        }
        break;
      }
      return this.skipTo(i, end, [';']) + 1;
    }
    if (!specs.type) {
      // not a type: expression statement or unsupported construct
      const e = this.skipDecl(i, end);
      return Math.max(e, i + 1);
    }
    if (this.is(i, ';')) return i + 1; // plain type definition
    if (specs.storage.virtual) needVptr?.();
    let first = true;
    for (;;) {
      const d = this.declarator(i, end, specs.type, ctx);
      i = d.i;
      Object.assign(specs.attrs, d.attrs || {});
      if (!d.name && !d.fn) return this.skipDecl(i, end);
      if (first && specs.storage.virtual && d.fn) {
        // record virtual method for vtable construction
        rec.virtuals ||= [];
        const sig = d.name + '(' + this.paramList(d.fn.open + 1, d.fn.close).map((p) => this.paramCode(p)).join('') + ')';
        const k = rec.virtuals.findIndex((v) => v.sig === sig);
        const entry = { sig, name: d.name, params: this.paramList(d.fn.open + 1, d.fn.close), pure: d.pure, inlineBody: this.is(i, '{') };
        if (k >= 0) rec.virtuals[k] = entry;
        else rec.virtuals.push(entry);
        needVptr?.();
      } else if (first && rec && d.fn && !specs.storage.static && rec.virtuals?.length) {
        // an override of an inherited virtual method (no `virtual` keyword needed)
        const sig = d.name + '(' + this.paramList(d.fn.open + 1, d.fn.close).map((p) => this.paramCode(p)).join('') + ')';
        const k = rec.virtuals.findIndex((v) => v.sig === sig);
        if (k >= 0) rec.virtuals[k] = { sig, name: d.name, params: this.paramList(d.fn.open + 1, d.fn.close) };
      }
      first = false;
      const quals = { const: specs.const, ptrConst: d.ptrConst, ptr: d.ptr > 0 };
      if (d.fn && !d.isFnPtr && this.cpp && ctx.cls === null && d.fn.close > d.fn.open + 1 && !this.looksLikeParams(d.fn)) {
        d.initParen = d.fn.open;
        d.fn = null;
      }
      if (d.fn && !d.isFnPtr) {
        // function declaration or definition
        const parts = [...(inClass ? [...ctx.ns, ctx.clsName] : ctx.ns), ...d.parts];
        const cls = inClass ? ctx.clsName : d.parts.length > 1 ? d.parts[d.parts.length - 2] : ctx.cls?.name || null;
        const ctorName = d.parts.length > 1 && d.parts[d.parts.length - 1] === d.parts[d.parts.length - 2];
        const kind = d.name.startsWith('~') ? 'dtor' : ctorName ? 'ctor' : 'func';
        const params = this.paramList(d.fn.open + 1, d.fn.close);
        if (this.is(i, '{') || (this.is(i, ':') && !this.is(i, '::'))) {
          const b = this.skipTo(i, end, ['{']);
          if (b >= end) return end;
          const close = this.match[b];
          this.funcs.push({ name: d.name, parts, cls, kind, params, body: [b + 1, close], local: !!specs.storage.static || (specs.storage.inline && !this.cpp), storageInline: !!specs.storage.inline, inline: inClass, attrs: specs.attrs, constMethod: d.constMethod, cLinkage: ctx.cLinkage, mem: inClass, ret: specs.type, weak: specs.attrs.weak });
          return close + 1;
        }
        // prototype
        if (!specs.storage.virtual && !d.pure) {
          const sym = this.mangle(parts, params, { cls, kind, constMethod: d.constMethod, cLinkage: ctx.cLinkage, name: d.name });
          if (!this.declFuncs.has(d.name)) this.declFuncs.set(d.name, []);
          this.declFuncs.get(d.name).push(sym);
          this.declared.add(sym);
        }
      } else if (!d.fn || d.isFnPtr) {
        const baseType = specs.type;
        let type = this.applyDeclType(baseType, d);
        // unspecified array size comes from the initialiser
        let initAt = null;
        if (this.is(i, '=')) initAt = i + 1;
        else if (this.is(i, '{') && this.cpp) initAt = i;
        else if (d.initParen != null) initAt = d.initParen;
        const stop = initAt != null ? this.skipTo(initAt, end, [',', ';']) : i;
        if (inClass && !specs.storage.static) {
          if (d.bits) {
            this.bitfield(rec, type, d, add);
          } else add(type, d.name);
          i = stop;
        } else {
          this.variable({ d, type, specs, initAt, stop, quals, ctx, cls: inClass ? ctx.clsName : d.parts.length > 1 ? d.parts[d.parts.length - 2] : null });
          i = stop;
        }
      }
      if (this.is(i, ',')) {
        i++;
        continue;
      }
      break;
    }
    return this.is(i, ';') ? i + 1 : i;
  }

  looksLikeParams(fn) {
    const t = this.toks[fn.open + 1];
    if (!t) return true;
    if (t.t === 'id') return this.isTypeStart(fn.open + 1) || t.v === 'void' || t.v === 'const' || this.types.has(t.v) || this.alias.has(t.v) || this.isId(fn.open + 2);
    return t.v === '.' ;
  }

  bitfield(rec, type, d, add) {
    rec._bf ||= null;
    const bf = rec._bf;
    if (bf && bf.type.size === type.size && bf.used + d.bits <= type.size * 8) {
      bf.used += d.bits;
      return;
    }
    rec._bf = { type, used: d.bits };
    add(type, d.name || '(bits)');
  }

  variable({ d, type, specs, initAt, stop, quals, ctx, cls }) {
    this.vars ||= new Map();
    const name = d.name;
    const sym = (this.cpp && (ctx.ns.length || cls) && !ctx.cLinkage ? this.mangleVar([...ctx.ns, ...(cls ? [cls] : []), name]) : name);
    if (specs.storage.extern && initAt == null) {
      this.vars.set(name, { type, extern: true });
      this.declared.add(sym);
      return;
    }
    // static data member declaration inside a class: wait for the out-of-class definition
    if (ctx.cls && specs.storage.static && initAt == null && ctx.clsName && !ctx.defining) {
      if (!specs.storage.constexpr) {
        this.vars.set(name, { type, extern: true });
        return;
      }
    }
    let known = true;
    const out = { bytes: [], relocs: [], known: true, base: 0 };
    if (initAt != null) {
      this.initBytes(type, initAt, stop, out);
      if (type.kind === 'array' && (type.count === 0 || type.count == null)) {
        if (out.maxIdx) type = this.arrayOf(type.elem, out.maxIdx);
        else if (this.toks[initAt]?.t === 'str') type = this.arrayOf(type.elem, stringBytes(this.toks[initAt].v).length + 1);
      }
      known = out.known;
    }
    if (type.kind === 'array' && !type.count) type = this.arrayOf(type.elem, 1);
    this.vars.set(name, { type });
    const isConstObj = specs.const && !(d.ptr > 0 && !d.ptrConst) || (d.ptr > 0 && d.ptrConst) || specs.storage.constexpr;
    const size = type.size || 1;
    const bytes = new Uint8Array(size);
    out.bytes.forEach((v, k) => k < size && (bytes[k] = v & 255));
    const allZero = !out.bytes.some((v) => v) && !out.relocs.length;
    const dynamic = this.cpp && ((type.kind === 'struct' && (type.hasCtor || type.hasVptr)) || (initAt != null && this.hasCall(initAt, stop)));
    const local = !!specs.storage.static || (this.cpp && isConstObj && !specs.storage.extern && !ctx.cls);
    const attrAlign = specs.attrs.aligned;
    const align = attrAlign || Math.max(type.align || 1, 1);
    let secName, flags, stype, content = true;
    const suffix = this.ds ? '.' + sym : '';
    if (specs.attrs.section) {
      secName = specs.attrs.section;
      flags = isConstObj ? 'A' : 'WA';
      stype = 'PROGBITS';
    } else if (dynamic) {
      secName = '.bss' + suffix;
      flags = 'WA';
      stype = 'NOBITS';
      content = false;
    } else if (isConstObj) {
      secName = '.rodata' + suffix;
      flags = 'A';
      stype = 'PROGBITS';
    } else if (initAt == null || (allZero && known)) {
      secName = '.bss' + suffix;
      flags = 'WA';
      stype = 'NOBITS';
      content = false;
    } else {
      secName = '.data' + suffix;
      flags = 'WA';
      stype = 'PROGBITS';
    }
    const localId = ctx.localFn ? this.lc++ : 0;
    if (ctx.localFn) secName = secName.replace(suffix, this.ds ? `.${ctx.localFn}.${localId}` : '');
    const sec = this.section(secName, { type: stype, flags: flags.replace('WA', 'WA').replace('A', 'A'), align });
    const off = this.place(sec, size, align, content ? bytes : null, known);
    for (const r of out.relocs) sec.relocs.push({ ...r, off: off + r.off });
    if (known === false) sec.approx = true;
    const final = ctx.localFn ? `${name}.${localId}` : sym;
    this.addSymbol({ name: final, display: (cls ? cls + '::' : ctx.ns.length ? ctx.ns.join('::') + '::' : '') + name, section: secName, value: off, size, bind: specs.attrs.weak ? 'WEAK' : local || ctx.localFn ? 'LOCAL' : 'GLOBAL', type: 'OBJECT', kind: stype === 'NOBITS' ? 'bss' : isConstObj ? 'rodata' : 'data' });
    this.idSyms.set(name, [...(this.idSyms.get(name) || []), final]);
    if (dynamic) this.dyn.push({ sym: final, type, ctor: type.kind === 'struct' ? this.ctorSymbol(type) : null });
  }

  hasCall(a, b) {
    for (let k = a; k < b - 1; k++) if (this.isId(k) && !KEYWORDS.has(this.toks[k].v) && this.is(k + 1, '(') && !this.types.has(this.toks[k].v) && !WORDS.has(this.toks[k].v) && !['constexpr'].includes(this.toks[k].v)) return true;
    return false;
  }

  ctorSymbol(type) {
    return this.cpp && type.name ? this.mangle([type.name], [], { cls: type.name, kind: 'ctor', name: type.name }) : null;
  }

  /* ---------- names ---------- */
  paramCode(toks) {
    // strip default value
    const eq = toks.findIndex((t) => t.v === '=');
    if (eq >= 0) toks = toks.slice(0, eq);
    const words = [];
    let ptr = 0, ref = false, constBefore = false, name = null, cls = null, seenType = false, constAfterStar = false;
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      if (t.t === 'id') {
        if (t.v === 'const') {
          if (ptr) constAfterStar = true;
          else constBefore = true;
        } else if (QUALS.has(t.v) || t.v === 'volatile' || t.v === 'struct' || t.v === 'class' || t.v === 'enum') continue;
        else if (WORDS.has(t.v)) words.push(t.v), (seenType = true);
        else if (!seenType && (this.alias.has(t.v) || this.types.has(t.v))) {
          seenType = true;
          const a = this.alias.get(t.v);
          if (a && MANGLE[a]) words.push(...a.split(' '));
          else cls = t.v;
        } else if (!seenType) {
          seenType = true;
          cls = t.v;
        } else name = t.v;
      } else if (t.v === '*') ptr++;
      else if (t.v === '&' || t.v === '&&') ref = true;
      else if (t.v === '[') ptr++, (k = this.skipBracket(toks, k));
      else if (t.v === '(') return 'PFvvE';
    }
    let code;
    if (cls) code = this.qualName(cls);
    else {
      const b = baseOf(words.length ? words : ['int']);
      code = MANGLE[b.key] || 'i';
    }
    if (constBefore) code = 'K' + code;
    for (let k = 0; k < ptr; k++) code = 'P' + code;
    if (constAfterStar) code = 'K' + code;
    if (ref) code = 'R' + code;
    return code;
  }
  qualName(cls) {
    const ns = this.classes.get(cls)?.ns || [];
    const parts = [...ns, cls];
    return parts.length > 1 ? `N${parts.map((n) => n.length + n).join('')}E` : cls.length + cls;
  }
  skipBracket(toks, k) {
    while (k < toks.length && toks[k].v !== ']') k++;
    return k;
  }

  mangle(parts, params, { cls, kind, constMethod, cLinkage, name }) {
    if (!this.cpp || cLinkage) return name;
    if (name === 'main' && parts.length === 1) return 'main';
    const p = params.map((x) => this.paramCode(x)).join('') || 'v';
    const names = [...parts];
    let last;
    if (kind === 'ctor') {
      names.pop();
      last = 'C2';
    } else if (kind === 'dtor') {
      names.pop();
      last = 'D2';
    } else {
      last = names.pop();
      last = last.startsWith('operator') ? ({ 'operator=': 'aS', 'operator+': 'pl', 'operator-': 'mi', 'operator==': 'eq', 'operator[]': 'ix', 'operator()': 'cl' }[last] || last.length + last) : last.length + last;
    }
    const q = names.map((n) => n.length + n).join('');
    const tail = typeof last === 'string' && /^(C2|D2|aS|pl|mi|eq|ix|cl)$/.test(last) ? last : last;
    if (!names.length) return `_Z${tail}${p}`;
    return `_ZN${constMethod ? 'K' : ''}${q}${tail}E${p}`;
  }
  mangleVar(parts) {
    if (parts.length === 1) return parts[0];
    return `_ZN${parts.slice(0, -1).map((n) => n.length + n).join('')}${parts[parts.length - 1].length}${parts[parts.length - 1]}E`.replace(/E$/, 'E');
  }

  /* ---------- top level ---------- */
  parseScope(i, end, ctx) {
    while (i < end) {
      if (++this.steps > 400000) throw new Error('the file is too complicated for the simulator');
      if (this.is(i, ';')) {
        i++;
        continue;
      }
      const t = this.toks[i];
      if (t.t === 'id' && t.v === 'extern' && this.toks[i + 1]?.t === 'str' && this.is(i + 2, '{')) {
        const c = this.match[i + 2];
        this.parseScope(i + 3, c, { ...ctx, cLinkage: true });
        i = c + 1;
        continue;
      }
      if (t.t === 'id' && t.v === 'extern' && this.toks[i + 1]?.t === 'str') {
        i += 2;
        ctx = { ...ctx, cLinkageNext: true };
        const sub = { ...ctx, cLinkage: true };
        i = this.declaration(i, end, sub, null, null, null);
        continue;
      }
      if (t.t === 'id' && t.v === 'namespace') {
        let j = i + 1;
        const nm = this.isId(j) ? this.toks[j++].v : null;
        if (this.is(j, '{')) {
          const c = this.match[j];
          this.parseScope(j + 1, c, { ...ctx, ns: nm ? [...ctx.ns, nm] : ctx.ns });
          i = c + 1;
          continue;
        }
        i = this.skipDecl(i, end);
        continue;
      }
      if (t.t === 'id' && (t.v === 'template' || t.v === 'static_assert' || t.v === 'using' || t.v === 'asm' || t.v === '__asm__')) {
        if (t.v === 'template') this.note('C++ templates are not instantiated by the simulator; their code is not counted.');
        if (t.v === 'using' && this.isId(i + 1) && this.is(i + 2, '=')) {
          const e = this.skipTo(i + 3, end, [';']);
          const ty = this.typeFromTokens(this.toks.slice(i + 3, e));
          if (ty) {
            this.types.set(this.toks[i + 1].v, ty);
            this.alias.set(this.toks[i + 1].v, this.toks[i + 1].v);
          }
        }
        i = this.skipDecl(i, end);
        continue;
      }
      const j = this.declaration(i, end, ctx, null, null, null);
      i = j > i ? j : i + 1;
    }
  }

  finishFunctions() {
    const globalsReferenced = (ids) => ids;
    for (const f of this.funcs) {
      const [a, b] = f.body;
      const toks = this.toks.slice(a, b);
      let stmts = 0, calls = 0, branches = 0, depth = 0;
      const ids = new Set(), bigConsts = new Set(), strs = [];
      let prevStart = true;
      toks.forEach((t, k) => {
        if (t.t === 'p') {
          if (t.v === '(') depth++;
          else if (t.v === ')') depth--;
          else if (t.v === ';' && depth === 0) stmts++;
          else if (t.v === '&&' || t.v === '||' || t.v === '?') branches++;
        } else if (t.t === 'id') {
          if (['if', 'for', 'while', 'switch', 'case', 'do'].includes(t.v)) branches++;
          if (t.v === 'for') stmts++;
          else if (!KEYWORDS.has(t.v)) {
            ids.add(t.v);
            if (toks[k + 1]?.v === '(' && !this.types.has(t.v) && !WORDS.has(t.v)) calls++;
          }
        } else if (t.t === 'num' && !/[.eE]/.test(t.v) && numValue(t.v) > 0xffff) bigConsts.add(t.v);
        else if (t.t === 'str') strs.push(this.stringSymbol(t.v));
      });
      // static locals
      const fname = f.name;
      for (let k = 0; k < toks.length; k++) {
        if (toks[k].t === 'id' && toks[k].v === 'static' && (k === 0 || ['{', '}', ';'].includes(toks[k - 1].v))) {
          let e = k;
          let d = 0;
          while (e < toks.length && !(d === 0 && toks[e].v === ';')) {
            if (toks[e].t === 'p' && OPEN[toks[e].v]) e = this.match[a + e] - a;
            e++;
          }
          this.parseLocalStatic(a + k, a + e + 1, fname);
          k = e;
        }
      }
      f.est = { stmts, calls, branches, ids, bigConsts, strs };
    }
    // sizes depend on which identifiers are globals, so do it after everything is parsed
    for (const f of this.funcs) {
      const { stmts, calls, branches, ids, bigConsts, strs } = f.est;
      const globals = [...ids].filter((id) => this.vars?.has(id) && !this.vars.get(id).type?.kind?.startsWith?.('xx')).length;
      let size = (calls ? 4 : 0) + 2 * stmts + 4 * calls + 2 * branches;
      size = Math.ceil(size * this.opt) + 4 * (bigConsts.size + globals) + (f.kind === 'ctor' || f.kind === 'dtor' ? 2 : 0);
      size = Math.max(2, Math.ceil(size / 2) * 2);
      const sym = this.mangle(f.parts, f.params, f);
      const local = f.local;
      const secName = f.attrs?.section || (this.fs ? `.text.${sym}${local && !this.cpp ? '' : ''}` : '.text');
      const align = this.optName === 'Os' ? 2 : 4;
      const sec = this.section(secName, { type: 'PROGBITS', flags: 'AX', align });
      const off = this.place(sec, size, align, null, false);
      sec.estimated = true;
      if (this.cpp && (f.inline || f.mem || f.storageInline) && !f.local) sec.comdat = true;
      const refs = new Set();
      for (const id of ids) {
        for (const s of this.idSyms.get(id) || []) refs.add(s);
        for (const s of this.declFuncs.get(id) || []) refs.add(s);
        const fs = this.funcs.filter((q) => q.name === id).map((q) => this.mangle(q.parts, q.params, q));
        for (const s of fs) refs.add(s);
        if (!this.cpp || this.declared.has(id)) refs.add(id);
      }
      for (const s of strs) refs.add(s);
      for (const r of refs) sec.refs.add(r);
      f.sym = sym;
      f.size = size;
      f.display = this.display(f);
      this.addSymbol({ name: sym, display: f.display, section: secName, value: off, size, bind: f.weak || sec.comdat ? 'WEAK' : local ? 'LOCAL' : 'GLOBAL', type: 'FUNC', kind: 'text' });
      this.idSyms.set(f.name, [...(this.idSyms.get(f.name) || []), sym]);
    }
  }

  display(f) {
    const p = f.params.map((x) => x.map((t) => t.v).join(' ').replace(/\s+/g, ' ')).join(', ');
    return `${f.parts.join('::')}(${p})`;
  }

  parseLocalStatic(a, b, fname) {
    this.parseScope(a, b, { ns: [], cls: null, localFn: fname });
  }

  buildStrings() {
    if (!this.strings.size) return;
    const sec = this.section('.rodata.str1.1', { type: 'PROGBITS', flags: 'AMS', align: 1 });
    for (const { id, bytes } of this.strings.values()) {
      const arr = new Uint8Array(bytes.length + 1);
      arr.set(bytes);
      const off = this.place(sec, arr.length, 1, arr, true);
      this.symbols.push({ name: `.LC${id}`, section: sec.name, value: off, size: arr.length, bind: 'LOCAL', type: 'NOTYPE', hidden: true, kind: 'rodata', literal: bytes });
    }
  }

  buildVtables() {
    for (const rec of this.classes.values()) {
      if (!rec.virtuals?.length || !rec.name || rec.incomplete) continue;
      const key = rec.virtuals.find((v) => !v.pure && !v.inlineBody && !v.dtor);
      if (key && !this.funcs.some((f) => f.cls === rec.name && f.name === key.name && f.kind === 'func')) continue;
      const q = this.qualName(rec.name);
      const name = `_ZTV${q}`;
      const size = 4 * (2 + rec.virtuals.length);
      const sec = this.section(`.rodata.${name}`, { type: 'PROGBITS', flags: 'A', align: 4 });
      sec.comdat = true;
      const bytes = new Uint8Array(size);
      const off = this.place(sec, size, 4, bytes, true);
      rec.virtuals.forEach((v, k) => {
        const same = (f) => f.name === v.name && f.params.map((x) => this.paramCode(x)).join('') === v.params.map((x) => this.paramCode(x)).join('');
        let owner = null;
        const own = this.funcs.find((f) => f.cls === rec.name && same(f));
        if (own) owner = rec;
        else {
          const walk = (r) => {
            for (const b of r.bases || []) {
              if (this.funcs.some((f) => f.cls === b.name && same(f)) || b.virtuals?.some((x) => x.sig === v.sig && !x.pure)) return b;
              const d = walk(b);
              if (d) return d;
            }
            return null;
          };
          owner = walk(rec);
        }
        const target = v.dtor ? (owner ? this.mangle([...(owner.ns || []), owner.name, '~' + owner.name], [], { cls: owner.name, kind: 'dtor', name: '~' + owner.name }) : '__cxa_pure_virtual') : owner && !(v.pure && !own) ? this.mangle([...(owner.ns || []), owner.name, v.name], v.params, { cls: owner.name, kind: 'func', constMethod: false, name: v.name }) : '__cxa_pure_virtual';
        sec.relocs.push({ off: off + 8 + 4 * k, sym: target, addend: 0 });
        sec.refs.add(target);
      });
      this.addSymbol({ name, display: `vtable for ${rec.name}`, section: sec.name, value: off, size, bind: 'WEAK', type: 'OBJECT', kind: 'rodata' });
    }
  }
  ownerOf(rec, v) {
    for (const b of rec.bases) {
      if (this.funcs.some((f) => f.cls === b.name && f.name === v.name)) return b.name;
    }
    return null;
  }

  buildDynInit() {
    if (!this.dyn.length) return;
    const n = this.dyn.length;
    const name = `_GLOBAL__sub_I_${this.name.replace(/\.o$/, '').replace(/[^\w]/g, '_')}`;
    const size = 8 + 8 * n;
    const sec = this.section(`.text.startup.${name}`, { type: 'PROGBITS', flags: 'AX', align: 4 });
    const off = this.place(sec, size, 4, null, false);
    sec.estimated = true;
    for (const d of this.dyn) {
      sec.refs.add(d.sym);
      if (d.ctor) sec.refs.add(d.ctor);
    }
    this.addSymbol({ name, display: `global constructors keyed to ${this.name}`, section: sec.name, value: off, size, bind: 'LOCAL', type: 'FUNC', kind: 'text' });
    const ia = this.section('.init_array', { type: 'INIT_ARRAY', flags: 'WA', align: 4 });
    const io = this.place(ia, 4, 4, new Uint8Array(4), true);
    ia.relocs.push({ off: io, sym: name, addend: 0 });
    ia.refs.add(name);
    this.note(`C++ global objects with constructors (${this.dyn.map((d) => d.sym).join(', ')}) are placed in .bss and constructed at start-up through .init_array.`);
  }

  run() {
    this.vars = new Map();
    if (this.unbalanced) this.note('The brackets ( ) { } [ ] are not balanced in this file, so the analysis may be incomplete.');
    // Pass 1 finds typedefs / types so forward uses work, pass 2 is the real parse (types are re-created identically).
    this.parseScope(0, this.toks.length, { ns: [], cls: null });
    // out-of-class definitions of functions with a body were collected in this.funcs
    this.finishFunctions();
    this.buildStrings();
    this.buildVtables();
    this.buildDynInit();
    // materialise sections
    const sections = [];
    for (const s of this.sections.values()) {
      const bytes = new Uint8Array(s.size);
      const known = new Uint8Array(s.size);
      for (const c of s.chunks) {
        if (c.bytes) bytes.set(c.bytes, c.off);
        if (c.known && c.bytes) known.fill(1, c.off, c.off + c.size);
      }
      sections.push({ name: s.name, type: s.type, flags: s.flags, align: s.align, size: s.size, bytes: s.type === 'NOBITS' ? null : bytes, known: s.type === 'NOBITS' ? null : known, relocs: s.relocs, refs: [...s.refs], estimated: !!s.estimated, approx: !!s.approx, comdat: !!s.comdat });
    }
    const undefinedSyms = new Set();
    for (const d of this.declared) if (!this.defined.has(d)) undefinedSyms.add(d);
    return { name: this.name, sections, symbols: this.symbols, declared: [...undefinedSyms], notes: this.notes, cpp: this.cpp };
  }
}
