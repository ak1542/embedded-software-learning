// Notebook data format and its upgrade path.
//
// Notes are stored as plain data (sections -> blocks -> data), never as rendered
// HTML. The site renders that data every time a page is opened, so any change to
// a renderer, an editor or a block's defaults applies to every old note too.
// When the stored shape itself has to change, bump SCHEMA_VERSION and add a
// migration below: old notebooks are upgraded automatically when they load.

export const SCHEMA_VERSION = 1;

export const DEFAULT_SETTINGS = {
  title: 'Embedded Software Notes',
  theme: 'auto', // auto | light | dark
  fontSize: 16,
  contentWidth: 'normal', // narrow | normal | wide
  animateBlocks: true,
  codeLineNumbers: true,
  codeWrap: false,
};

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
    blocks: (Array.isArray(node.blocks) ? node.blocks : []).map(normalizeBlock),
    children: (Array.isArray(node.children) ? node.children : []).map(normalizeNode),
  };
}

function normalizeBlock(block) {
  return {
    ...block,
    id: block.id || newId('b'),
    type: typeof block.type === 'string' ? block.type : 'text',
    data: block.data && typeof block.data === 'object' ? block.data : {},
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
