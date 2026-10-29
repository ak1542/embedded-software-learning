// An interactive animation: a self-contained HTML page (for example, one made by Claude) that
// plays inside the note. It runs in a sandboxed frame without access to this site's data, so
// it cannot read the saved GitHub token or touch the notes.
import { Node } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { SANDBOX, withFitScript, expandButton, openViewer } from './viewer.js';

const WIDTHS = [50, 75, 100];

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
      fit: { default: true }, // grow to the animation's own height; false = use `height`
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
      const fitButton = button('↕ Auto', 'Fit the height to the animation', () =>
        // Turning it off keeps the height the animation has right now.
        patch(current.attrs.fit !== false ? { fit: false, height: Math.round(iframe.getBoundingClientRect().height) } : { fit: true })
      );
      tools.append(
        ...widthButtons,
        fitButton,
        button('↻', 'Restart the animation', () => {
          loadedUrl = null;
          apply();
        }),
        button('↗', 'Open in its own tab', () => window.open(options.resolveMedia(current.attrs.src), '_blank', 'noopener')),
        button('✕', 'Delete', () => {
          const pos = getPos();
          if (typeof pos === 'number') editor.view.dispatch(editor.state.tr.delete(pos, pos + current.nodeSize));
          editor.view.focus();
        }, 'danger')
      );

      let loadedUrl = null;
      let measured = 0;
      let stamps = [];

      const applyHeight = () => {
        const fit = current.attrs.fit !== false;
        iframe.style.height = `${fit && measured ? measured : current.attrs.height}px`;
        if (fit && measured) iframe.setAttribute('scrolling', 'no');
        else iframe.removeAttribute('scrolling');
      };

      // Show the page through srcdoc so the height script can be added; fall back to the plain
      // address if the file cannot be read.
      const load = async () => {
        const url = options.resolveMedia(current.attrs.src);
        loadedUrl = url;
        measured = 0;
        try {
          const res = await fetch(url, { cache: 'reload' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const html = await res.text();
          if (loadedUrl !== url) return;
          iframe.removeAttribute('src');
          iframe.srcdoc = withFitScript(html);
        } catch {
          if (loadedUrl !== url) return;
          iframe.removeAttribute('srcdoc');
          iframe.setAttribute('src', url);
        }
      };

      const onMessage = (event) => {
        if (event.source !== iframe.contentWindow) return;
        const h = event.data && event.data.eslFrameHeight;
        if (typeof h !== 'number' || !Number.isFinite(h)) return;
        // A page whose size depends on the frame's own height (100vh) could keep growing: stop
        // following it if it reports too often.
        const now = Date.now();
        stamps = stamps.filter((t) => now - t < 1500);
        stamps.push(now);
        if (stamps.length > 8) return;
        measured = Math.max(80, Math.min(3000, h));
        dom.dataset.ready = '1';
        applyHeight();
      };
      window.addEventListener('message', onMessage);

      const apply = () => {
        const a = current.attrs;
        if (loadedUrl !== options.resolveMedia(a.src)) load();
        iframe.title = a.title || 'Animation';
        frame.style.width = `${a.width}%`;
        applyHeight();
        widthButtons.forEach((b, i) => b.classList.toggle('on', a.width === WIDTHS[i]));
        fitButton.classList.toggle('on', a.fit !== false);
      };

      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handle.setPointerCapture(e.pointerId);
        const startY = e.clientY;
        const startHeight = iframe.getBoundingClientRect().height;
        let height = Math.round(startHeight);
        const move = (ev) => {
          height = Math.round(Math.max(120, Math.min(1600, startHeight + ev.clientY - startY)));
          iframe.style.height = `${height}px`;
        };
        const up = () => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', up);
          handle.removeEventListener('pointercancel', up);
          patch({ height, fit: false });
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', up);
      });

      // The only way to open the big view is this corner button, so the animation itself stays
      // fully usable inside the note. (Hidden while editing.)
      const expand = expandButton(() => {
        const url = options.resolveMedia(current.attrs.src);
        openViewer({ kind: 'html', src: url, title: current.attrs.title, openUrl: url });
      });

      frame.append(iframe, expand, handle, tools);
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
        stopEvent: (event) => tools.contains(event.target) || handle.contains(event.target) || expand.contains(event.target),
        ignoreMutation: () => true,
        destroy: () => window.removeEventListener('message', onMessage),
      };
    };
  },
});
