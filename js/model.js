// Operations on the section tree. Pure data, no DOM.
import { newId, EMPTY_DOC } from './schema.js';

export function locate(nb, id) {
  let found = null;
  (function search(list, parent, path) {
    for (let i = 0; i < list.length; i++) {
      const node = list[i];
      if (node.id === id) {
        found = { node, list, index: i, parent, path: [...path, node] };
        return true;
      }
      if (search(node.children, node, [...path, node])) return true;
    }
    return false;
  })(nb.sections, null, []);
  return found;
}

export function addNode(nb, parentId, title) {
  const node = { id: newId('s'), title, doc: structuredClone(EMPTY_DOC), children: [] };
  const parent = parentId ? locate(nb, parentId) : null;
  (parent ? parent.node.children : nb.sections).push(node);
  return node;
}

export function removeNode(nb, id) {
  const loc = locate(nb, id);
  if (!loc) return null;
  loc.list.splice(loc.index, 1);
  return loc;
}

export function moveNode(nb, id, delta) {
  const loc = locate(nb, id);
  const to = loc ? loc.index + delta : -1;
  if (!loc || to < 0 || to >= loc.list.length) return false;
  loc.list.splice(loc.index, 1);
  loc.list.splice(to, 0, loc.node);
  return true;
}

// Make a section the last subsection of the section above it.
export function indentNode(nb, id) {
  const loc = locate(nb, id);
  if (!loc || loc.index === 0) return false;
  const newParent = loc.list[loc.index - 1];
  loc.list.splice(loc.index, 1);
  newParent.children.push(loc.node);
  return true;
}

// Move a subsection up one level, right after its current parent.
export function outdentNode(nb, id) {
  const loc = locate(nb, id);
  if (!loc || !loc.parent) return false;
  const parentLoc = locate(nb, loc.parent.id);
  loc.list.splice(loc.index, 1);
  parentLoc.list.splice(parentLoc.index + 1, 0, loc.node);
  return true;
}

export function flatten(nb) {
  const out = [];
  (function visit(list) {
    for (const node of list) {
      out.push(node);
      visit(node.children);
    }
  })(nb.sections);
  return out;
}

export function countSubsections(node) {
  return node.children.reduce((n, child) => n + 1 + countSubsections(child), 0);
}

// Does the page have anything written on it?
export function isEmptyDoc(doc) {
  return !doc || !(doc.content || []).some((n) => n.type !== 'paragraph' || (n.content || []).length);
}

// Plain text of a document, for search.
export function docText(doc) {
  const out = [];
  (function visit(node) {
    if (!node) return;
    if (typeof node.text === 'string') out.push(node.text);
    if (node.attrs && (node.type === 'diagram' || node.type === 'image') && (node.attrs.code || node.attrs.alt)) out.push(node.attrs.code || node.attrs.alt);
    (node.content || []).forEach(visit);
    if (!node.text) out.push('\n');
  })(doc);
  return out.join('').replace(/\s+/g, ' ').trim();
}
