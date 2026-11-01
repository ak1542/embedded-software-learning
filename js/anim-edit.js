// A visual editor for an animation's HTML file: no code needed.
//  * "Texts": every piece of visible text in the page's HTML (titles, labels, captions).
//  * "Content": the DATA object that the template animations (quiz, flashcards, stepper, ...) are built from.
// Both read the file as plain text. Nothing from the file is ever run here: the file's own scripts only
// run in the sandboxed preview frame.
import { h } from './dom.js';

/* ---------- texts ---------- */

const decode = (s) => new DOMParser().parseFromString(`<!doctype html><body>${s}`, 'text/html').body.textContent;
const encode = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Split the HTML into tokens without losing a single character: tags, comments, scripts and styles are kept as they are.
export function tokenize(src) {
  const re = /<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script\s*>|<style\b[\s\S]*?<\/style\s*>|<[^>]+>|[^<]+/gi;
  const tokens = [];
  let tag = '';
  for (const m of src.matchAll(re)) {
    const t = m[0];
    if (t[0] === '<') {
      const open = /^<([a-z][a-z0-9-]*)/i.exec(t);
      if (open) tag = open[1].toLowerCase();
      tokens.push({ raw: t });
    } else tokens.push({ raw: t, text: true, tag });
  }
  return tokens;
}

export function listTexts(src) {
  const out = [];
  tokenize(src).forEach((t, i) => {
    if (!t.text || !t.raw.trim()) return;
    const value = decode(t.raw.trim());
    if (!value.trim()) return;
    out.push({ index: i, tag: t.tag, value });
  });
  return out;
}

export function setText(src, index, value) {
  const tokens = tokenize(src);
  const t = tokens[index];
  if (!t || !t.text) return src;
  const lead = /^\s*/.exec(t.raw)[0];
  const trail = /\s*$/.exec(t.raw)[0];
  tokens[index] = { raw: lead + encode(value) + trail };
  return tokens.map((x) => x.raw).join('');
}

/* ---------- DATA object (a tolerant reader for JavaScript object literals) ---------- */

function parseLiteral(s, start) {
  let i = start;
  const ws = () => {
    for (;;) {
      while (i < s.length && /\s/.test(s[i])) i++;
      if (s.startsWith('//', i)) while (i < s.length && s[i] !== '\n') i++;
      else if (s.startsWith('/*', i)) i = s.indexOf('*/', i) + 2 || s.length;
      else return;
    }
  };
  const str = () => {
    const q = s[i++];
    let out = '';
    while (i < s.length && s[i] !== q) {
      if (s[i] === '\\') {
        const n = s[++i];
        out += { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' }[n] ?? (n === 'u' ? String.fromCharCode(parseInt(s.slice(i + 1, i + 5), 16)) : n);
        if (n === 'u') i += 4;
        i++;
      } else {
        if (q === '`' && s[i] === '$' && s[i + 1] === '{') throw new Error('template');
        out += s[i++];
      }
    }
    i++;
    return out;
  };
  const value = () => {
    ws();
    const c = s[i];
    if (c === '{') {
      i++;
      const o = {};
      for (;;) {
        ws();
        if (s[i] === '}') {
          i++;
          return o;
        }
        let key;
        if (/['"]/.test(s[i])) key = str();
        else {
          const m = /^[A-Za-z_$][\w$]*/.exec(s.slice(i));
          if (!m) throw new Error('key');
          key = m[0];
          i += key.length;
        }
        ws();
        if (s[i] !== ':') throw new Error('colon');
        i++;
        o[key] = value();
        ws();
        if (s[i] === ',') i++;
      }
    }
    if (c === '[') {
      i++;
      const a = [];
      for (;;) {
        ws();
        if (s[i] === ']') {
          i++;
          return a;
        }
        a.push(value());
        ws();
        if (s[i] === ',') i++;
      }
    }
    if (c === '"' || c === "'" || c === '`') return str();
    const m = /^(-?\d+\.?\d*(?:[eE][+-]?\d+)?|0[xX][0-9a-fA-F]+|true|false|null)/.exec(s.slice(i));
    if (!m) throw new Error('value');
    i += m[0].length;
    return m[0] === 'true' ? true : m[0] === 'false' ? false : m[0] === 'null' ? null : Number(m[0]);
  };
  const v = value();
  return { value: v, end: i };
}

export function findData(src) {
  const m = /\bconst\s+DATA\s*=\s*/.exec(src);
  if (!m) return null;
  try {
    const { value, end } = parseLiteral(src, m.index + m[0].length);
    if (!value || typeof value !== 'object') return null;
    return { value, start: m.index + m[0].length, end };
  } catch {
    return null;
  }
}

export function setData(src, value) {
  const found = findData(src);
  if (!found) return src;
  return src.slice(0, found.start) + JSON.stringify(value, null, 1) + src.slice(found.end);
}

/* ---------- the form ---------- */

const pretty = (k) => String(k).replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

function field(label, input) {
  return h('label', { class: 'ae-field' }, h('span', {}, label), input);
}

function renderValue(label, value, set, remove) {
  if (typeof value === 'string') {
    const long = value.length > 60 || value.includes('\n');
    const el = long
      ? h('textarea', { rows: Math.min(6, Math.max(2, Math.ceil(value.length / 70))), oninput: (e) => set(e.target.value) })
      : h('input', { type: 'text', oninput: (e) => set(e.target.value) });
    el.value = value;
    return field(label, el);
  }
  if (typeof value === 'number') return field(label, h('input', { type: 'number', value: String(value), oninput: (e) => set(Number(e.target.value)) }));
  if (typeof value === 'boolean') return field(label, h('input', { type: 'checkbox', checked: value, onchange: (e) => set(e.target.checked) }));
  if (Array.isArray(value)) {
    const wrap = h('fieldset', { class: 'ae-group' }, h('legend', {}, `${label} (${value.length})`));
    const draw = () => {
      wrap.querySelectorAll('.ae-item').forEach((n) => n.remove());
      value.forEach((item, i) => {
        const box = h('div', { class: 'ae-item' });
        const head = h('div', { class: 'ae-item-head' }, h('b', {}, `${i + 1}`),
          h('button', { type: 'button', class: 'btn', title: 'Move up', disabled: i === 0, onclick: () => { [value[i - 1], value[i]] = [value[i], value[i - 1]]; draw(); set(value); } }, '↑'),
          h('button', { type: 'button', class: 'btn', title: 'Remove this item', onclick: () => { value.splice(i, 1); draw(); set(value); wrap.querySelector('legend').textContent = `${label} (${value.length})`; } }, '✕'));
        box.append(head, renderValue('', item, (v) => { value[i] = v; set(value); }));
        wrap.append(box);
      });
    };
    draw();
    if (value.length && typeof value[value.length - 1] !== 'object') {
      wrap.append(h('button', { type: 'button', class: 'btn', onclick: () => { value.push(typeof value[value.length - 1] === 'number' ? 0 : ''); draw(); set(value); wrap.querySelector('legend').textContent = `${label} (${value.length})`; } }, '+ Add'));
    } else if (value.length) {
      wrap.append(h('button', { type: 'button', class: 'btn', title: 'Add a copy of the last item', onclick: () => { value.push(structuredClone(value[value.length - 1])); draw(); set(value); wrap.querySelector('legend').textContent = `${label} (${value.length})`; } }, '+ Add a copy of the last one'));
    }
    return wrap;
  }
  if (value && typeof value === 'object') {
    const wrap = h('div', { class: label ? 'ae-group' : '' });
    for (const k of Object.keys(value)) {
      wrap.append(renderValue(pretty(k), value[k], (v) => { value[k] = v; set(value); }));
    }
    return wrap;
  }
  return h('span', {}, String(value));
}

// Builds the visual editor into `host`. getSource()/setSource() read and write the whole HTML text.
export function buildVisualEditor(host, getSource, setSource) {
  host.replaceChildren();
  const src = getSource();
  const data = findData(src);
  const texts = listTexts(src);

  if (data) {
    const live = structuredClone(data.value);
    host.append(h('h3', {}, 'Content'), h('p', { class: 'muted' }, 'The questions, labels and steps this animation is built from. Change them here.'));
    host.append(renderValue('', live, () => setSource(setData(getSource(), live))));
  }
  if (texts.length) {
    host.append(h('h3', {}, data ? 'Other texts in the page' : 'Texts in the page'));
    host.append(h('p', { class: 'muted' }, 'Titles, labels and captions of the page itself. Texts that the animation creates while it runs (for example from the Content above or from its script) are not listed.'));
    for (const t of texts) {
      const el = t.value.length > 70 || t.value.includes('\n') ? h('textarea', { rows: Math.min(5, Math.ceil(t.value.length / 70)) }) : h('input', { type: 'text' });
      el.value = t.value;
      el.addEventListener('input', () => setSource(setText(getSource(), t.index, el.value)));
      host.append(field(`<${t.tag || 'text'}>`, el));
    }
  }
  if (!data && !texts.length) host.append(h('p', { class: 'muted' }, 'No editable text was found. Use the HTML tab.'));
}
