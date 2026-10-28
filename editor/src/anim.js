// An interactive animation: a self-contained HTML page (for example, one made by Claude) that
// plays inside the note. It runs in a sandboxed frame without access to this site's data, so
// it cannot read the saved GitHub token or touch the notes.
import { Node } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';

const WIDTHS = [50, 75, 100];
const SANDBOX = 'allow-scripts allow-popups allow-forms allow-modals allow-pointer-lock';

// The animation page runs in a sandbox, so the note cannot measure it from outside. A tiny
// script is added when the page is shown; it reports the page's height so the frame can grow
// to fit and the note keeps a single scrollbar.
const FIT_SCRIPT =
  '<script>(function(){var last=0;function send(){var h=Math.ceil(document.documentElement.getBoundingClientRect().height);' +
  'if(h&&h!==last){last=h;parent.postMessage({eslFrameHeight:h},"*");}}' +
  'addEventListener("load",send);addEventListener("resize",send);' +
  'if(window.ResizeObserver){new ResizeObserver(send).observe(document.documentElement);}else{setInterval(send,400);}send();})();</script>';

function withFitScript(html) {
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, () => `${FIT_SCRIPT}</body>`) : html + FIT_SCRIPT;
}

// A big view of the animation (like clicking a picture): the page fills the screen and scrolls
// by itself. It is loaded fresh, without the height script, so it starts from the beginning.
function openAnimationPopup(url, title) {
  const dialog = document.createElement('dialog');
  dialog.className = 'anim-popup';
  const bar = document.createElement('div');
  bar.className = 'anim-popup-bar';
  const heading = document.createElement('span');
  heading.textContent = title || 'Animation';
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'btn small';
  open.textContent = 'Open in its own tab ↗';
  open.addEventListener('click', () => window.open(url, '_blank', 'noopener'));
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn small';
  close.textContent = '✕ Close';
  close.addEventListener('click', () => dialog.close());
  const spacer = document.createElement('span');
  spacer.style.flex = '1';
  bar.append(heading, spacer, open, close);
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', SANDBOX);
  iframe.setAttribute('allow', 'fullscreen');
  iframe.allowFullscreen = true;
  iframe.title = title || 'Animation';
  dialog.append(bar, iframe);
  dialog.addEventListener('click', (e) => e.target === dialog && dialog.close());
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  fetch(url)
    .then((res) => (res.ok ? res.text() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then((html) => (iframe.srcdoc = html))
    .catch(() => iframe.setAttribute('src', url));
  close.focus();
}

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
          const res = await fetch(url);
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

      // In view mode a click anywhere on the animation opens the big view. (The frame itself would
      // swallow the click, so a transparent button sits on top of it. Hidden while editing.)
      const hit = document.createElement('button');
      hit.type = 'button';
      hit.className = 'html-anim-hit';
      hit.setAttribute('aria-label', 'Enlarge the animation');
      const badge = document.createElement('span');
      badge.textContent = '⤢ Click to enlarge';
      hit.append(badge);
      hit.addEventListener('click', () => openAnimationPopup(options.resolveMedia(current.attrs.src), current.attrs.title));

      frame.append(iframe, hit, handle, tools);
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
        stopEvent: (event) => tools.contains(event.target) || handle.contains(event.target) || hit.contains(event.target),
        ignoreMutation: () => true,
        destroy: () => window.removeEventListener('message', onMessage),
      };
    };
  },
});
