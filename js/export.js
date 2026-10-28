// Export pages to PDF (through the browser's print window) or Word (.docx).
import { h, toast } from './dom.js';
import * as model from './model.js';
import { renderDiagram, diagramToPng } from './diagram.js';
import { resolveMedia } from './storage.js';

// scope: 'page' | 'branch' (a section and everything inside it) | 'all'
export function collectSections(nb, scope, current) {
  const out = [];
  const add = (node, depth) => {
    out.push({ node, depth, title: node.title || 'Untitled', doc: node.doc });
    node.children.forEach((c) => add(c, depth + 1));
  };
  if (scope === 'all') nb.sections.forEach((n) => add(n, 0));
  else if (scope === 'branch' && current) add(current, 0);
  else if (current) out.push({ node: current, depth: 0, title: current.title || 'Untitled', doc: current.doc });
  return out;
}

export function exportTitle(nb, scope, current) {
  return scope === 'all' || !current ? nb.settings.title : current.title || 'Untitled';
}

const fileBase = (title) => title.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').slice(0, 80) || 'notes';

function waitUntil(test, ms) {
  return new Promise((resolve) => {
    const start = Date.now();
    (function poll() {
      if (test() || Date.now() - start > ms) resolve();
      else setTimeout(poll, 100);
    })();
  });
}

/* ---------- PDF ---------- */

export async function exportPdf({ nb, sections, title, lib }) {
  document.getElementById('print-root')?.remove();
  const numbers = nb.settings.numbering ? model.sectionNumbers(nb) : null;
  const label = (s) => (numbers && numbers.get(s.node.id) ? `${numbers.get(s.node.id)}  ${s.title}` : s.title);
  const root = h('div', { id: 'print-root' });
  const editors = [];

  const multiple = sections.length > 1;
  if (multiple) {
    root.append(
      h('h1', { class: 'print-title' }, title),
      h('p', { class: 'print-meta' }, new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })),
      h('div', { class: 'print-toc' }, h('strong', {}, 'Contents'), sections.map((s) => h('div', { style: `padding-left:${s.depth * 18}px` }, label(s))))
    );
  }
  sections.forEach((s, i) => {
    const host = h('div', { class: 'print-doc' });
    root.append(
      h(
        'section',
        { class: `print-section${multiple && s.depth === 0 && i > 0 ? ' page-break' : ''}${multiple && i === 0 ? ' page-break' : ''}` },
        h('div', { class: `print-section-title depth-${Math.min(s.depth, 3)}` }, label(s)),
        host
      )
    );
    editors.push(
      lib.createEditor(host, {
        content: s.doc,
        editable: false,
        hooks: { resolveMedia, renderDiagram, insertFiles() {} },
        numbering: Boolean(nb.settings.numbering),
      })
    );
  });
  document.body.append(root);

  // Print on paper-like colours whatever theme the site is in.
  const root_el = document.documentElement;
  const previousTheme = root_el.dataset.theme;
  const previousTitle = document.title;
  root_el.dataset.theme = 'light';
  root.querySelectorAll('img').forEach((img) => (img.loading = 'eager'));

  const cleanup = () => {
    root_el.dataset.theme = previousTheme;
    document.title = previousTitle;
    document.body.classList.remove('printing');
    editors.forEach((e) => e.destroy());
    root.remove();
  };
  toast('Preparing the PDF…', 'info', 15000);
  await waitUntil(() => !root.querySelector('.diagram-out .muted') && [...root.querySelectorAll('img')].every((i) => i.complete), 20000);
  // Animations: wait until each page has loaded and reported its height, then give them a moment.
  const animations = [...root.querySelectorAll('.html-anim')];
  if (animations.length) {
    await waitUntil(() => animations.every((a) => a.dataset.ready), 6000);
    await new Promise((resolve) => setTimeout(resolve, 700));
    fitAnimationsToPage(animations);
  }
  document.body.classList.add('printing');
  document.title = fileBase(title);
  window.addEventListener('afterprint', cleanup, { once: true });
  toast('In the print window, choose “Save as PDF” as the printer.', 'info', 8000);
  try {
    window.print();
  } catch (err) {
    cleanup();
    throw err;
  }
}

// An animation taller than a page is scaled down so it is not cut off.
const MAX_ANIMATION_HEIGHT = 860; // CSS pixels: about one A4 page inside the margins
function fitAnimationsToPage(animations) {
  for (const anim of animations) {
    const frame = anim.querySelector('.html-anim-frame');
    if (!frame) continue;
    frame.style.width = '100%'; // the width chosen on screen does not apply on paper
    const height = anim.querySelector('iframe').getBoundingClientRect().height;
    if (height <= MAX_ANIMATION_HEIGHT) continue;
    const scale = MAX_ANIMATION_HEIGHT / height;
    frame.style.width = `${100 / scale}%`;
    frame.style.transform = `scale(${scale})`;
    frame.style.transformOrigin = 'top left';
    anim.style.height = `${Math.round(height * scale)}px`;
  }
}

/* ---------- Word ---------- */

export async function exportWord({ nb, sections, title }) {
  toast('Building the Word file…', 'info', 30000);
  const { buildDocx } = await import('../vendor/export-docx.bundle.js');
  const numbers = nb.settings.numbering ? model.sectionNumbers(nb) : null;
  const blob = await buildDocx({
    title,
    sections: sections.map((s) => ({ depth: s.depth, number: numbers?.get(s.node.id), title: s.title, doc: s.doc })),
    numbering: Boolean(nb.settings.numbering),
    hooks: { resolveMedia, diagramToPng },
  });
  const a = h('a', { href: URL.createObjectURL(blob), download: `${fileBase(title)}.docx` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  toast('Word file ready: check your downloads.', 'success');
}
