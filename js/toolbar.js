// The formatting toolbar shown above the page in edit mode. One toolbar is created once
// and bound to whichever editor is currently open.
import { h } from './dom.js';

const COLORS = [
  ['', 'Text colour'],
  ['#d93025', 'Red'],
  ['#e8710a', 'Orange'],
  ['#188038', 'Green'],
  ['#1a73e8', 'Blue'],
  ['#9334e6', 'Purple'],
  ['#5f6368', 'Gray'],
];

const STYLES = [
  ['p', 'Normal text'],
  ['h1', 'Heading 1'],
  ['h2', 'Heading 2'],
  ['h3', 'Heading 3'],
  ['h4', 'Heading 4'],
  ['quote', 'Quote'],
  ['code', 'Code block'],
];

const CALLOUTS = {
  info: 'Info box',
  tip: 'Tip box',
  warning: 'Warning box',
  danger: 'Danger box',
};

export function createToolbar({ languages, defaultDiagram, insertFiles }) {
  let editor = null;
  const refreshers = [];

  function button({ label, title, action, active, enabled, className = '' }) {
    const b = h('button', { type: 'button', class: `tb-btn ${className}`.trim(), title, 'aria-label': title }, label);
    // Mouse-down would pull focus (and the text selection) out of the page.
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => editor && action(editor));
    refreshers.push(() => {
      if (!editor) return;
      b.classList.toggle('on', Boolean(active && active(editor)));
      b.disabled = Boolean(enabled && !enabled(editor));
    });
    return b;
  }

  function select({ title, options, change, current, className = '' }) {
    const el = h(
      'select',
      { class: `tb-select ${className}`.trim(), title, 'aria-label': title },
      options.map(([value, text]) => h('option', { value }, text))
    );
    el.addEventListener('change', () => {
      if (!editor) return;
      change(editor, el.value);
      if (!current) el.selectedIndex = 0;
    });
    if (current) refreshers.push(() => editor && (el.value = current(editor)));
    return el;
  }

  const group = (...children) => h('div', { class: 'tb-group' }, children);

  const mark = (label, title, name, command, className) =>
    button({ label, title, className, active: (e) => e.isActive(name), action: (e) => e.chain().focus()[command]().run() });

  const fileInput = (accept, multiple = true) =>
    h('input', {
      type: 'file',
      accept,
      multiple,
      hidden: true,
      onChange: (e) => {
        const files = [...e.target.files];
        e.target.value = '';
        if (files.length) insertFiles(files, null);
      },
    });
  const imageInput = fileInput('image/*');
  const videoInput = fileInput('video/*', false);

  const currentStyle = (e) => {
    for (let level = 1; level <= 4; level++) if (e.isActive('heading', { level })) return `h${level}`;
    if (e.isActive('blockquote')) return 'quote';
    if (e.isActive('codeBlock')) return 'code';
    return 'p';
  };

  const applyStyle = (e, value) => {
    const chain = e.chain().focus();
    if (value === 'p') chain.setParagraph().run();
    else if (value === 'quote') e.isActive('blockquote') || chain.toggleBlockquote().run();
    else if (value === 'code') chain.setCodeBlock().run();
    else chain.setHeading({ level: Number(value.slice(1)) }).run();
  };

  const setLink = (e) => {
    const previous = e.getAttributes('link').href || '';
    const url = window.prompt('Link address (leave empty to remove the link)', previous || 'https://');
    if (url === null) return;
    const chain = e.chain().focus().extendMarkRange('link');
    if (url.trim() === '') chain.unsetLink().run();
    else chain.setLink({ href: /^[a-z][a-z0-9+.-]*:/i.test(url.trim()) ? url.trim() : `https://${url.trim()}` }).run();
  };

  const languageSelect = select({
    title: 'Code language',
    className: 'code-lang',
    options: languages,
    current: (e) => e.getAttributes('codeBlock').language || 'c',
    change: (e, value) => e.chain().focus().updateAttributes('codeBlock', { language: value }).run(),
  });
  const codeGroup = group(languageSelect);

  const tableGroup = group(
    ...[
      ['+ Row', 'Add row below', (c) => c.addRowAfter()],
      ['+ Col', 'Add column to the right', (c) => c.addColumnAfter()],
      ['− Row', 'Delete row', (c) => c.deleteRow()],
      ['− Col', 'Delete column', (c) => c.deleteColumn()],
      ['Header', 'Toggle header row', (c) => c.toggleHeaderRow()],
      ['Delete table', 'Delete table', (c) => c.deleteTable()],
    ].map(([label, title, fn]) => button({ label, title, className: 'text', action: (e) => fn(e.chain().focus()).run() }))
  );

  const el = h(
    'div',
    { class: 'toolbar', role: 'toolbar', 'aria-label': 'Formatting' },
    group(
      button({ label: '↶', title: 'Undo (Ctrl+Z)', action: (e) => e.chain().focus().undo().run(), enabled: (e) => e.can().undo() }),
      button({ label: '↷', title: 'Redo (Ctrl+Y)', action: (e) => e.chain().focus().redo().run(), enabled: (e) => e.can().redo() })
    ),
    group(select({ title: 'Paragraph style', options: STYLES, current: currentStyle, change: applyStyle, className: 'style' })),
    group(
      mark('B', 'Bold (Ctrl+B)', 'bold', 'toggleBold', 'b'),
      mark('I', 'Italic (Ctrl+I)', 'italic', 'toggleItalic', 'i'),
      mark('U', 'Underline (Ctrl+U)', 'underline', 'toggleUnderline', 'u'),
      mark('S', 'Strikethrough', 'strike', 'toggleStrike', 's'),
      mark('<>', 'Inline code', 'code', 'toggleCode', 'mono'),
      mark('🖍', 'Highlight', 'highlight', 'toggleHighlight'),
      select({
        title: 'Text colour',
        options: COLORS,
        className: 'color',
        change: (e, value) => (value ? e.chain().focus().setColor(value).run() : e.chain().focus().unsetColor().run()),
      })
    ),
    group(
      button({ label: '•', title: 'Bulleted list', active: (e) => e.isActive('bulletList'), action: (e) => e.chain().focus().toggleBulletList().run() }),
      button({ label: '1.', title: 'Numbered list', active: (e) => e.isActive('orderedList'), action: (e) => e.chain().focus().toggleOrderedList().run() }),
      button({ label: '☑', title: 'Checklist', active: (e) => e.isActive('taskList'), action: (e) => e.chain().focus().toggleTaskList().run() })
    ),
    group(
      ...[
        ['left', '⇤', 'Align left'],
        ['center', '↔', 'Center'],
        ['right', '⇥', 'Align right'],
      ].map(([value, label, title]) =>
        button({ label, title, active: (e) => e.isActive({ textAlign: value }), action: (e) => e.chain().focus().setTextAlign(value).run() })
      )
    ),
    group(
      button({ label: 'Link', title: 'Insert or edit link (Ctrl+K)', className: 'text', active: (e) => e.isActive('link'), action: setLink }),
      button({ label: 'Image', title: 'Insert picture or GIF (you can also paste or drop one)', className: 'text', action: () => imageInput.click() }),
      button({ label: 'Video', title: 'Insert video', className: 'text', action: () => videoInput.click() }),
      button({
        label: 'Table',
        title: 'Insert table',
        className: 'text',
        action: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
      }),
      button({ label: '{ } Code', title: 'Code block', className: 'text', active: (e) => e.isActive('codeBlock'), action: (e) => e.chain().focus().toggleCodeBlock().run() })
    ),
    group(
      select({
        title: 'Highlighted box',
        className: 'box',
        options: [['', 'Box ▾'], ...Object.entries(CALLOUTS), ['none', 'Remove box']],
        change: (e, value) => {
          if (!value) return;
          const chain = e.chain().focus();
          if (value === 'none') chain.lift('callout').run();
          else if (e.isActive('callout')) chain.updateAttributes('callout', { variant: value }).run();
          else chain.wrapIn('callout', { variant: value }).run();
        },
      }),
      button({ label: '—', title: 'Horizontal line', action: (e) => e.chain().focus().setHorizontalRule().run() }),
      button({
        label: 'Diagram',
        title: 'Insert a diagram (flowchart, state machine…)',
        className: 'text',
        action: (e) => e.chain().focus().insertContent({ type: 'diagram', attrs: { code: defaultDiagram } }).run(),
      }),
      button({
        label: 'Embed',
        title: 'Embed a YouTube video or web page',
        className: 'text',
        action: (e) => {
          const url = window.prompt('Paste the address of a YouTube video or web page (https://…)');
          if (url && url.trim()) e.chain().focus().insertContent({ type: 'embed', attrs: { url: url.trim() } }).run();
        },
      })
    ),
    codeGroup,
    tableGroup,
    imageInput,
    videoInput
  );
  codeGroup.hidden = true;
  tableGroup.hidden = true;

  function refresh() {
    if (!editor || editor.isDestroyed) return;
    refreshers.forEach((fn) => fn());
    codeGroup.hidden = !editor.isActive('codeBlock');
    tableGroup.hidden = !editor.isActive('table');
  }

  return {
    el,
    bind(next) {
      editor = next;
      if (editor) {
        editor.on('transaction', refresh);
        refresh();
      }
    },
    setLink: () => editor && setLink(editor),
  };
}
