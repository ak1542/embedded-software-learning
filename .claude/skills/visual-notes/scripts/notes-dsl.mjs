// Helpers that build the site's page format (ProseMirror JSON) from plain JavaScript.
// A spec file imports these and exports `default { sections: [...] }`; see ../references/site-format.md.

const text = (t, marks) => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });

// Inline markup inside any string: `code`, **bold**, [label](https://link) or [label](#/page-id).
export function inline(str) {
  if (!str) return [];
  const out = [];
  for (const part of String(str).split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/).filter(Boolean)) {
    let m;
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) out.push(text(part.slice(1, -1), [{ type: 'code' }]));
    else if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) out.push(text(part.slice(2, -2), [{ type: 'bold' }]));
    else if ((m = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/))) {
      const internal = m[2].startsWith('#');
      out.push(text(m[1], [{ type: 'link', attrs: { href: m[2], target: internal ? null : '_blank', rel: internal ? null : 'noopener noreferrer nofollow', class: null } }]));
    } else out.push(text(part));
  }
  return out;
}

export const P = (s = '') => (s ? { type: 'paragraph', content: inline(s) } : { type: 'paragraph' });
export const H = (level, s) => ({ type: 'heading', attrs: { level }, content: inline(s) });
const li = (item) => {
  const [s, sub] = Array.isArray(item) ? item : [item, null];
  return { type: 'listItem', content: [P(s), ...(sub ? [UL(sub)] : [])] };
};
export const UL = (items) => ({ type: 'bulletList', content: items.map(li) });
export const OL = (items) => ({ type: 'orderedList', attrs: { start: 1 }, content: items.map(li) });
export const TASKLIST = (items) => ({
  type: 'taskList',
  content: items.map((s) => ({ type: 'taskItem', attrs: { checked: false }, content: [P(s)] })),
});
const cell = (type, s) => ({ type, attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [P(s)] });
export const TABLE = (head, rows) => ({
  type: 'table',
  content: [
    { type: 'tableRow', content: head.map((h) => cell('tableHeader', h)) },
    ...rows.map((r) => ({ type: 'tableRow', content: r.map((c) => cell('tableCell', c)) })),
  ],
});
export const CODE = (language, src) => ({ type: 'codeBlock', attrs: { language }, content: [text(src)] });
// variant: info | tip | warning | danger
export const CALLOUT = (variant, ...paras) => ({ type: 'callout', attrs: { variant }, content: paras.map((p) => (typeof p === 'string' ? P(p) : p)) });
// file: name of an animation in content/media/animations (without .html); height: first guess in px (the frame fits itself).
export const ANIM = (file, height, title) => ({ type: 'htmlAnimation', attrs: { src: `content/media/animations/${file}.html`, height, width: 100, title, fit: true } });
export const DIAGRAM = (mermaid) => ({ type: 'diagram', attrs: { code: mermaid } });
export const IMAGE = (src, alt = '', width = null) => ({ type: 'image', attrs: { src, alt, width, align: 'center' } });
export const PDF = (src, title = 'PDF document', height = 600) => ({ type: 'pdf', attrs: { src, title, height } });
export const HR = () => ({ type: 'horizontalRule' });
export const doc = (...nodes) => ({ type: 'doc', content: [...nodes, P()] });

// A page: S('s-i2c-basics', 'I2C basics', [nodes...], [childPages...])
export const S = (id, title, nodes, children = []) => ({ id, title, doc: doc(...nodes), children });

export const ids = (sections) => {
  const out = [];
  (function walk(list) { for (const s of list) { out.push(s.id); walk(s.children || []); } })(sections);
  return out;
};

// Put `sections` into a notebook object. Existing pages are never touched unless `update` is set
// and the id matches. `parent` (an existing page id) makes them subsections of that page.
export function mergeSections(nb, sections, { parent = null, update = false } = {}) {
  const mine = new Set(ids(sections));
  const existing = new Set();
  (function walk(list) { for (const s of list) { existing.add(s.id); walk(s.children || []); } })(nb.sections);
  const clash = [...mine].filter((id) => existing.has(id));
  if (clash.length && !update) {
    throw new Error(`These page ids already exist: ${clash.join(', ')}. Use --update only after the user approved replacing them.`);
  }
  if (update) {
    const strip = (list) => list.filter((s) => !mine.has(s.id)).map((s) => ({ ...s, children: strip(s.children || []) }));
    nb.sections = strip(nb.sections);
  }
  if (parent) {
    let target = null;
    (function walk(list) { for (const s of list) { if (s.id === parent) target = s; walk(s.children || []); } })(nb.sections);
    if (!target) throw new Error(`Parent page "${parent}" not found.`);
    target.children.push(...sections);
  } else nb.sections.push(...sections);
  return nb;
}
