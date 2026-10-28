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
