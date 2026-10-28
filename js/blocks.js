// Block types: how each kind of content is rendered and edited.
//
// A block is stored as { id, type, data }. Rendering always goes through this
// file, and a block's data is merged over its type's current defaults first, so
// improving a renderer or adding a field here updates every note, old or new.
// Block types this version doesn't know are kept untouched and can still be
// edited as raw JSON.
import { h, debounce, prefersReducedMotion, isDark, toast } from './dom.js';

const SIZES = [
  ['small', 'Small'],
  ['medium', 'Medium'],
  ['large', 'Column width'],
  ['full', 'Extra wide'],
];

const CODE_LANGS = ['c', 'cpp', 'armasm', 'x86asm', 'python', 'rust', 'bash', 'makefile', 'cmake', 'ini', 'json', 'yaml', 'verilog', 'plaintext'];

export const BLOCK_TYPES = {
  text: {
    label: 'Text',
    icon: '¶',
    hint: 'Paragraphs, lists, tables, links and inline code (Markdown). Paste an image to upload it.',
    defaults: () => ({ md: '' }),
    fields: [{ key: 'md', kind: 'markdown', label: 'Text' }],
    render: (d, ctx) => renderMarkdown(d.md, ctx),
  },
  heading: {
    label: 'Heading',
    icon: 'H',
    defaults: () => ({ text: '', level: 2 }),
    fields: [
      { key: 'text', kind: 'text', label: 'Heading' },
      { key: 'level', kind: 'select', label: 'Size', options: [[2, 'Large'], [3, 'Medium'], [4, 'Small']] },
    ],
    render: (d) => h(`h${[2, 3, 4].includes(Number(d.level)) ? Number(d.level) : 2}`, { class: 'blk-heading' }, d.text),
  },
  code: {
    label: 'Code',
    icon: '{}',
    hint: 'Syntax-highlighted source with a copy button.',
    defaults: () => ({ code: '', lang: 'c', filename: '', caption: '' }),
    fields: [
      { key: 'filename', kind: 'text', label: 'File name (optional)', placeholder: 'main.c' },
      { key: 'lang', kind: 'text', label: 'Language', list: CODE_LANGS },
      { key: 'code', kind: 'code', label: 'Code' },
      { key: 'caption', kind: 'text', label: 'Caption (optional)' },
    ],
    render: renderCode,
  },
  image: {
    label: 'Image',
    icon: '▣',
    hint: 'Upload a picture, schematic or screenshot, or link to one.',
    defaults: () => ({ src: '', alt: '', caption: '', size: 'large' }),
    fields: [
      { key: 'src', kind: 'media', label: 'Image', accept: 'image/*' },
      { key: 'alt', kind: 'text', label: 'Description (for screen readers)' },
      { key: 'caption', kind: 'text', label: 'Caption (optional)' },
      { key: 'size', kind: 'select', label: 'Size', options: SIZES },
    ],
    render: (d, ctx) => {
      if (!d.src) return placeholder('No image chosen yet');
      const img = h('img', { src: ctx.resolveMedia(d.src), alt: d.alt || d.caption || '', loading: 'lazy' });
      img.addEventListener('click', () => openLightbox(img.src, d.alt));
      return figure(d, img);
    },
  },
  animation: {
    label: 'Animation / video',
    icon: '▶',
    hint: 'A GIF, animated WebP, MP4 or WebM, e.g. a logic-analyzer capture or a demo of the board.',
    defaults: () => ({ src: '', caption: '', size: 'large', autoplay: true, loop: true, controls: true }),
    fields: [
      { key: 'src', kind: 'media', label: 'Animation or video', accept: 'image/gif,image/webp,image/apng,video/*' },
      { key: 'caption', kind: 'text', label: 'Caption (optional)' },
      { key: 'size', kind: 'select', label: 'Size', options: SIZES },
      { key: 'autoplay', kind: 'checkbox', label: 'Play automatically (video)' },
      { key: 'loop', kind: 'checkbox', label: 'Loop (video)' },
      { key: 'controls', kind: 'checkbox', label: 'Show player controls (video)' },
    ],
    render: renderAnimation,
  },
  steps: {
    label: 'Step-by-step animation',
    icon: '⧗',
    hint: 'Frames that play in order, each with a caption. Great for walking through a protocol or a state machine.',
    defaults: () => ({ frames: [], intervalMs: 2000, autoplay: true, size: 'large' }),
    fields: [
      { key: 'frames', kind: 'frames', label: 'Frames' },
      { key: 'intervalMs', kind: 'number', label: 'Time per frame (ms)', min: 300, step: 100 },
      { key: 'autoplay', kind: 'checkbox', label: 'Play automatically' },
      { key: 'size', kind: 'select', label: 'Size', options: SIZES },
    ],
    render: renderSteps,
  },
  callout: {
    label: 'Callout',
    icon: '!',
    hint: 'A highlighted box for tips, warnings and key takeaways.',
    defaults: () => ({ variant: 'info', title: '', md: '' }),
    fields: [
      {
        key: 'variant',
        kind: 'select',
        label: 'Style',
        options: [['info', 'Info'], ['tip', 'Tip'], ['warning', 'Warning'], ['danger', 'Danger']],
      },
      { key: 'title', kind: 'text', label: 'Title (optional)' },
      { key: 'md', kind: 'markdown', label: 'Text' },
    ],
    render: (d, ctx) =>
      h('aside', { class: `callout callout-${d.variant}` }, d.title && h('div', { class: 'callout-title' }, d.title), renderMarkdown(d.md, ctx)),
  },
  diagram: {
    label: 'Diagram',
    icon: '⬡',
    hint: 'Flowcharts, state machines, sequence and timing diagrams written as Mermaid text.',
    defaults: () => ({ code: 'flowchart LR\n  A[Start] --> B[Next step]', caption: '' }),
    fields: [
      { key: 'code', kind: 'code', label: 'Mermaid diagram', help: 'Syntax: https://mermaid.js.org/intro/' },
      { key: 'caption', kind: 'text', label: 'Caption (optional)' },
    ],
    render: renderDiagram,
  },
  embed: {
    label: 'Embed',
    icon: '⧉',
    hint: 'A YouTube video or any embeddable page, such as a Wokwi simulation.',
    defaults: () => ({ url: '', caption: '', aspect: '16:9' }),
    fields: [
      { key: 'url', kind: 'text', label: 'URL', placeholder: 'https://www.youtube.com/watch?v=…' },
      { key: 'caption', kind: 'text', label: 'Caption (optional)' },
      { key: 'aspect', kind: 'select', label: 'Shape', options: [['16:9', 'Wide 16:9'], ['4:3', 'Classic 4:3'], ['1:1', 'Square']] },
    ],
    render: renderEmbed,
  },
  divider: {
    label: 'Divider',
    icon: '—',
    defaults: () => ({}),
    fields: [],
    render: () => h('hr'),
  },
};

export function blockData(block) {
  const def = BLOCK_TYPES[block.type];
  return def ? { ...def.defaults(), ...block.data } : block.data;
}

// Render a block's content. Never throws: a broken block shows an error box
// instead of taking the whole page down.
export function renderBlockBody(type, data, ctx) {
  const def = BLOCK_TYPES[type];
  if (!def) {
    return h(
      'div',
      { class: 'block-unknown' },
      h('strong', {}, `Unsupported block type “${type}”.`),
      ' It is kept as it is. Reload the site to get the newest version, or edit it as raw data.'
    );
  }
  try {
    return def.render({ ...def.defaults(), ...data }, ctx);
  } catch (err) {
    console.error(err);
    return h('div', { class: 'block-unknown' }, `This ${def.label.toLowerCase()} block could not be shown: ${err.message}`);
  }
}

export function blockText(block) {
  const out = [];
  (function collect(value) {
    if (typeof value === 'string' && !value.startsWith('data:')) out.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  })(block.data);
  return out.join(' ');
}

/* ---------- renderers ---------- */

export function renderMarkdown(md, ctx) {
  const wrap = h('div', { class: 'md' });
  if (window.marked && window.DOMPurify) {
    wrap.innerHTML = window.DOMPurify.sanitize(window.marked.parse(md || '', { gfm: true }));
  } else {
    wrap.textContent = md || '';
    wrap.style.whiteSpace = 'pre-wrap';
  }
  wrap.querySelectorAll('img').forEach((img) => {
    img.src = ctx.resolveMedia(img.getAttribute('src'));
    img.loading = 'lazy';
  });
  wrap.querySelectorAll('a[href^="http"]').forEach((a) => {
    a.target = '_blank';
    a.rel = 'noopener';
  });
  wrap.querySelectorAll('pre code').forEach((code) => highlight(code, (code.className.match(/language-(\S+)/) || [])[1]));
  return wrap;
}

function highlight(codeEl, lang) {
  const hljs = window.hljs;
  if (!hljs) return;
  const text = codeEl.textContent;
  try {
    if (lang && hljs.getLanguage(lang)) codeEl.innerHTML = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
    else if (!lang) codeEl.innerHTML = hljs.highlightAuto(text).value;
    codeEl.classList.add('hljs');
  } catch {
    codeEl.textContent = text;
  }
}

function renderCode(d, ctx) {
  const code = h('code', {}, d.code);
  highlight(code, d.lang);
  const lines = d.code.replace(/\n$/, '').split('\n').length;
  const showNumbers = ctx.settings.codeLineNumbers && !ctx.settings.codeWrap;
  const copy = h('button', { class: 'code-copy', type: 'button', title: 'Copy code' }, 'Copy');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(d.code);
      copy.textContent = 'Copied';
    } catch {
      copy.textContent = 'Copy failed';
    }
    setTimeout(() => (copy.textContent = 'Copy'), 1500);
  });
  return h(
    'figure',
    { class: `code-block${ctx.settings.codeWrap ? ' wrap' : ''}` },
    h('div', { class: 'code-head' }, h('span', {}, d.filename || d.lang || 'code'), copy),
    h(
      'div',
      { class: 'code-body' },
      showNumbers && h('pre', { class: 'code-gutter', 'aria-hidden': 'true' }, Array.from({ length: lines }, (_, i) => i + 1).join('\n')),
      h('pre', { class: 'code-main' }, code)
    ),
    d.caption && h('figcaption', {}, d.caption)
  );
}

function figure(d, media) {
  return h('figure', { class: `media size-${d.size || 'large'}` }, media, d.caption && h('figcaption', {}, d.caption));
}

function placeholder(text) {
  return h('div', { class: 'placeholder' }, text);
}

function isVideo(src) {
  return /^data:video\//.test(src) || /\.(mp4|webm|ogv|ogg|mov|m4v)([?#]|$)/i.test(src);
}

function renderAnimation(d, ctx) {
  if (!d.src) return placeholder('No animation chosen yet');
  const src = ctx.resolveMedia(d.src);
  if (!isVideo(src)) {
    const img = h('img', { src, alt: d.caption || '', loading: 'lazy' });
    img.addEventListener('click', () => openLightbox(src, d.caption));
    return figure(d, img);
  }
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.loop = d.loop;
  video.controls = d.controls;
  video.preload = 'metadata';
  video.autoplay = d.autoplay && !prefersReducedMotion();
  video.src = src;
  return figure(d, video);
}

function renderSteps(d, ctx) {
  const frames = Array.isArray(d.frames) ? d.frames : [];
  if (!frames.length) return placeholder('No frames yet');
  let index = 0;
  let playing = d.autoplay && !prefersReducedMotion() && frames.length > 1;
  let timer = null;

  const stage = h('div', { class: 'steps-stage' });
  const caption = h('div', { class: 'steps-caption' });
  const counter = h('span', { class: 'steps-count' });
  const playBtn = h('button', { type: 'button', class: 'btn small' });
  const dots = h(
    'div',
    { class: 'steps-dots' },
    frames.map((_, i) => h('button', { type: 'button', 'aria-label': `Frame ${i + 1}`, onClick: () => go(i, true) }))
  );
  const root = h(
    'figure',
    { class: `steps media size-${d.size}` },
    stage,
    caption,
    h(
      'div',
      { class: 'steps-controls' },
      h('button', { type: 'button', class: 'btn small', 'aria-label': 'Previous frame', onClick: () => go(index - 1, true) }, '◀'),
      playBtn,
      h('button', { type: 'button', class: 'btn small', 'aria-label': 'Next frame', onClick: () => go(index + 1, true) }, '▶'),
      counter,
      dots
    )
  );

  // Preload images so frames swap without flicker.
  frames.forEach((f) => f.src && (new Image().src = ctx.resolveMedia(f.src)));

  function show() {
    const f = frames[index];
    stage.replaceChildren(
      f.src
        ? h('img', { src: ctx.resolveMedia(f.src), alt: f.caption || `Frame ${index + 1}` })
        : h('div', { class: 'steps-text' }, f.caption || '')
    );
    stage.firstChild.classList.add('steps-enter');
    caption.replaceChildren(f.src && f.caption ? renderMarkdown(f.caption, ctx) : '');
    counter.textContent = `${index + 1} / ${frames.length}`;
    [...dots.children].forEach((dot, i) => dot.classList.toggle('active', i === index));
    playBtn.textContent = playing ? '❚❚ Pause' : '▶ Play';
  }
  function go(i, byUser) {
    index = (i + frames.length) % frames.length;
    if (byUser) setPlaying(false);
    show();
  }
  function setPlaying(on) {
    playing = on;
    clearInterval(timer);
    if (on) {
      timer = setInterval(() => {
        if (!root.isConnected) return clearInterval(timer);
        go(index + 1, false);
      }, Math.max(300, Number(d.intervalMs) || 2000));
    }
    show();
  }
  playBtn.addEventListener('click', () => setPlaying(!playing));
  // Start once attached so the first tick sees the element in the page.
  requestAnimationFrame(() => setPlaying(playing));
  show();
  return root;
}

let mermaidPromise = null;
let mermaidTheme = null;
let diagramCount = 0;

function loadMermaid() {
  // Mermaid is large, so it is only fetched when a page has a diagram.
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

function renderDiagram(d) {
  const box = h('div', { class: 'diagram' }, h('span', { class: 'muted' }, 'Drawing diagram…'));
  const id = `mmd-${++diagramCount}`;
  loadMermaid()
    .then((mermaid) => mermaid.render(id, d.code))
    .then(({ svg }) => (box.innerHTML = svg))
    .catch((err) => {
      document.getElementById(`d${id}`)?.remove(); // Mermaid leaves its scratch element behind on errors.
      box.replaceChildren(h('div', { class: 'block-unknown' }, `Diagram error: ${err.message || err}`), h('pre', {}, d.code));
    });
  return h('figure', { class: 'media size-large' }, box, d.caption && h('figcaption', {}, d.caption));
}

function embedUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.replace(/^www\.|^m\./, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1);
  else if (host === 'youtube.com' && u.pathname === '/watch') id = u.searchParams.get('v');
  else if (host === 'youtube.com' && /^\/(shorts|embed|live)\//.test(u.pathname)) id = u.pathname.split('/')[2];
  if (id) return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`;
  return u.href;
}

function renderEmbed(d) {
  if (!d.url) return placeholder('No URL yet');
  const src = embedUrl(d.url);
  if (!src) return placeholder('That URL cannot be embedded. Use an https:// link.');
  const ratio = { '16:9': '16 / 9', '4:3': '4 / 3', '1:1': '1 / 1' }[d.aspect] || '16 / 9';
  return h(
    'figure',
    { class: 'media size-large' },
    h('iframe', {
      src,
      style: `aspect-ratio: ${ratio}`,
      loading: 'lazy',
      allow: 'accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen',
      allowfullscreen: true,
      referrerpolicy: 'strict-origin-when-cross-origin',
      title: d.caption || 'Embedded content',
    }),
    h('figcaption', {}, d.caption || '', ' ', h('a', { href: d.url, target: '_blank', rel: 'noopener' }, 'Open ↗'))
  );
}

function openLightbox(src, alt) {
  const dialog = h('dialog', { class: 'lightbox' }, h('img', { src, alt: alt || '' }));
  dialog.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

/* ---------- editor ---------- */

// Build the editing panel for a block. The same panel is generated from each
// type's `fields`, so an improvement to a field editor reaches every block.
export function buildBlockEditor(block, ctx, { onDone, onCancel }) {
  const def = BLOCK_TYPES[block.type];
  const draft = structuredClone(def ? { ...def.defaults(), ...block.data } : block.data);
  const preview = h('div', { class: 'editor-preview' });
  const refresh = debounce(() => preview.replaceChildren(renderBlockBody(block.type, draft, ctx)), 250);

  let fields;
  let readDraft = () => draft;
  if (def) {
    fields = def.fields.map((f) => fieldEditor(f, draft, ctx, refresh));
  } else {
    const ta = h('textarea', { class: 'mono', rows: 12, spellcheck: 'false', value: JSON.stringify(block.data, null, 2) });
    fields = [h('label', { class: 'field' }, h('span', {}, `Raw data for “${block.type}”`), ta)];
    readDraft = () => JSON.parse(ta.value);
  }

  const panel = h(
    'div',
    { class: 'block-editor' },
    h('div', { class: 'editor-title' }, def ? `${def.icon} ${def.label}` : block.type, def?.hint && h('span', { class: 'muted' }, ` · ${def.hint}`)),
    h('div', { class: 'editor-fields' }, fields),
    def && def.fields.length ? h('div', { class: 'editor-preview-label' }, 'Preview') : null,
    def && def.fields.length ? preview : null,
    h(
      'div',
      { class: 'editor-actions' },
      h('button', { type: 'button', class: 'btn', onClick: onCancel }, 'Cancel'),
      h(
        'button',
        {
          type: 'button',
          class: 'btn primary',
          onClick: () => {
            try {
              onDone(readDraft());
            } catch (err) {
              toast(`Could not apply: ${err.message}`, 'error');
            }
          },
        },
        'Done'
      )
    )
  );
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      panel.querySelector('.btn.primary').click();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      onCancel();
    }
  });
  if (def && def.fields.length) preview.replaceChildren(renderBlockBody(block.type, draft, ctx));
  return panel;
}

function fieldEditor(field, draft, ctx, changed) {
  const set = (value) => {
    draft[field.key] = value;
    changed();
  };
  const wrap = (control) =>
    h('label', { class: 'field' }, h('span', {}, field.label), control, field.help && h('small', { class: 'muted' }, field.help));

  switch (field.kind) {
    case 'text': {
      const listId = field.list ? `list-${field.key}-${Math.random().toString(36).slice(2, 7)}` : null;
      return wrap([
        h('input', {
          type: 'text',
          value: draft[field.key] ?? '',
          placeholder: field.placeholder || '',
          list: listId,
          onInput: (e) => set(e.target.value),
        }),
        listId && h('datalist', { id: listId }, field.list.map((v) => h('option', { value: v }))),
      ]);
    }
    case 'number':
      return wrap(
        h('input', {
          type: 'number',
          value: draft[field.key],
          min: field.min,
          step: field.step,
          onInput: (e) => set(Number(e.target.value)),
        })
      );
    case 'checkbox':
      return h(
        'label',
        { class: 'field checkbox' },
        h('input', { type: 'checkbox', checked: Boolean(draft[field.key]), onChange: (e) => set(e.target.checked) }),
        h('span', {}, field.label)
      );
    case 'select':
      return wrap(
        h(
          'select',
          {
            onChange: (e) => {
              const option = field.options.find(([v]) => String(v) === e.target.value);
              set(option ? option[0] : e.target.value);
            },
          },
          field.options.map(([v, label]) => h('option', { value: v, selected: String(v) === String(draft[field.key]) }, label))
        )
      );
    case 'code':
      return wrap(codeArea(draft[field.key] ?? '', set));
    case 'markdown':
      return wrap(markdownEditor(draft[field.key] ?? '', set, ctx));
    case 'media':
      return wrap(mediaInput(draft[field.key] ?? '', set, ctx, field.accept));
    case 'frames':
      return h('div', { class: 'field' }, h('span', {}, field.label), framesEditor(draft, field.key, ctx, changed));
    default:
      return wrap(h('input', { type: 'text', value: draft[field.key] ?? '', onInput: (e) => set(e.target.value) }));
  }
}

function autoGrow(ta) {
  const grow = () => {
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight + 2, window.innerHeight * 0.7)}px`;
  };
  ta.addEventListener('input', grow);
  requestAnimationFrame(grow);
  return ta;
}

function codeArea(value, set) {
  const ta = h('textarea', { class: 'mono', rows: 8, spellcheck: 'false', value, onInput: (e) => set(e.target.value) });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      insertAtCursor(ta, '    ');
    }
  });
  return autoGrow(ta);
}

function insertAtCursor(ta, text) {
  ta.focus();
  if (!document.execCommand('insertText', false, text)) {
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
  }
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

function surround(ta, before, after, fallback) {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const selected = value.slice(s, e) || fallback;
  insertAtCursor(ta, before + selected + after);
  ta.setSelectionRange(s + before.length, s + before.length + selected.length);
}

function prefixLines(ta, prefix) {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const lineStart = value.lastIndexOf('\n', s - 1) + 1;
  ta.setSelectionRange(lineStart, e);
  const lines = value.slice(lineStart, e).split('\n');
  insertAtCursor(ta, lines.map((l, i) => (typeof prefix === 'function' ? prefix(i) : prefix) + l).join('\n'));
}

function markdownEditor(value, set, ctx) {
  const ta = autoGrow(h('textarea', { rows: 6, value, onInput: (e) => set(e.target.value) }));

  async function uploadInto(file) {
    const marker = `![Uploading ${file.name}…]()`;
    insertAtCursor(ta, marker);
    try {
      const src = await ctx.uploadMedia(file);
      ta.value = ta.value.replace(marker, `![${file.name.replace(/\.[^.]+$/, '')}](${src})`);
    } catch (err) {
      ta.value = ta.value.replace(marker, '');
      toast(err.message, 'error');
    }
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  const picker = h('input', {
    type: 'file',
    accept: 'image/*',
    hidden: true,
    onChange: (e) => {
      [...e.target.files].forEach(uploadInto);
      e.target.value = '';
    },
  });
  const tool = (label, title, action) =>
    h('button', { type: 'button', class: 'btn small', title, onMousedown: (e) => e.preventDefault(), onClick: action }, label);

  ta.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      e.preventDefault();
      files.forEach(uploadInto);
    }
  });
  ta.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      e.preventDefault();
      files.forEach(uploadInto);
    }
  });
  ta.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key === 'b') (e.preventDefault(), surround(ta, '**', '**', 'bold'));
    if (e.key === 'i') (e.preventDefault(), surround(ta, '_', '_', 'italic'));
    if (e.key === 'k') (e.preventDefault(), surround(ta, '[', '](https://)', 'link'));
  });

  return h(
    'div',
    { class: 'md-editor' },
    h(
      'div',
      { class: 'md-toolbar' },
      tool('B', 'Bold (Ctrl+B)', () => surround(ta, '**', '**', 'bold')),
      tool('I', 'Italic (Ctrl+I)', () => surround(ta, '_', '_', 'italic')),
      tool('`x`', 'Inline code', () => surround(ta, '`', '`', 'code')),
      tool('H', 'Heading', () => prefixLines(ta, '### ')),
      tool('• List', 'Bulleted list', () => prefixLines(ta, '- ')),
      tool('1. List', 'Numbered list', () => prefixLines(ta, (i) => `${i + 1}. `)),
      tool('☐ Todo', 'Checklist', () => prefixLines(ta, '- [ ] ')),
      tool('Link', 'Link (Ctrl+K)', () => surround(ta, '[', '](https://)', 'link')),
      tool('Table', 'Insert table', () => insertAtCursor(ta, '\n| Register | Bit | Meaning |\n|---|---|---|\n|  |  |  |\n')),
      tool('```', 'Code block', () => surround(ta, '\n```c\n', '\n```\n', 'code')),
      tool('Image', 'Upload an image', () => picker.click()),
      picker
    ),
    ta
  );
}

function mediaInput(value, set, ctx, accept) {
  const input = h('input', { type: 'text', value: value.startsWith('data:') ? '(embedded file)' : value, placeholder: 'Upload a file, or paste a URL' });
  const thumb = h('div', { class: 'media-thumb' });
  const status = h('small', { class: 'muted' });
  const showThumb = (src) => {
    if (!src) return thumb.replaceChildren();
    const resolved = ctx.resolveMedia(src);
    thumb.replaceChildren(isVideo(resolved) ? h('video', { src: resolved, muted: true }) : h('img', { src: resolved, alt: '' }));
  };
  input.addEventListener('input', () => {
    set(input.value.trim());
    showThumb(input.value.trim());
  });
  const picker = h('input', {
    type: 'file',
    accept,
    hidden: true,
    onChange: async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      status.textContent = `Uploading ${file.name}…`;
      try {
        const src = await ctx.uploadMedia(file);
        input.value = src.startsWith('data:') ? '(embedded file)' : src;
        set(src);
        showThumb(src);
        status.textContent = '';
      } catch (err) {
        status.textContent = '';
        toast(err.message, 'error');
      }
    },
  });
  showThumb(value);
  return h(
    'div',
    { class: 'media-input' },
    h('div', { class: 'row' }, input, h('button', { type: 'button', class: 'btn', onClick: () => picker.click() }, 'Upload…'), picker),
    status,
    thumb
  );
}

function framesEditor(draft, key, ctx, changed) {
  if (!Array.isArray(draft[key])) draft[key] = [];
  const frames = draft[key];
  const list = h('div', { class: 'frames' });
  const redraw = () => {
    list.replaceChildren(
      ...frames.map((frame, i) =>
        h(
          'div',
          { class: 'frame' },
          h(
            'div',
            { class: 'frame-head' },
            h('strong', {}, `Frame ${i + 1}`),
            h('span', { class: 'spacer' }),
            h('button', { type: 'button', class: 'btn small', disabled: i === 0, onClick: () => move(i, -1) }, '↑'),
            h('button', { type: 'button', class: 'btn small', disabled: i === frames.length - 1, onClick: () => move(i, 1) }, '↓'),
            h('button', { type: 'button', class: 'btn small danger', onClick: () => (frames.splice(i, 1), redraw(), changed()) }, 'Remove')
          ),
          h('label', { class: 'field' }, h('span', {}, 'Picture (optional)'), mediaInput(frame.src || '', (v) => ((frame.src = v), changed()), ctx, 'image/*')),
          h(
            'label',
            { class: 'field' },
            h('span', {}, 'Caption'),
            autoGrow(h('textarea', { rows: 2, value: frame.caption || '', onInput: (e) => ((frame.caption = e.target.value), changed()) }))
          )
        )
      ),
      h('button', { type: 'button', class: 'btn', onClick: () => (frames.push({ src: '', caption: '' }), redraw(), changed()) }, '+ Add frame')
    );
  };
  const move = (i, delta) => {
    const [f] = frames.splice(i, 1);
    frames.splice(i + delta, 0, f);
    redraw();
    changed();
  };
  redraw();
  return list;
}
