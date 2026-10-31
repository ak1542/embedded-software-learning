// A PDF file stored next to the notes: shown as a card with Preview / Open / Download.
import { Node } from '@tiptap/core';

async function usableUrl(url) {
  // Browsers refuse to show data: PDFs in frames, so turn them into a temporary blob address.
  if (!url.startsWith('data:')) return url;
  const blob = await (await fetch(url)).blob();
  return URL.createObjectURL(blob);
}

function button(label, title, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'pdf-btn';
  b.textContent = label;
  b.title = title;
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', onClick);
  return b;
}

export const Pdf = Node.create({
  name: 'pdf',
  group: 'block',
  atom: true,
  draggable: true,
  addOptions() {
    return { resolveMedia: (s) => s };
  },
  addAttributes() {
    return {
      src: { default: '', parseHTML: (el) => el.getAttribute('data-pdf') || '' },
      title: { default: 'PDF document', parseHTML: (el) => el.getAttribute('data-title') || 'PDF document' },
      height: { default: 600, parseHTML: (el) => Number(el.getAttribute('data-height')) || 600 },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-pdf]' }];
  },
  renderHTML({ node }) {
    return ['div', { 'data-pdf': node.attrs.src, 'data-title': node.attrs.title, 'data-height': node.attrs.height, class: 'pdf-node' }, ['a', { href: node.attrs.src }, `📄 ${node.attrs.title} (PDF)`]];
  },
  addNodeView() {
    const options = this.options;
    return ({ node, editor, getPos }) => {
      let current = node;
      let open = false;
      let resolved = null;

      const dom = document.createElement('div');
      dom.className = 'pdf-node';
      const head = document.createElement('div');
      head.className = 'pdf-head';
      const icon = document.createElement('span');
      icon.className = 'pdf-icon';
      icon.textContent = '📄';
      const title = document.createElement('span');
      title.className = 'pdf-title';
      const badge = document.createElement('span');
      badge.className = 'pdf-badge';
      badge.textContent = 'PDF';
      const actions = document.createElement('div');
      actions.className = 'pdf-actions';
      const frame = document.createElement('iframe');
      frame.className = 'pdf-frame';
      frame.hidden = true;
      frame.title = 'PDF preview';
      const hint = document.createElement('div');
      hint.className = 'pdf-hint';
      hint.hidden = true;
      hint.textContent = 'If the preview stays empty (common on phones), use Open or Download.';

      const patch = (attrs) => {
        const pos = getPos();
        if (typeof pos === 'number') editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...attrs }));
      };

      const openLink = document.createElement('a');
      openLink.className = 'pdf-btn';
      openLink.textContent = 'Open';
      openLink.target = '_blank';
      openLink.rel = 'noopener';
      const downloadLink = document.createElement('a');
      downloadLink.className = 'pdf-btn';
      downloadLink.textContent = 'Download';
      const preview = button('Preview', 'Show or hide the PDF here', async () => {
        open = !open;
        if (open && !frame.getAttribute('src')) frame.src = `${resolved || (await usableUrl(options.resolveMedia(current.attrs.src)))}#view=FitH`;
        frame.hidden = !open;
        hint.hidden = !open;
        preview.textContent = open ? 'Hide preview' : 'Preview';
      });
      const rename = button('✎', 'Rename', () => {
        const t = window.prompt('Title of this PDF', current.attrs.title);
        if (t && t.trim()) patch({ title: t.trim() });
      });
      const taller = button('↕', 'Change the preview height', () => {
        const heights = [400, 600, 800, 1000];
        patch({ height: heights[(heights.indexOf(current.attrs.height) + 1) % heights.length] || 600 });
      });
      const remove = button('✕', 'Delete', () => {
        const pos = getPos();
        if (typeof pos === 'number') editor.view.dispatch(editor.state.tr.delete(pos, pos + current.nodeSize));
      });
      remove.classList.add('danger');
      const editTools = [rename, taller, remove];

      head.append(icon, title, badge, actions);
      actions.append(preview, openLink, downloadLink, ...editTools);
      dom.append(head, frame, hint);

      const apply = async () => {
        title.textContent = current.attrs.title;
        frame.style.height = `${current.attrs.height}px`;
        editTools.forEach((b) => (b.hidden = !editor.isEditable));
        const raw = options.resolveMedia(current.attrs.src);
        resolved = await usableUrl(raw);
        openLink.href = resolved;
        downloadLink.href = resolved;
        downloadLink.download = `${current.attrs.title.replace(/[^\w.-]+/g, '-')}.pdf`;
      };
      apply();

      return {
        dom,
        update(updated) {
          if (updated.type !== current.type) return false;
          const srcChanged = updated.attrs.src !== current.attrs.src;
          current = updated;
          if (srcChanged) frame.removeAttribute('src');
          apply();
          return true;
        },
        selectNode: () => dom.classList.add('selected'),
        deselectNode: () => dom.classList.remove('selected'),
        stopEvent: (e) => Boolean(e.target.closest && e.target.closest('button, a')),
        ignoreMutation: () => true,
      };
    };
  },
});
