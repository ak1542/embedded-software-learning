// Turns notebook pages (ProseMirror JSON) into a Word (.docx) file.
// Built into vendor/export-docx.bundle.js and only loaded when someone exports.
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { numberHeadings } from './numbering.js';

const CONTENT_WIDTH_PX = 600; // A4 with 2 cm margins is a little over 600 CSS pixels wide
const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
const ALIGN = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED };
const CALLOUT = {
  info: { bar: '2563EB', fill: 'E8EFFF' },
  tip: { bar: '15803D', fill: 'E3F4E8' },
  warning: { bar: 'B45309', fill: 'FDF0E2' },
  danger: { bar: 'C62828', fill: 'FBE7E7' },
};
const CODE_FONT = 'Consolas';
const MAX_LIST_LEVEL = 5;

function listLevels(format, text) {
  return Array.from({ length: MAX_LIST_LEVEL + 1 }, (_, level) => ({
    level,
    format,
    text: typeof text === 'function' ? text(level) : text,
    alignment: AlignmentType.START,
    style: { paragraph: { indent: { left: 540 + level * 360, hanging: 270 } } },
  }));
}

// sections: [{ depth, number, title, doc }]; hooks: { resolveMedia(src), diagramToPng(code) }
export async function buildDocx({ title, sections, numbering, hooks }) {
  const state = { hooks, listInstance: 0, headingNumbers: [], headingIndex: 0 };
  const children = [];
  const multiple = sections.length > 1;

  if (multiple) children.push(new Paragraph({ text: title, heading: HeadingLevel.TITLE, spacing: { after: 240 } }));

  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const level = Math.min(s.depth, 5);
    children.push(
      new Paragraph({
        heading: HEADINGS[level],
        pageBreakBefore: multiple && s.depth === 0 && i > 0,
        children: [new TextRun(numbering && s.number ? `${s.number}  ${s.title}` : s.title)],
      })
    );
    state.headingNumbers = numbering ? numberHeadings(collectHeadingLevels(s.doc)) : [];
    state.headingIndex = 0;
    children.push(...(await blocks(s.doc.content || [], state, { titleLevel: level })));
  }

  const doc = new Document({
    creator: title,
    title,
    styles: {
      default: { document: { run: { font: 'Calibri', size: 22 } } },
      paragraphStyles: [
        { id: 'Title', name: 'Title', basedOn: 'Normal', run: { size: 52, bold: true, color: '1C2330' }, paragraph: { spacing: { after: 240 } } },
        ...HEADINGS.map((_, i) => ({
          id: `Heading${i + 1}`,
          name: `Heading ${i + 1}`,
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: [36, 30, 26, 24, 22, 22][i], bold: true, color: i < 2 ? '1F3A6D' : '1C2330' },
          paragraph: { spacing: { before: i === 0 ? 360 : 240, after: 120 }, keepNext: true, outlineLevel: i },
        })),
      ],
    },
    numbering: {
      config: [
        { reference: 'bullets', levels: listLevels(LevelFormat.BULLET, (l) => ['•', '◦', '▪'][l % 3]) },
        // Every numbered list uses its own instance of this, so each one starts again at 1.
        { reference: 'ordered', levels: listLevels(LevelFormat.DECIMAL, (l) => `%${l + 1}.`) },
      ],
    },
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } } },
        children,
      },
    ],
  });
  return Packer.toBlob(doc);
}

function collectHeadingLevels(doc) {
  const levels = [];
  (function visit(node) {
    if (node.type === 'heading') levels.push(node.attrs?.level || 1);
    (node.content || []).forEach(visit);
  })(doc);
  return levels;
}

/* ---------- block content ---------- */

async function blocks(nodes, state, o) {
  const out = [];
  for (const node of nodes) out.push(...(await block(node, state, o)));
  return out;
}

async function block(node, state, o) {
  switch (node.type) {
    case 'paragraph':
      return [paragraph(node, o)];
    case 'heading': {
      const level = Math.min(5, o.titleLevel + (node.attrs?.level || 1));
      const number = state.headingNumbers[state.headingIndex++];
      return [new Paragraph({ heading: HEADINGS[level], alignment: alignOf(node), children: [...(number ? [new TextRun(`${number}  `)] : []), ...inline(node.content)] })];
    }
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return list(node, state, o, 0);
    case 'blockquote':
      return blocks(node.content || [], state, { ...o, quote: true });
    case 'callout':
      return blocks(node.content || [], state, { ...o, callout: CALLOUT[node.attrs?.variant] || CALLOUT.info });
    case 'codeBlock':
      return codeBlock(node);
    case 'horizontalRule':
      return [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'C9CED6', space: 1 } }, spacing: { before: 120, after: 120 } })];
    case 'table':
      return [await table(node, state, o)];
    case 'image':
      return [await image(node, state)];
    case 'video':
      return [linkLine('Video', node.attrs?.src, state)];
    case 'htmlAnimation':
      return [linkLine('Interactive animation (play it in the online notes)', node.attrs?.src, state, true)];
    case 'embed':
      return [linkLine('Embedded page', node.attrs?.url, state, true)];
    case 'diagram':
      return diagram(node, state);
    default:
      return node.content ? blocks(node.content, state, o) : [];
  }
}

function alignOf(node) {
  return ALIGN[node.attrs?.textAlign] || undefined;
}

function paragraph(node, o, extra = {}) {
  const opts = { children: inline(node.content), alignment: alignOf(node), spacing: { after: 120, line: 276 }, ...extra };
  decorate(opts, o);
  return new Paragraph(opts);
}

// Indent, quote bar and callout colouring shared by every paragraph in a container.
function decorate(opts, o) {
  const left = (o.indentLeft || 0) + (o.quote || o.callout ? 240 : 0);
  if (left) opts.indent = { ...(opts.indent || {}), left: (opts.indent?.left || 0) + left };
  if (o.callout) {
    opts.shading = { type: ShadingType.CLEAR, color: 'auto', fill: o.callout.fill };
    opts.border = { left: { style: BorderStyle.SINGLE, size: 24, color: o.callout.bar, space: 8 } };
  } else if (o.quote) {
    opts.border = { left: { style: BorderStyle.SINGLE, size: 18, color: 'C9CED6', space: 8 } };
  }
}

function inline(nodes = []) {
  const out = [];
  for (const n of nodes) {
    if (n.type === 'hardBreak') {
      out.push(new TextRun({ break: 1 }));
      continue;
    }
    if (n.type !== 'text' || !n.text) continue;
    const marks = Object.fromEntries((n.marks || []).map((m) => [m.type, m.attrs || true]));
    const run = new TextRun({
      text: n.text,
      bold: Boolean(marks.bold),
      italics: Boolean(marks.italic),
      underline: marks.underline || marks.link ? {} : undefined,
      strike: Boolean(marks.strike),
      highlight: marks.highlight ? 'yellow' : undefined,
      color: marks.link ? '1A55C7' : /^#[0-9a-f]{6}$/i.test(marks.textStyle?.color || '') ? marks.textStyle.color.slice(1) : undefined,
      font: marks.code ? CODE_FONT : undefined,
      shading: marks.code ? { type: ShadingType.CLEAR, color: 'auto', fill: 'EEF0F3' } : undefined,
    });
    out.push(marks.link?.href ? new ExternalHyperlink({ link: marks.link.href, children: [run] }) : run);
  }
  return out;
}

/* ---------- lists ---------- */

async function list(node, state, o, level) {
  const out = [];
  const ordered = node.type === 'orderedList';
  const task = node.type === 'taskList';
  const instance = ordered ? ++state.listInstance : undefined;
  const lv = Math.min(level, MAX_LIST_LEVEL);
  for (const item of node.content || []) {
    const kids = item.content || [];
    for (let i = 0; i < kids.length; i++) {
      const kid = kids[i];
      if (['bulletList', 'orderedList', 'taskList'].includes(kid.type)) {
        out.push(...(await list(kid, state, o, level + 1)));
      } else if (kid.type === 'paragraph' && i === 0) {
        const extra = task
          ? { indent: { left: 360 + lv * 360 }, children: [new TextRun(item.attrs?.checked ? '☑  ' : '☐  '), ...inline(kid.content)] }
          : { numbering: { reference: ordered ? 'ordered' : 'bullets', level: lv, ...(ordered ? { instance } : {}) } };
        out.push(paragraph(kid, o, { ...extra, spacing: { after: 60, line: 276 } }));
      } else {
        out.push(...(await blocks([kid], state, { ...o, indentLeft: (o.indentLeft || 0) + 540 + lv * 360 })));
      }
    }
  }
  return out;
}

/* ---------- code, tables ---------- */

function codeBlock(node) {
  const text = (node.content || []).map((n) => n.text || '').join('').replace(/\t/g, '    ');
  const lines = text.split('\n');
  return lines.map(
    (line, i) =>
      new Paragraph({
        children: [new TextRun({ text: line || ' ', font: CODE_FONT, size: 19 })],
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F2F4F7' },
        spacing: { before: 0, after: i === lines.length - 1 ? 160 : 0, line: 252 },
        indent: { left: 120, right: 120 },
        keepLines: true,
      })
  );
}

async function table(node, state, o) {
  const rows = [];
  for (const row of node.content || []) {
    const cells = [];
    for (const cell of row.content || []) {
      const header = cell.type === 'tableHeader';
      let content = await blocks(cell.content || [], state, { ...o, header });
      if (!content.length) content = [new Paragraph('')];
      cells.push(
        new TableCell({
          children: content,
          shading: header ? { type: ShadingType.CLEAR, color: 'auto', fill: 'E8EDF5' } : undefined,
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          columnSpan: cell.attrs?.colspan > 1 ? cell.attrs.colspan : undefined,
        })
      );
    }
    const headerRow = (row.content || [])[0]?.type === 'tableHeader';
    if (cells.length) rows.push(new TableRow({ children: cells, ...(headerRow ? { tableHeader: true } : {}) }));
  }
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });
}

/* ---------- pictures, diagrams, links ---------- */

function placeholder(text) {
  return new Paragraph({ children: [new TextRun({ text, italics: true, color: '6B7280' })], spacing: { after: 120 } });
}

function linkLine(label, url, state, titled = false) {
  if (!url) return placeholder(`[${label}]`);
  const href = new URL(state.hooks.resolveMedia(url) || url, location.href).href;
  const prefix = new TextRun(`${titled ? '' : '▶ '}${label}: `);
  // Pictures that are only in this browser (blob: / data: addresses) cannot be linked to.
  const target = /^https?:/.test(href)
    ? new ExternalHyperlink({ link: href, children: [new TextRun({ text: href, color: '1A55C7', underline: {} })] })
    : new TextRun({ text: url, italics: true });
  return new Paragraph({ children: [prefix, target], spacing: { after: 120 } });
}

async function image(node, state) {
  const a = node.attrs || {};
  if (!a.src) return placeholder('[Empty picture]');
  try {
    const img = await loadPicture(state.hooks.resolveMedia(a.src));
    const targetWidth = a.width ? (CONTENT_WIDTH_PX * a.width) / 100 : Math.min(img.width, CONTENT_WIDTH_PX);
    const width = Math.max(20, Math.round(Math.min(targetWidth, CONTENT_WIDTH_PX)));
    return pictureParagraph(img, width, ALIGN[a.align] || AlignmentType.CENTER, a.alt);
  } catch {
    return placeholder(`[Picture could not be loaded: ${a.src}]`);
  }
}

function pictureParagraph(img, width, alignment, alt = '') {
  const height = Math.max(10, Math.round((img.height / img.width) * width));
  return new Paragraph({
    alignment,
    spacing: { before: 80, after: 160 },
    keepNext: false,
    children: [
      new ImageRun({
        type: img.type,
        data: img.data,
        transformation: { width, height },
        altText: { title: alt || 'picture', description: alt || 'picture', name: alt || 'picture' },
      }),
    ],
  });
}

async function diagram(node, state) {
  const code = node.attrs?.code || '';
  try {
    const png = await state.hooks.diagramToPng(code);
    const width = Math.min(png.width, CONTENT_WIDTH_PX);
    return [pictureParagraph({ type: 'png', data: png.data, width: png.width, height: png.height }, width, AlignmentType.CENTER, 'diagram')];
  } catch {
    // Keep the diagram's source so nothing is lost.
    return [placeholder('[Diagram could not be drawn; its source follows]'), ...codeBlock({ content: [{ text: code }] })];
  }
}

async function loadPicture(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const types = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/bmp': 'bmp' };
  const bitmap = await createImageBitmap(blob);
  const size = { width: bitmap.width, height: bitmap.height };
  if (types[blob.type]) {
    bitmap.close();
    return { ...size, type: types[blob.type], data: new Uint8Array(await blob.arrayBuffer()) };
  }
  // Word cannot show WebP and some other formats, so convert them to PNG.
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close();
  const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return { ...size, type: 'png', data: new Uint8Array(await png.arrayBuffer()) };
}
