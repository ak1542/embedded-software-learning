// Images, GIFs and videos. They share one node view with a drag-to-resize handle and a
// small floating toolbar (size presets, alignment, delete) that shows while selected.
// `width` is a percentage of the page width, so sizes stay sensible on phones too.
import { Node } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';

const SIZES = [25, 50, 75, 100];
const ALIGNS = [
  ['left', '⇤', 'Align left'],
  ['center', '↔', 'Center'],
  ['right', '⇥', 'Align right'],
];

function button(label, title, onClick, className = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `media-btn ${className}`.trim();
  b.textContent = label;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.addEventListener('mousedown', (e) => e.preventDefault()); // keep the node selected
  b.addEventListener('click', onClick);
  return b;
}

function createMediaNode({ name, tag, extraAttributes = {} }) {
  return Node.create({
    name,
    group: 'block',
    atom: true,
    draggable: true,
    selectable: true,

    addOptions() {
      return { resolveMedia: (src) => src };
    },

    addAttributes() {
      return {
        src: { default: '', parseHTML: (el) => el.getAttribute('data-src') || el.getAttribute('src') || '' },
        alt: { default: '' },
        width: {
          default: null,
          parseHTML: (el) => {
            const w = parseFloat(el.getAttribute('data-width'));
            return Number.isFinite(w) ? w : null;
          },
        },
        align: { default: 'center', parseHTML: (el) => el.getAttribute('data-align') || 'center' },
        ...extraAttributes,
      };
    },

    parseHTML() {
      return [{ tag: `${tag}[data-src]` }, ...(tag === 'img' ? [{ tag: 'img[src]' }] : [])];
    },

    renderHTML({ node }) {
      const a = node.attrs;
      const attrs = { src: this.options.resolveMedia(a.src), 'data-src': a.src, 'data-align': a.align };
      if (a.alt) attrs.alt = a.alt;
      if (a.width) {
        attrs['data-width'] = a.width;
        attrs.style = `width:${a.width}%`;
      }
      if (tag === 'video') attrs.controls = 'true';
      return [tag, attrs];
    },

    addNodeView() {
      const options = this.options;
      return ({ node, editor, getPos }) => {
        let current = node;

        const dom = document.createElement('div');
        dom.className = `media-node media-${tag}`;
        const frame = document.createElement('div');
        frame.className = 'media-frame';
        const el = document.createElement(tag);
        if (tag === 'img') {
          el.draggable = false;
          el.loading = 'lazy';
        } else {
          el.playsInline = true;
          el.preload = 'metadata';
        }
        const handle = document.createElement('div');
        handle.className = 'media-handle';
        handle.title = 'Drag to resize';
        const tools = document.createElement('div');
        tools.className = 'media-tools';

        const patch = (attrs) => {
          const pos = getPos();
          if (typeof pos !== 'number') return;
          const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...attrs });
          editor.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)));
        };

        const sizeButtons = SIZES.map((pct) => button(`${pct}%`, `Width ${pct}%`, () => patch({ width: pct }), 'size'));
        const alignButtons = ALIGNS.map(([value, icon, title]) => button(icon, title, () => patch({ align: value }), 'align'));
        const extras = [];
        if (tag === 'video') {
          extras.push(button('Loop', 'Play automatically on a loop, like a GIF', () => patch({ loop: !current.attrs.loop }), 'loop'));
        }
        const remove = button('✕', 'Delete', () => {
          const pos = getPos();
          if (typeof pos === 'number') editor.view.dispatch(editor.state.tr.delete(pos, pos + current.nodeSize));
          editor.view.focus();
        }, 'danger');
        tools.append(...sizeButtons, ...alignButtons, ...extras, remove);

        const apply = () => {
          const a = current.attrs;
          const src = options.resolveMedia(a.src);
          if (el.getAttribute('src') !== src) el.src = src;
          if (tag === 'img') el.alt = a.alt || '';
          else {
            el.loop = Boolean(a.loop);
            el.autoplay = Boolean(a.loop);
            el.muted = Boolean(a.loop);
            el.controls = !a.loop;
          }
          frame.style.width = a.width ? `${a.width}%` : '';
          dom.dataset.align = a.align;
          handle.classList.toggle('left', a.align === 'right');
          sizeButtons.forEach((b, i) => b.classList.toggle('on', a.width === SIZES[i]));
          alignButtons.forEach((b, i) => b.classList.toggle('on', a.align === ALIGNS[i][0]));
          extras.forEach((b) => b.classList.toggle('on', Boolean(a.loop)));
        };

        handle.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          handle.setPointerCapture(e.pointerId);
          const startX = e.clientX;
          const startWidth = frame.getBoundingClientRect().width;
          const maxWidth = dom.getBoundingClientRect().width;
          // A centered picture grows on both sides, so the edge moves half as fast as the pointer.
          const factor = current.attrs.align === 'center' ? 2 : current.attrs.align === 'right' ? -1 : 1;
          let pct = current.attrs.width || Math.round((startWidth / maxWidth) * 100);
          const move = (ev) => {
            const w = Math.max(48, Math.min(maxWidth, startWidth + (ev.clientX - startX) * factor));
            pct = Math.max(5, Math.min(100, Math.round((w / maxWidth) * 100)));
            frame.style.width = `${pct}%`;
          };
          const up = () => {
            handle.removeEventListener('pointermove', move);
            handle.removeEventListener('pointerup', up);
            handle.removeEventListener('pointercancel', up);
            patch({ width: pct });
          };
          handle.addEventListener('pointermove', move);
          handle.addEventListener('pointerup', up);
          handle.addEventListener('pointercancel', up);
        });

        frame.append(el, handle, tools);
        dom.append(frame);
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
          stopEvent: (event) => tools.contains(event.target) || handle.contains(event.target),
          ignoreMutation: () => true,
        };
      };
    },
  });
}

export const Image = createMediaNode({ name: 'image', tag: 'img' });

export const Video = createMediaNode({
  name: 'video',
  tag: 'video',
  extraAttributes: {
    loop: { default: false, parseHTML: (el) => el.getAttribute('data-loop') === 'true', renderHTML: (a) => (a.loop ? { 'data-loop': 'true' } : {}) },
  },
});
