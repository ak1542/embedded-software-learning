// An interactive animation: a self-contained HTML page (for example, one made by Claude) that
// plays inside the note. It runs in a sandboxed frame without access to this site's data, so
// it cannot read the saved GitHub token or touch the notes.
import { Node } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';

const WIDTHS = [50, 75, 100];
const SANDBOX = 'allow-scripts allow-popups allow-forms allow-modals allow-pointer-lock';

export const HtmlAnimation = Node.create({
  name: 'htmlAnimation',
  group: 'block',
  atom: true,
  draggable: true,

  addOptions() {
    return { resolveMedia: (src) => src };
  },

  addAttributes() {
    return {
      src: { default: '', parseHTML: (el) => el.getAttribute('data-src') || '' },
      height: { default: 420, parseHTML: (el) => Number(el.getAttribute('data-height')) || 420 },
      width: { default: 100, parseHTML: (el) => Number(el.getAttribute('data-width')) || 100 },
      title: { default: 'Animation' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-html-animation]' }];
  },

  renderHTML({ node }) {
    const a = node.attrs;
    return [
      'div',
      { 'data-html-animation': '', 'data-src': a.src, 'data-height': a.height, 'data-width': a.width, class: 'html-anim' },
      ['iframe', { src: this.options.resolveMedia(a.src), sandbox: SANDBOX, loading: 'lazy', title: a.title || 'Animation', style: `height:${a.height}px` }],
    ];
  },

  addNodeView() {
    const options = this.options;
    return ({ node, editor, getPos }) => {
      let current = node;
      const dom = document.createElement('div');
      dom.className = 'html-anim';
      const frame = document.createElement('div');
      frame.className = 'html-anim-frame';
      const iframe = document.createElement('iframe');
      iframe.setAttribute('sandbox', SANDBOX);
      iframe.setAttribute('allow', 'fullscreen');
      iframe.allowFullscreen = true;
      const handle = document.createElement('div');
      handle.className = 'html-anim-handle';
      handle.title = 'Drag to change the height';
      const tools = document.createElement('div');
      tools.className = 'media-tools';

      const patch = (attrs) => {
        const pos = getPos();
        if (typeof pos !== 'number') return;
        const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...attrs });
        editor.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)));
      };
      const button = (label, title, onClick, className = '') => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `media-btn ${className}`.trim();
        b.textContent = label;
        b.title = title;
        b.setAttribute('aria-label', title);
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', onClick);
        return b;
      };
      const widthButtons = WIDTHS.map((w) => button(`${w}%`, `Width ${w}%`, () => patch({ width: w })));
      tools.append(
        ...widthButtons,
        button('↻', 'Restart the animation', () => iframe.setAttribute('src', options.resolveMedia(current.attrs.src))),
        button('↗', 'Open in its own tab', () => window.open(options.resolveMedia(current.attrs.src), '_blank', 'noopener')),
        button('✕', 'Delete', () => {
          const pos = getPos();
          if (typeof pos === 'number') editor.view.dispatch(editor.state.tr.delete(pos, pos + current.nodeSize));
          editor.view.focus();
        }, 'danger')
      );

      const apply = () => {
        const a = current.attrs;
        const src = options.resolveMedia(a.src);
        if (iframe.getAttribute('src') !== src) iframe.setAttribute('src', src);
        iframe.title = a.title || 'Animation';
        iframe.style.height = `${a.height}px`;
        frame.style.width = `${a.width}%`;
        widthButtons.forEach((b, i) => b.classList.toggle('on', a.width === WIDTHS[i]));
      };

      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handle.setPointerCapture(e.pointerId);
        const startY = e.clientY;
        const startHeight = iframe.getBoundingClientRect().height;
        let height = current.attrs.height;
        const move = (ev) => {
          height = Math.round(Math.max(120, Math.min(1600, startHeight + ev.clientY - startY)));
          iframe.style.height = `${height}px`;
        };
        const up = () => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', up);
          handle.removeEventListener('pointercancel', up);
          patch({ height });
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', up);
      });

      frame.append(iframe, handle, tools);
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
