// Operations on the section tree and on a section's blocks. Pure data, no DOM.
import { newId } from './schema.js';

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
  const node = { id: newId('s'), title, blocks: [], children: [] };
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

export function countContents(node) {
  let sections = 0;
  let blocks = node.blocks.length;
  for (const child of node.children) {
    const c = countContents(child);
    sections += 1 + c.sections;
    blocks += c.blocks;
  }
  return { sections, blocks };
}

export function insertBlock(node, index, type, data = {}) {
  const block = { id: newId('b'), type, data };
  node.blocks.splice(Math.max(0, Math.min(index, node.blocks.length)), 0, block);
  return block;
}

export function removeBlock(node, blockId) {
  const i = node.blocks.findIndex((b) => b.id === blockId);
  if (i >= 0) node.blocks.splice(i, 1);
  return i >= 0;
}

export function moveBlock(node, blockId, delta) {
  const i = node.blocks.findIndex((b) => b.id === blockId);
  const to = i + delta;
  if (i < 0 || to < 0 || to >= node.blocks.length) return false;
  const [block] = node.blocks.splice(i, 1);
  node.blocks.splice(to, 0, block);
  return true;
}

export function duplicateBlock(node, blockId) {
  const i = node.blocks.findIndex((b) => b.id === blockId);
  if (i < 0) return null;
  const copy = { ...structuredClone(node.blocks[i]), id: newId('b') };
  node.blocks.splice(i + 1, 0, copy);
  return copy;
}
