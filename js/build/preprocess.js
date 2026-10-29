// A small C preprocessor: comments, #include "user files", #define (object and function-like),
// conditionals, #error. Produces text like `gcc -E` (a .i file) plus diagnostics.
import { stripComments, numValue, charValue } from './lex.js';

const BUILTIN_HEADERS = {
  'stdint.h': 'typedef signed char int8_t;\ntypedef unsigned char uint8_t;\ntypedef short int16_t;\ntypedef unsigned short uint16_t;\ntypedef int int32_t;\ntypedef unsigned int uint32_t;\ntypedef long long int64_t;\ntypedef unsigned long long uint64_t;\ntypedef int intptr_t;\ntypedef unsigned int uintptr_t;',
  'stddef.h': 'typedef unsigned int size_t;\ntypedef int ptrdiff_t;\n#define NULL ((void*)0)',
  'stdbool.h': '#ifndef __cplusplus\n#define bool _Bool\n#define true 1\n#define false 0\n#endif',
  'cstdint': 'typedef signed char int8_t;\ntypedef unsigned char uint8_t;\ntypedef short int16_t;\ntypedef unsigned short uint16_t;\ntypedef int int32_t;\ntypedef unsigned int uint32_t;\ntypedef long long int64_t;\ntypedef unsigned long long uint64_t;',
  'cstddef': 'typedef unsigned int size_t;',
};

class Cond {
  constructor(parentActive) {
    this.parentActive = parentActive;
    this.taken = false;
    this.active = false;
  }
}

function splitArgs(text, start) {
  // text[start] === '('; returns { args, end } where end is the index after ')'
  let depth = 0, cur = '', args = [];
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === '\\' ? 2 : 1;
      cur += text.slice(i, j + 1);
      i = j;
      continue;
    }
    if (c === '(') {
      if (depth++ === 0) continue;
    } else if (c === ')') {
      if (--depth === 0) {
        args.push(cur.trim());
        return { args, end: i + 1 };
      }
    } else if (c === ',' && depth === 1) {
      args.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  return null;
}

function expand(text, macros, hide = new Set(), depth = 0) {
  if (depth > 40) return text;
  let out = '';
  const re = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_$][A-Za-z0-9_$]*|\d[\w.]*|[\s\S]/gy;
  let m;
  while ((m = re.exec(text))) {
    const tok = m[0];
    const mac = /^[A-Za-z_$]/.test(tok) && !hide.has(tok) ? macros.get(tok) : null;
    if (!mac) {
      out += tok;
      continue;
    }
    if (!mac.params) {
      out += expand(mac.body, macros, new Set([...hide, tok]), depth + 1);
      continue;
    }
    let j = re.lastIndex;
    while (/\s/.test(text[j] || '')) j++;
    if (text[j] !== '(') {
      out += tok;
      continue;
    }
    const call = splitArgs(text, j);
    if (!call) {
      out += tok;
      continue;
    }
    re.lastIndex = call.end;
    const argv = call.args.length === 1 && call.args[0] === '' && mac.params.length === 0 ? [] : call.args;
    let body = mac.body.replace(/#\s*([A-Za-z_]\w*)/g, (all, p) => {
      const k = mac.params.indexOf(p);
      return k >= 0 ? JSON.stringify(argv[k] ?? '') : all;
    });
    body = body.replace(/\b[A-Za-z_]\w*\b/g, (id) => {
      const k = mac.params.indexOf(id);
      if (k >= 0) return expand(argv[k] ?? '', macros, hide, depth + 1);
      if (id === '__VA_ARGS__' && mac.variadic) return argv.slice(mac.params.length).join(', ');
      return id;
    });
    body = body.replace(/\s*##\s*/g, '');
    out += expand(body, macros, new Set([...hide, tok]), depth + 1);
  }
  return out;
}

function evalCondition(expr, macros) {
  let e = expr.replace(/defined\s*\(\s*([A-Za-z_]\w*)\s*\)|defined\s+([A-Za-z_]\w*)/g, (_, a, b) => (macros.has(a || b) ? '1' : '0'));
  e = expand(e, macros);
  const toks = e.match(/0[xX][0-9a-fA-F]+[uUlL]*|\d+[uUlL]*|'(?:\\.|[^'\\])'|[A-Za-z_]\w*|<<|>>|<=|>=|==|!=|&&|\|\||[-+*/%()!~<>&|^?:]/g) || [];
  let p = 0;
  const peek = () => toks[p];
  const eat = () => toks[p++];
  const prim = () => {
    const t = eat();
    if (t === undefined) return 0;
    if (t === '(') {
      const v = ternary();
      eat();
      return v;
    }
    if (t === '!') return prim() ? 0 : 1;
    if (t === '-') return -prim();
    if (t === '+') return prim();
    if (t === '~') return ~prim();
    if (t[0] === "'") return charValue(t);
    if (/^\d/.test(t)) return numValue(t);
    return 0; // unknown identifier
  };
  const bin = (next, ops) => () => {
    let l = next();
    while (ops.includes(peek())) {
      const o = eat(), r = next();
      l = { '*': l * r, '/': r ? Math.trunc(l / r) : 0, '%': r ? l % r : 0, '+': l + r, '-': l - r, '<<': l << r, '>>': l >> r, '<': +(l < r), '>': +(l > r), '<=': +(l <= r), '>=': +(l >= r), '==': +(l === r), '!=': +(l !== r), '&': l & r, '^': l ^ r, '|': l | r, '&&': +(l && r), '||': +(l || r) }[o];
    }
    return l;
  };
  const mul = bin(prim, ['*', '/', '%']);
  const add = bin(mul, ['+', '-']);
  const sh = bin(add, ['<<', '>>']);
  const rel = bin(sh, ['<', '>', '<=', '>=']);
  const eq = bin(rel, ['==', '!=']);
  const band = bin(eq, ['&']);
  const bxor = bin(band, ['^']);
  const bor = bin(bxor, ['|']);
  const land = bin(bor, ['&&']);
  const lor = bin(land, ['||']);
  function ternary() {
    const c = lor();
    if (peek() === '?') {
      eat();
      const a = ternary();
      eat();
      const b = ternary();
      return c ? a : b;
    }
    return c;
  }
  return !!ternary();
}

// files: { name: text }. Returns { text, includes, macros, diagnostics }
export function preprocess(files, main, { defines = {}, cpp = false } = {}) {
  const macros = new Map();
  const diagnostics = [];
  const includes = [];
  const once = new Set();
  macros.set('__STDC__', { body: '1' });
  macros.set('__GNUC__', { body: '12' });
  macros.set('__arm__', { body: '1' });
  macros.set('__thumb__', { body: '1' });
  if (cpp) macros.set('__cplusplus', { body: '201703L' });
  for (const [k, v] of Object.entries(defines)) macros.set(k, { body: String(v) });

  const out = [];
  const run = (name, text, depth) => {
    if (depth > 24) return diagnostics.push({ level: 'error', file: name, msg: 'include nested too deeply' });
    out.push(`# 1 "${name}"`);
    const lines = stripComments(text).replace(/\\\r?\n/g, '').split('\n');
    const stack = [];
    const active = () => stack.every((c) => c.active);
    lines.forEach((raw, idx) => {
      const line = raw.trim();
      const m = /^#\s*(\w+)\s*(.*)$/.exec(line);
      if (!m) {
        out.push(active() ? expand(raw, macros) : '');
        return;
      }
      const [, dir, rest] = m;
      const top = stack[stack.length - 1];
      const here = () => stack.slice(0, -1).every((c) => c.active);
      if (dir === 'if' || dir === 'ifdef' || dir === 'ifndef') {
        const c = new Cond(active());
        if (c.parentActive) {
          const v = dir === 'if' ? evalCondition(rest, macros) : macros.has(rest.trim().split(/\s/)[0]) === (dir === 'ifdef');
          c.active = v;
          c.taken = v;
        }
        stack.push(c);
      } else if (dir === 'elif' && top) {
        top.active = top.parentActive && !top.taken && evalCondition(rest, macros);
        top.taken ||= top.active;
      } else if (dir === 'else' && top) {
        top.active = top.parentActive && !top.taken;
        top.taken = true;
      } else if (dir === 'endif') stack.pop();
      else if (!active()) {
        /* skipped region */
      } else if (dir === 'define') {
        const d = /^([A-Za-z_]\w*)(\(([^)]*)\))?\s*(.*)$/.exec(rest);
        if (d) {
          const params = d[2] ? d[3].split(',').map((s) => s.trim()).filter(Boolean) : null;
          const variadic = !!params && params[params.length - 1] === '...';
          if (variadic) params.pop();
          macros.set(d[1], { params, variadic, body: d[4].trim() });
        }
      } else if (dir === 'undef') macros.delete(rest.trim());
      else if (dir === 'include') {
        const q = /^"([^"]+)"|^<([^>]+)>/.exec(rest.trim());
        if (!q) return;
        const file = q[1] || q[2];
        const base = file.split('/').pop();
        includes.push(file);
        if (once.has(base)) return;
        const user = q[1] && (files[file] ?? files[base]);
        if (user !== undefined) run(files[file] !== undefined ? file : base, user, depth + 1);
        else if (BUILTIN_HEADERS[base]) run(`<${base}>`, BUILTIN_HEADERS[base], depth + 1);
        else {
          out.push(`/* <${file}>: system header not available in the simulator (declarations omitted) */`);
          diagnostics.push({ level: 'note', file: name, line: idx + 1, msg: `${file} is a system header and is not expanded here; only your own headers and stdint/stddef/stdbool are.` });
        }
        out.push(`# ${idx + 2} "${name}"`);
      } else if (dir === 'pragma') {
        if (/^once\b/.test(rest)) once.add(name);
        else out.push(line);
      } else if (dir === 'error') diagnostics.push({ level: 'error', file: name, line: idx + 1, msg: `#error ${rest}` });
      else if (dir === 'warning') diagnostics.push({ level: 'warning', file: name, line: idx + 1, msg: `#warning ${rest}` });
    });
  };
  run(main, files[main] ?? '', 0);
  return { text: out.join('\n'), includes, macros, diagnostics };
}
