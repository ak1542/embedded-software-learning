// Mermaid diagrams. The library is large, so it is only fetched when a page has a diagram.
import { h, isDark } from './dom.js';

let mermaidPromise = null;
let mermaidTheme = null;
let counter = 0;

function loadMermaid() {
  mermaidPromise ||= new Promise((resolve, reject) => {
    const script = h('script', { src: 'vendor/mermaid.min.js' });
    script.onload = () => resolve(window.mermaid);
    script.onerror = () => {
      mermaidPromise = null;
      reject(new Error('could not load the diagram library'));
    };
    document.head.append(script);
  });
  return mermaidPromise.then((mermaid) => {
    const theme = isDark() ? 'dark' : 'default';
    if (theme !== mermaidTheme) {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme });
      mermaidTheme = theme;
    }
    return mermaid;
  });
}

export async function renderDiagram(el, code) {
  const id = `mmd-${++counter}`;
  el.replaceChildren(h('span', { class: 'muted' }, 'Drawing diagram…'));
  try {
    const { svg } = await (await loadMermaid()).render(id, code);
    el.innerHTML = svg;
  } catch (err) {
    document.getElementById(`d${id}`)?.remove(); // Mermaid leaves a scratch element behind on errors.
    el.replaceChildren(h('div', { class: 'block-unknown' }, `Diagram error: ${err.message || err}`));
  }
}

// A diagram as a PNG picture (for Word). It is drawn in the light theme with plain SVG text
// labels, because browsers cannot turn HTML labels inside an SVG into a picture.
export async function diagramToPng(code) {
  const mermaid = await loadMermaid();
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default', htmlLabels: false, flowchart: { htmlLabels: false } });
  mermaidTheme = null; // the next diagram on screen sets its own theme again
  const id = `mmdx-${++counter}`;
  let svg;
  try {
    ({ svg } = await mermaid.render(id, code));
  } finally {
    document.getElementById(`d${id}`)?.remove();
  }
  const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  const box = (root.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  const width = Math.ceil(box[2] || parseFloat(root.getAttribute('width')) || 800);
  const height = Math.ceil(box[3] || parseFloat(root.getAttribute('height')) || 600);
  root.setAttribute('width', width);
  root.setAttribute('height', height);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(root))}`;
  await img.decode();
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return { data: new Uint8Array(await blob.arrayBuffer()), width, height };
}
