// Notebook data format and its upgrade path.
//
// Notes are stored as plain data (sections -> a rich-text document), never as rendered
// HTML. A section's `doc` is a ProseMirror/Tiptap JSON document: headings, paragraphs,
// lists, tables, images and so on, with formatting kept as structure. The site renders
// that data every time a page is opened, so any change to the editor, its styling or a
// block's look applies to every old note too. When the stored shape itself has to change,
// bump SCHEMA_VERSION and add a migration below: old notebooks are upgraded when they load.

export const SCHEMA_VERSION = 2;

export const DEFAULT_SETTINGS = {
  title: 'Embedded Software Notes',
  theme: 'auto', // auto | light | dark
  fontSize: 16,
  contentWidth: 'normal', // narrow | normal | wide
  codeWrap: false,
};

export const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };

// MIGRATIONS[n] upgrades a notebook from version n - 1 to version n, in place.
const MIGRATIONS = {
  // v0 -> v1: early drafts kept a section's body as one markdown string in `content`.
  1(nb) {
    walk(nb.sections || [], (node) => {
      if (typeof node.content === 'string') {
        node.blocks = node.blocks || [];
        if (node.content.trim()) node.blocks.unshift({ type: 'text', data: { md: node.content } });
        delete node.content;
      }
    });
  },
  // v1 -> v2: pages were lists of typed blocks; they are now one rich-text document.
  2(nb) {
    walk(nb.sections || [], (node) => {
      if (!node.doc) node.doc = blocksToDoc(node.blocks);
      delete node.blocks;
    });
  },
};

export function migrate(raw) {
  const nb = structuredClone(raw && typeof raw === 'object' ? raw : {});
  let version = Number.isInteger(nb.schemaVersion) ? nb.schemaVersion : 0;
  if (version > SCHEMA_VERSION) {
    throw new Error(
      `These notes use format v${version}, but this copy of the site only understands up to v${SCHEMA_VERSION}. ` +
        'Hard-reload the page to get the latest site.'
    );
  }
  while (version < SCHEMA_VERSION) {
    version += 1;
    MIGRATIONS[version](nb);
  }
  nb.schemaVersion = SCHEMA_VERSION;
  return normalize(nb);
}

// Fill in anything missing without dropping fields we don't know about, so data
// written by a newer site version survives a round trip through an older one.
export function normalize(nb) {
  nb.settings = { ...DEFAULT_SETTINGS, ...(nb.settings || {}) };
  nb.sections = (Array.isArray(nb.sections) ? nb.sections : []).map(normalizeNode);
  return nb;
}

function normalizeNode(node) {
  return {
    ...node,
    id: node.id || newId('s'),
    title: typeof node.title === 'string' ? node.title : 'Untitled',
    doc: node.doc && node.doc.type === 'doc' ? node.doc : structuredClone(EMPTY_DOC),
    children: (Array.isArray(node.children) ? node.children : []).map(normalizeNode),
  };
}

export function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function walk(nodes, fn, parents = []) {
  for (const node of nodes) {
    fn(node, parents);
    walk(node.children || [], fn, [...parents, node]);
  }
}

/* ---------- conversion of the old block format (best effort) ---------- */

const text = (t, marks) => (t ? [{ type: 'text', text: t, ...(marks ? { marks } : {}) }] : []);
const paragraph = (t) => ({ type: 'paragraph', ...(t ? { content: text(t) } : {}) });

// A small markdown reader: headings, fenced code, lists and paragraphs. Inline
// formatting such as **bold** is kept as typed.
function markdownToNodes(md) {
  const out = [];
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  let para = [];
  const flush = () => {
    if (para.length) out.push(paragraph(para.join(' ')));
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^\s*```\s*(\S*)/);
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (fence) {
      flush();
      const code = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
      out.push({ type: 'codeBlock', attrs: { language: fence[1] || 'plaintext' }, content: text(code.join('\n')) });
    } else if (heading) {
      flush();
      out.push({ type: 'heading', attrs: { level: heading[1].length }, content: text(heading[2]) });
    } else if (bullet || numbered) {
      flush();
      const kind = bullet ? 'bulletList' : 'orderedList';
      const items = [];
      for (; i < lines.length; i++) {
        const m = bullet ? lines[i].match(/^\s*[-*]\s+(.*)$/) : lines[i].match(/^\s*\d+[.)]\s+(.*)$/);
        if (!m) break;
        items.push({ type: 'listItem', content: [paragraph(m[1])] });
      }
      i--;
      out.push({ type: kind, content: items });
    } else if (!line.trim()) {
      flush();
    } else {
      para.push(line.trim());
    }
  }
  flush();
  return out;
}

const SIZE_TO_WIDTH = { small: 25, medium: 50, large: 100, full: 100 };

function blockToNodes(block) {
  const d = block.data || {};
  switch (block.type) {
    case 'text':
      return markdownToNodes(d.md);
    case 'heading':
      return [{ type: 'heading', attrs: { level: Math.min(4, Math.max(1, Number(d.level) || 2)) }, content: text(d.text) }];
    case 'code':
      return [{ type: 'codeBlock', attrs: { language: d.lang || 'plaintext' }, content: text(d.code) }, ...(d.caption ? [paragraph(d.caption)] : [])];
    case 'image':
    case 'animation': {
      if (!d.src) return [];
      const isVideo = /^data:video\//.test(d.src) || /\.(mp4|webm|ogv|ogg|mov|m4v)([?#]|$)/i.test(d.src);
      const media = { type: isVideo ? 'video' : 'image', attrs: { src: d.src, alt: d.alt || '', width: SIZE_TO_WIDTH[d.size] ?? null, ...(isVideo ? { loop: Boolean(d.autoplay) } : {}) } };
      return [media, ...(d.caption ? [paragraph(d.caption)] : [])];
    }
    case 'steps':
      return (d.frames || []).length
        ? [{ type: 'bulletList', content: d.frames.map((f) => ({ type: 'listItem', content: [paragraph(f.caption || '')] })) }]
        : [];
    case 'callout': {
      const inner = [...(d.title ? [{ type: 'paragraph', content: text(d.title, [{ type: 'bold' }]) }] : []), ...markdownToNodes(d.md)];
      return [{ type: 'callout', attrs: { variant: d.variant || 'info' }, content: inner.length ? inner : [paragraph('')] }];
    }
    case 'diagram':
      return [{ type: 'diagram', attrs: { code: d.code || '' } }, ...(d.caption ? [paragraph(d.caption)] : [])];
    case 'embed':
      return d.url ? [{ type: 'embed', attrs: { url: d.url } }] : [];
    case 'divider':
      return [{ type: 'horizontalRule' }];
    default:
      // Unknown block types are kept as readable data instead of being thrown away.
      return [{ type: 'codeBlock', attrs: { language: 'json' }, content: text(JSON.stringify(block, null, 2)) }];
  }
}

export function blocksToDoc(blocks) {
  const content = (Array.isArray(blocks) ? blocks : []).flatMap(blockToNodes);
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}
