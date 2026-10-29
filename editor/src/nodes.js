// Callout boxes, embedded pages/videos and Mermaid diagrams.
import { Node } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { expandButton, openViewer } from './viewer.js';

export const CALLOUT_VARIANTS = ['info', 'tip', 'warning', 'danger'];

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      variant: {
        default: 'info',
        parseHTML: (el) => el.getAttribute('data-variant') || 'info',
        renderHTML: (a) => ({ 'data-variant': a.variant }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },
  renderHTML({ node }) {
    return ['div', { 'data-callout': '', 'data-variant': node.attrs.variant, class: `callout callout-${node.attrs.variant}` }, 0];
  },
});

// YouTube links become privacy-friendly embeds; any other https page is embedded as is.
export function embedUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^www\.|^m\./, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1);
  else if (host === 'youtube.com' && u.pathname === '/watch') id = u.searchParams.get('v');
  else if (host === 'youtube.com' && /^\/(shorts|embed|live)\//.test(u.pathname)) id = u.pathname.split('/')[2];
  if (id) return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`;
  return u.href;
}

export const Embed = Node.create({
  name: 'embed',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return { url: { default: '', parseHTML: (el) => el.getAttribute('data-embed') || '' } };
  },
  parseHTML() {
    return [{ tag: 'div[data-embed]' }];
  },
  renderHTML({ node }) {
    return ['div', { 'data-embed': node.attrs.url, class: 'embed-node' }, ['iframe', iframeAttrs(node.attrs.url)]];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      let current = node;
      const dom = document.createElement('div');
      dom.className = 'embed-node';
      const bar = document.createElement('div');
      bar.className = 'embed-bar';
      const label = document.createElement('span');
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'media-btn danger';
      remove.textContent = '✕';
      remove.title = 'Delete';
      remove.addEventListener('mousedown', (e) => e.preventDefault());
      remove.addEventListener('click', () => {
        const pos = getPos();
        if (typeof pos === 'number') editor.view.dispatch(editor.state.tr.delete(pos, pos + current.nodeSize));
      });
      bar.append(label, remove);
      const frame = document.createElement('iframe');
      dom.append(bar, frame);
      const apply = () => {
        const attrs = iframeAttrs(current.attrs.url);
        label.textContent = attrs.src ? current.attrs.url : 'This link cannot be embedded (use https://)';
        for (const [k, v] of Object.entries(attrs)) frame.setAttribute(k, v);
        if (!attrs.src) frame.removeAttribute('src');
      };
      apply();
      return {
        dom,
        update(updated) {
          if (updated.type !== current.type) return false;
          current = updated;
          apply();
          return true;
        },
        selectNode: () => dom.classList.add('selected'),
        deselectNode: () => dom.classList.remove('selected'),
        stopEvent: (e) => bar.contains(e.target),
        ignoreMutation: () => true,
      };
    };
  },
});

function iframeAttrs(url) {
  const src = embedUrl(url);
  return {
    ...(src ? { src } : {}),
    loading: 'lazy',
    allow: 'accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen',
    allowfullscreen: 'true',
    referrerpolicy: 'strict-origin-when-cross-origin',
    title: 'Embedded content',
  };
}

export const DEFAULT_DIAGRAM = 'flowchart LR\n  A[Start] --> B[Next step]';

export const Diagram = Node.create({
  name: 'diagram',
  group: 'block',
  atom: true,
  draggable: true,
  addOptions() {
    return { renderDiagram: async () => {} };
  },
  addAttributes() {
    return { code: { default: DEFAULT_DIAGRAM, parseHTML: (el) => el.getAttribute('data-diagram') || '' } };
  },
  parseHTML() {
    return [{ tag: 'div[data-diagram]' }];
  },
  renderHTML({ node }) {
    return ['div', { 'data-diagram': node.attrs.code, class: 'diagram-node' }, 'Diagram'];
  },
  addNodeView() {
    const render = this.options.renderDiagram;
    return ({ node, editor, getPos }) => {
      let current = node;
      let drawn = null;
      let timer;
      const dom = document.createElement('div');
      dom.className = 'diagram-node';
      const out = document.createElement('div');
      out.className = 'diagram-out';
      const bar = document.createElement('div');
      bar.className = 'diagram-bar';
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'media-btn';
      toggle.textContent = 'Edit diagram';
      const help = document.createElement('a');
      help.href = 'https://mermaid.js.org/intro/';
      help.target = '_blank';
      help.rel = 'noopener';
      help.textContent = 'Diagram syntax help';
      bar.append(toggle, help);
      const ta = document.createElement('textarea');
      ta.className = 'mono diagram-source';
      ta.spellcheck = false;
      ta.hidden = true;
      ta.rows = 6;
      const expand = expandButton(() => {
        const svg = out.querySelector('svg');
        if (svg) openViewer({ kind: 'svg', markup: new XMLSerializer().serializeToString(svg), title: 'Diagram' });
      });
      dom.append(out, expand, bar, ta);

      const draw = () => {
        if (drawn === current.attrs.code) return;
        drawn = current.attrs.code;
        render(out, current.attrs.code);
      };
      const save = () => {
        const pos = getPos();
        if (typeof pos !== 'number' || ta.value === current.attrs.code) return;
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, code: ta.value }));
      };
      ta.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(save, 400);
      });
      toggle.addEventListener('click', () => {
        const editing = ta.hidden;
        ta.hidden = !editing;
        toggle.textContent = editing ? 'Done' : 'Edit diagram';
        if (editing) {
          ta.value = current.attrs.code;
          ta.focus();
        } else {
          clearTimeout(timer);
          save();
        }
      });
      draw();
      return {
        dom,
        update(updated) {
          if (updated.type !== current.type) return false;
          current = updated;
          draw();
          return true;
        },
        selectNode: () => dom.classList.add('selected'),
        deselectNode: () => dom.classList.remove('selected'),
        stopEvent: (e) => bar.contains(e.target) || e.target === ta || expand.contains(e.target),
        ignoreMutation: () => true,
        destroy: () => clearTimeout(timer),
      };
    };
  },
});

export { NodeSelection };
