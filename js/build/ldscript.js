// GNU ld linker script parser (the common subset) and its expression evaluator.
// Supports ENTRY, MEMORY, SECTIONS (output sections, input specs, KEEP, SORT, EXCLUDE_FILE, /DISCARD/,
// assignments, PROVIDE, location counter, ALIGN/ORIGIN/LENGTH/ADDR/LOADADDR/SIZEOF/DEFINED/MAX/MIN, AT(), AT>, ASSERT, BYTE..QUAD).

export function lexScript(src) {
  const text = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const toks = [];
  const re = /\s+|"([^"]*)"|([A-Za-z0-9_.$*?\/\\\[\]:@]+)|(<<|>>|<=|>=|==|!=|&&|\|\||\+=|-=|\*=|\/=|[\s\S])/g;
  let m, line = 1, last = 0;
  while ((m = re.exec(text))) {
    line += (text.slice(last, m.index).match(/\n/g) || []).length;
    last = m.index;
    if (m[1] !== undefined) toks.push({ v: m[1], str: true, line });
    else if (m[2]) {
      // "4*1024" lexes as one word: split numeric products back apart
      const s = /^(0[xX][0-9a-fA-F]+|\d+[KkMm]?)\*(.+)$/.exec(m[2]);
      if (s) toks.push({ v: s[1], line }, { v: '*', line }, { v: s[2], line });
      else toks.push({ v: m[2], line });
    } else if (m[3] && m[3].trim()) toks.push({ v: m[3], line });
  }
  return toks;
}

const isNum = (s) => /^(0[xX][0-9a-fA-F]+|\d+)[KkMm]?$/.test(s);
export function parseNumber(s) {
  const m = /^(0[xX][0-9a-fA-F]+|\d+)([KkMm]?)$/.exec(s);
  const n = m[1].startsWith('0x') || m[1].startsWith('0X') ? parseInt(m[1], 16) : parseInt(m[1], 10);
  return n * ({ k: 1024, m: 1048576 }[m[2].toLowerCase()] || 1);
}

export function parseScript(src) {
  const toks = lexScript(src);
  let p = 0;
  const script = { entry: null, memory: [], items: [], symbols: [], errors: [] };
  const peek = (o = 0) => toks[p + o]?.v;
  const next = () => {
    if (p >= toks.length) fail('unexpected end of file');
    return toks[p++].v;
  };
  const fail = (msg) => {
    throw new Error(`linker script line ${toks[Math.min(p, toks.length - 1)]?.line ?? '?'}: ${msg}`);
  };
  const expect = (v) => {
    if (peek() !== v) fail(`expected '${v}' but found '${peek() ?? 'end of file'}'`);
    p++;
  };

  // expression -> AST; stops at tokens that cannot continue an expression
  function expr(minPrec = 0) {
    let left = unary();
    const PREC = { '?': 1, '||': 2, '&&': 3, '|': 4, '^': 5, '&': 6, '==': 7, '!=': 7, '<': 8, '>': 8, '<=': 8, '>=': 8, '<<': 9, '>>': 9, '+': 10, '-': 10, '*': 11, '/': 11, '%': 11 };
    for (;;) {
      const op = peek();
      const pr = PREC[op];
      if (!pr || pr < minPrec) break;
      if (op === '>' && peek(1) === undefined) break;
      p++;
      if (op === '?') {
        const a = expr(0);
        expect(':');
        const b = expr(1);
        left = { t: 'cond', c: left, a, b };
        continue;
      }
      const right = expr(pr + 1);
      left = { t: 'bin', op, l: left, r: right };
    }
    return left;
  }
  function unary() {
    const v = next();
    if (v === undefined) fail('unexpected end of expression');
    if (v === '(') {
      const e = expr(0);
      expect(')');
      return e;
    }
    if (v === '-' || v === '!' || v === '~' || v === '+') return { t: 'un', op: v, e: unary() };
    if (isNum(v)) return { t: 'num', v: parseNumber(v) };
    if (v === '.') return { t: 'dot' };
    if (peek() === '(' && /^[A-Z_]+$/.test(v)) {
      p++;
      const args = [];
      if (peek() !== ')') {
        do args.push(v === 'SIZEOF' || v === 'ADDR' || v === 'LOADADDR' || v === 'ORIGIN' || v === 'LENGTH' || v === 'DEFINED' ? { t: 'name', v: next() } : expr(0));
        while (peek() === ',' && p++ >= 0);
      }
      expect(')');
      return { t: 'call', fn: v, args };
    }
    return { t: 'sym', v };
  }

  const statementTerm = () => {
    if (peek() === ';' || peek() === ',') p++;
  };

  function parseAssignment(name, section) {
    const op = next(); // = += -= ...
    const e = expr(0);
    statementTerm();
    return { kind: 'assign', name, op, e, provide: false };
  }

  function parseInputSpec() {
    // [KEEP(] [SORT(] file ( [EXCLUDE_FILE(x)] sec sec ... ) [)]
    let keep = false;
    if (peek() === 'KEEP') {
      p++;
      expect('(');
      keep = true;
    }
    const specs = [];
    let sort = false;
    const one = () => {
      if (peek() === 'SORT' || peek() === 'SORT_BY_NAME' || peek() === 'SORT_BY_ALIGNMENT') {
        p++;
        expect('(');
        sort = true;
        const r = one();
        expect(')');
        return r;
      }
      let file = next();
      if (file === 'EXCLUDE_FILE') fail('EXCLUDE_FILE before the file name is not supported');
      expect('(');
      const patterns = [];
      let exclude = [];
      while (peek() !== ')') {
        if (peek() === 'EXCLUDE_FILE') {
          p++;
          expect('(');
          while (peek() !== ')') exclude.push(next());
          expect(')');
        } else if (peek() === 'SORT' || peek() === 'SORT_BY_NAME') {
          p++;
          expect('(');
          sort = true;
          patterns.push({ pat: next(), exclude });
          expect(')');
        } else patterns.push({ pat: next(), exclude });
        if (peek() === ',') p++;
      }
      expect(')');
      return { file, patterns };
    };
    const r = one();
    if (keep) expect(')');
    return { kind: 'input', keep, sort, file: r.file, patterns: r.patterns };
  }

  function parseContents(sectionName) {
    const items = [];
    expect('{');
    while (peek() !== '}') {
      if (peek() === undefined) fail('missing } in output section ' + sectionName);
      const v = peek();
      if (v === ';') {
        p++;
        continue;
      }
      if (v === 'PROVIDE' || v === 'PROVIDE_HIDDEN' || v === 'HIDDEN') {
        p++;
        expect('(');
        const name = next();
        const a = parseAssignment(name);
        expect(')');
        statementTerm();
        a.provide = v !== 'HIDDEN';
        items.push(a);
      } else if (v === 'ASSERT') {
        p++;
        expect('(');
        const e = expr(0);
        expect(',');
        const msg = next();
        expect(')');
        statementTerm();
        items.push({ kind: 'assert', e, msg });
      } else if (['BYTE', 'SHORT', 'LONG', 'QUAD'].includes(v)) {
        p++;
        expect('(');
        const e = expr(0);
        expect(')');
        statementTerm();
        items.push({ kind: 'data', size: { BYTE: 1, SHORT: 2, LONG: 4, QUAD: 8 }[v], e });
      } else if (v === 'FILL') {
        p++;
        expect('(');
        expr(0);
        expect(')');
        statementTerm();
      } else if (v === '.' || (peek(1) === '=' || peek(1) === '+=' || peek(1) === '-=') && !['KEEP'].includes(v)) {
        const name = next();
        items.push(parseAssignment(name));
      } else if (v === 'CREATE_OBJECT_SYMBOLS' || v === 'CONSTRUCTORS') {
        p++;
      } else items.push(parseInputSpec());
    }
    expect('}');
    return items;
  }

  function parseSections() {
    expect('{');
    while (peek() !== '}') {
      if (peek() === undefined) fail('missing } at end of SECTIONS');
      const v = peek();
      if (v === ';') {
        p++;
        continue;
      }
      if (v === 'PROVIDE' || v === 'PROVIDE_HIDDEN' || v === 'HIDDEN') {
        p++;
        expect('(');
        const name = next();
        const a = parseAssignment(name);
        expect(')');
        statementTerm();
        a.provide = v !== 'HIDDEN';
        script.items.push(a);
      } else if (v === 'ASSERT') {
        p++;
        expect('(');
        const e = expr(0);
        expect(',');
        const msg = next();
        expect(')');
        statementTerm();
        script.items.push({ kind: 'assert', e, msg });
      } else if (peek(1) === '=' || peek(1) === '+=' || peek(1) === '-=') {
        const name = next();
        script.items.push(parseAssignment(name));
      } else {
        // output section:  name [addr] [(TYPE)] : [AT(lma)] { ... } [>region] [AT>region] [:phdr] [=fill]
        const name = next();
        const sec = { kind: 'section', name, addr: null, noload: false, at: null, region: null, lmaRegion: null, contents: [] };
        while (peek() !== ':') {
          if (peek() === undefined) fail(`missing ':' after output section ${name}`);
          if (peek() === '(') {
            p++;
            const t = next();
            if (t === 'NOLOAD') sec.noload = true;
            expect(')');
          } else sec.addr = expr(0);
        }
        expect(':');
        while (peek() !== '{') {
          if (peek() === undefined) fail(`missing '{' for output section ${name}`);
          const t = next();
          if (t === 'AT') {
            expect('(');
            sec.at = expr(0);
            expect(')');
          } else if (t === 'ALIGN') {
            expect('(');
            sec.alignExpr = expr(0);
            expect(')');
          } else if (t === 'SUBALIGN') {
            expect('(');
            expr(0);
            expect(')');
          } else fail(`unexpected '${t}' in header of output section ${name}`);
        }
        sec.contents = parseContents(name);
        while (peek() !== undefined && peek() !== '}' && !(isSectionStart())) {
          const t = next();
          if (t === '>') sec.region = next();
          else if (t === 'AT' && peek() === '>') {
            p++;
            sec.lmaRegion = next();
          } else if (t === ':') next(); // program header
          else if (t === '=') expr(0);
          else {
            p--;
            break;
          }
        }
        script.items.push(sec);
      }
    }
    expect('}');
  }
  // Heuristic: after '}' of a section, `>` / `AT>` / `:phdr` / `=fill` belong to it; anything else starts a new statement.
  function isSectionStart() {
    const v = peek();
    return !(v === '>' || v === ':' || v === '=' || (v === 'AT' && peek(1) === '>'));
  }

  function parseMemory() {
    expect('{');
    while (peek() !== '}') {
      if (peek() === undefined) fail('missing } in MEMORY');
      const name = next();
      let attrs = '';
      if (peek() === '(') {
        p++;
        while (peek() !== ')') attrs += next();
        p++;
      }
      expect(':');
      let origin = null, length = null;
      for (;;) {
        const k = next().toLowerCase();
        expect('=');
        const e = expr(0);
        if (k === 'org' || k === 'origin' || k === 'o') origin = e;
        else if (k === 'len' || k === 'length' || k === 'l') length = e;
        else fail(`unknown MEMORY attribute '${k}'`);
        if (peek() === ',') p++;
        else break;
      }
      script.memory.push({ name, attrs, origin, length });
    }
    expect('}');
  }

  while (p < toks.length) {
    const v = next();
    if (v === 'ENTRY') {
      expect('(');
      script.entry = next();
      expect(')');
    } else if (v === 'MEMORY') parseMemory();
    else if (v === 'SECTIONS') parseSections();
    else if (v === 'PROVIDE' || v === 'PROVIDE_HIDDEN') {
      expect('(');
      const name = next();
      const a = parseAssignment(name);
      expect(')');
      statementTerm();
      a.provide = true;
      script.symbols.push(a);
    } else if (v === 'ASSERT') {
      p--;
      p++;
      expect('(');
      const e = expr(0);
      expect(',');
      const msg = next();
      expect(')');
      statementTerm();
      script.symbols.push({ kind: 'assert', e, msg });
    } else if (['OUTPUT_FORMAT', 'OUTPUT_ARCH', 'SEARCH_DIR', 'INPUT', 'GROUP', 'STARTUP', 'EXTERN', 'NOCROSSREFS', 'OUTPUT', 'PHDRS', 'VERSION', 'REGION_ALIAS'].includes(v)) {
      // skipped statements: balanced ( ) or { }
      const open = peek();
      if (open === '(' || open === '{') {
        const close = open === '(' ? ')' : '}';
        let depth = 0;
        do {
          const t = next();
          if (t === open) depth++;
          else if (t === close) depth--;
        } while (depth > 0 && p < toks.length);
      }
      statementTerm();
    } else if (peek() === '=' || peek() === '+=' || peek() === '-=') {
      script.symbols.push(parseAssignment(v));
    } else if (v === ';') {
      /* empty */
    } else fail(`unexpected '${v}'`);
  }
  return script;
}

export function evalExpr(e, ctx) {
  const E = (x) => evalExpr(x, ctx);
  switch (e.t) {
    case 'num':
      return e.v;
    case 'dot':
      return ctx.dot ?? 0;
    case 'sym':
      return ctx.symbol(e.v);
    case 'un': {
      const v = E(e.e);
      return e.op === '-' ? -v : e.op === '!' ? +!v : e.op === '~' ? ~v >>> 0 : v;
    }
    case 'cond':
      return E(e.c) ? E(e.a) : E(e.b);
    case 'bin': {
      const l = E(e.l), r = E(e.r);
      switch (e.op) {
        case '+': return l + r;
        case '-': return l - r;
        case '*': return l * r;
        case '/': return r ? Math.trunc(l / r) : 0;
        case '%': return r ? l % r : 0;
        case '<<': return l * 2 ** r;
        case '>>': return Math.floor(l / 2 ** r);
        case '&': return Number(BigInt(l) & BigInt(r));
        case '|': return Number(BigInt(l) | BigInt(r));
        case '^': return Number(BigInt(l) ^ BigInt(r));
        case '&&': return +(l && r);
        case '||': return +(l || r);
        case '==': return +(l === r);
        case '!=': return +(l !== r);
        case '<': return +(l < r);
        case '>': return +(l > r);
        case '<=': return +(l <= r);
        case '>=': return +(l >= r);
      }
      return 0;
    }
    case 'call': {
      const a = e.args;
      switch (e.fn) {
        case 'ALIGN': {
          const [x, y] = a.map(E);
          const [v, al] = a.length === 1 ? [ctx.dot ?? 0, x] : [x, y];
          return al > 0 ? Math.ceil(v / al) * al : v;
        }
        case 'ORIGIN': return ctx.region(a[0].v, 'origin');
        case 'LENGTH': return ctx.region(a[0].v, 'length');
        case 'ADDR': return ctx.section(a[0].v, 'vma');
        case 'LOADADDR': return ctx.section(a[0].v, 'lma');
        case 'SIZEOF': return ctx.section(a[0].v, 'size');
        case 'DEFINED': return +ctx.defined(a[0].v);
        case 'MAX': return Math.max(...a.map(E));
        case 'MIN': return Math.min(...a.map(E));
        case 'ABSOLUTE': return E(a[0]);
        case 'SEGMENT_START': return E(a[1]);
        default: throw new Error(`unsupported linker script function ${e.fn}()`);
      }
    }
    default:
      return 0;
  }
}

export function globToRegExp(glob) {
  const esc = glob.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp('^' + esc + '$');
}
