// Tokenizer shared by the preprocessor-free parts of the build simulator (C / C++ subset).

const PUNCT = ['...', '<<=', '>>=', '->*', '::', '->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '.*'];

export function stripComments(src) {
  let out = '';
  for (let i = 0; i < src.length; ) {
    const c = src[i], d = src[i + 1];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && d === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ').replace(/^ /, ' ');
      i = stop;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// Tokens: { t: 'id'|'num'|'str'|'chr'|'p', v: text }
export function tokenize(src) {
  const toks = [];
  const re = /\s+|([A-Za-z_$][A-Za-z0-9_$]*)|(0[xX][0-9a-fA-F]+[uUlL]*|0[bB][01]+[uUlL]*|\d+\.?\d*(?:[eE][+-]?\d+)?[uUlLfF]*|\.\d+(?:[eE][+-]?\d+)?[fF]?)|(L?u8?"(?:\\.|[^"\\])*"|L?"(?:\\.|[^"\\])*")|('(?:\\.|[^'\\])+')|(.)/gy;
  let m;
  while ((m = re.exec(src))) {
    if (m[1]) toks.push({ t: 'id', v: m[1] });
    else if (m[2]) toks.push({ t: 'num', v: m[2] });
    else if (m[3]) toks.push({ t: 'str', v: m[3] });
    else if (m[4]) toks.push({ t: 'chr', v: m[4] });
    else if (m[5]) {
      let v = m[5];
      const rest = src.slice(re.lastIndex - 1, re.lastIndex + 2);
      const multi = PUNCT.find((p) => rest.startsWith(p));
      if (multi) {
        v = multi;
        re.lastIndex += multi.length - 1;
      }
      toks.push({ t: 'p', v });
    }
  }
  return toks;
}

export function numValue(text) {
  const t = text.replace(/[uUlL]+$/, '');
  if (/^0[xX]/.test(t)) return parseInt(t, 16);
  if (/^0[bB]/.test(t)) return parseInt(t.slice(2), 2);
  if (/^0\d+$/.test(t)) return parseInt(t, 8);
  return Number(t.replace(/[fF]$/, ''));
}

// Decoded byte values of a string literal (without terminating NUL).
export function stringBytes(lit) {
  const body = lit.slice(lit.indexOf('"') + 1, -1);
  const out = [];
  const map = { n: 10, t: 9, r: 13, '0': 0, a: 7, b: 8, f: 12, v: 11, '\\': 92, '"': 34, "'": 39 };
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '\\') {
      out.push(body.charCodeAt(i) & 255);
      continue;
    }
    const n = body[++i];
    if (n === 'x') {
      const m = /^[0-9a-fA-F]{1,2}/.exec(body.slice(i + 1));
      out.push(parseInt(m[0], 16));
      i += m[0].length;
    } else if (/[0-7]/.test(n)) {
      const m = /^[0-7]{1,3}/.exec(body.slice(i));
      out.push(parseInt(m[0], 8) & 255);
      i += m[0].length - 1;
    } else out.push(map[n] ?? n.charCodeAt(0));
  }
  return out;
}

export const charValue = (lit) => stringBytes('"' + lit.slice(1, -1) + '"')[0] ?? 0;

export const hex = (n, w = 8) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(w, '0');
