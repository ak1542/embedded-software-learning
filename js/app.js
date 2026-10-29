import { h, fill, debounce, toast } from './dom.js';
import { migrate } from './schema.js';
import * as model from './model.js';
import * as store from './storage.js';
import { renderDiagram } from './diagram.js';
import { createToolbar } from './toolbar.js';

const state = {
  nb: null,
  sha: null, // version of content/notebook.json the edits are based on
  source: 'site',
  currentId: null,
  edit: false,
  dirty: false,
  saving: false,
  query: '',
  editor: null,
};

const COLLAPSED_KEY = 'esl.collapsed';
let collapsed = new Set();
try {
  collapsed = new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY)) || []);
} catch {
  /* start expanded */
}

const $ = (sel) => document.querySelector(sel);

let lib = null; // the editor bundle, loaded once
let toolbar = null;

/* ---------- startup ---------- */

async function init() {
  wireChrome();
  let loaded;
  try {
    loaded = await store.loadNotebook();
  } catch (err) {
    if (!store.isConnected()) return fatal(err);
    toast(`Could not load from GitHub (${err.message}). Showing the published copy.`, 'error', 7000);
    try {
      const res = await fetch(store.NOTEBOOK_PATH, { cache: 'no-store' });
      loaded = { notebook: await res.json(), sha: null, source: 'site' };
    } catch (err2) {
      return fatal(err2);
    }
  }
  try {
    state.nb = migrate(loaded.notebook);
    lib = await import('../vendor/editor.bundle.js');
  } catch (err) {
    return fatal(err);
  }
  toolbar = createToolbar({
    languages: lib.CODE_LANGUAGES,
    defaultDiagram: lib.DEFAULT_DIAGRAM,
    insertFiles,
    addAnimation: openAnimationDialog,
  });
  state.sha = loaded.sha;
  state.source = loaded.source;
  restoreDraft();
  applySettings();
  route();
  window.addEventListener('hashchange', route);
}

function restoreDraft() {
  const draft = store.loadDraft();
  if (!draft || !draft.notebook) return;
  const when = new Date(draft.savedAt).toLocaleString();
  const sameBase = draft.baseSha === state.sha;
  const keep =
    sameBase ||
    confirm(
      `You have unsaved changes from ${when}, but the notes were saved from somewhere else since then.\n\n` +
        'OK = keep my unsaved changes (saving will replace the newer version)\nCancel = discard them and use the latest notes'
    );
  if (!keep) return store.clearDraft();
  try {
    state.nb = migrate(draft.notebook);
    state.dirty = true;
    if (sameBase) toast(`Restored unsaved changes from ${when}.`);
  } catch (err) {
    toast(`Could not restore unsaved changes: ${err.message}`, 'error');
  }
}

function fatal(err) {
  console.error(err);
  fill($('#main'), h('div', { class: 'empty' }, h('h1', {}, 'Could not open the notes'), h('p', {}, err.message)));
}

/* ---------- state changes ---------- */

function markDirty() {
  state.dirty = true;
  if (!store.saveDraft(state.nb, state.sha)) toast("Browser storage is full: save to GitHub soon so you don't lose changes.", 'error');
  updateSaveButton();
}

function commit(mutate, { rerender = true } = {}) {
  flushDoc();
  mutate();
  markDirty();
  if (rerender) render();
}

function currentNode() {
  return state.currentId ? model.locate(state.nb, state.currentId)?.node : null;
}

function go(id) {
  location.hash = id ? `#/${id}` : '#/';
}

function route() {
  flushDoc();
  const id = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const exists = id && model.locate(state.nb, id);
  state.currentId = exists ? id : state.nb.sections[0]?.id || null;
  document.body.classList.remove('nav-open');
  render();
  window.scrollTo(0, 0);
}

/* ---------- the page editor ---------- */

// Edits are copied from the editor into the notebook shortly after typing stops, and always
// before anything that reads or replaces the notebook (saving, switching sections, ...).
let pending = null;
const scheduleFlush = debounce(() => flushDoc(), 300);

function flushDoc() {
  if (!pending) return;
  const { node, editor } = pending;
  pending = null;
  if (!editor.isDestroyed) node.doc = editor.getJSON();
  markDirty();
}

function destroyEditor() {
  flushDoc();
  if (state.editor) state.editor.destroy();
  state.editor = null;
}

function mountEditor(node, host) {
  destroyEditor();
  const editor = lib.createEditor(host, {
    content: node.doc,
    editable: state.edit,
    hooks: {
      resolveMedia: store.resolveMedia,
      renderDiagram,
      insertFiles,
      addAnimation: (html, pos) => addAnimationFromSource(html, pos).catch((err) => toast(err.message, 'error', 6000)),
      confirmAnimation: () => confirm('This looks like a web page. Add it as an animation?\n\nOK = add it as an animation\nCancel = paste it as plain text'),
    },
    numbering: Boolean(state.nb.settings.numbering),
    onUpdate: (ed) => {
      pending = { node, editor: ed };
      scheduleFlush();
      scheduleOutline();
    },
  });
  state.editor = editor;
  toolbar.bind(editor);
}

/* ---------- "On this page": an outline built from the headings ---------- */

const scheduleOutline = debounce(() => refreshOutline(), 250);
let spyQueued = false;
let spyLockedUntil = 0;

function pageHeadings() {
  return [...document.querySelectorAll('.doc .ProseMirror h1, .doc .ProseMirror h2, .doc .ProseMirror h3, .doc .ProseMirror h4')].filter((el) => el.textContent.trim());
}

function refreshOutline() {
  const headings = pageHeadings();
  const minLevel = Math.min(...headings.map((el) => Number(el.tagName[1])));
  const links = () =>
    headings.map((el, i) =>
      h(
        'a',
        {
          href: '#outline',
          class: 'lvl',
          style: `padding-left:${8 + (Number(el.tagName[1]) - minLevel) * 14}px`,
          onClick: (e) => {
            e.preventDefault();
            pageHeadings()[i]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            // A short page cannot scroll far enough to bring the last headings to the top.
            spyLockedUntil = Date.now() + 1200;
            document.querySelectorAll('.outline-list').forEach((list) => [...list.children].forEach((a, j) => a.classList.toggle('active', j === i)));
          },
        },
        el.dataset.num ? h('span', { class: 'num' }, el.dataset.num) : null,
        el.textContent.trim()
      )
    );
  document.querySelectorAll('.outline-list').forEach((list) => fill(list, links()));
  $('#outline').hidden = !headings.length;
  document.querySelectorAll('.outline-inline').forEach((box) => (box.hidden = !headings.length));
  updateOutlineSpy();
}

// Highlight the heading that is currently at the top of the screen.
function updateOutlineSpy() {
  spyQueued = false;
  if (Date.now() < spyLockedUntil) return;
  const headings = pageHeadings();
  let active = -1;
  headings.forEach((el, i) => {
    if (el.getBoundingClientRect().top <= 140) active = i;
  });
  document.querySelectorAll('.outline-list').forEach((list) => {
    [...list.children].forEach((a, i) => a.classList.toggle('active', i === active));
  });
}

// Upload pictures and videos (from the toolbar, paste or drag and drop) and put them in the page.
async function insertFiles(files, pos) {
  const editor = state.editor;
  let at = pos;
  for (const file of files) {
    if (!editor || editor.isDestroyed) return;
    try {
      if (file.type === 'text/html' || /\.html?$/i.test(file.name)) {
        const html = await file.text();
        if (!/<[a-z!]/i.test(html)) throw new Error(`${file.name} does not look like an HTML page.`);
        if (store.isConnected()) toast(`Uploading ${file.name}…`, 'info', 10000);
        await addAnimationFromSource(html, at);
        at = null;
        toast('Animation added. Click “Done editing” to play it.', 'success', 5000);
        continue;
      }
      const isVideo = file.type.startsWith('video/');
      if (store.isConnected()) toast(`Uploading ${file.name}…`, 'info', 10000);
      const src = await store.uploadMedia(file);
      if (editor.isDestroyed) return;
      const node = isVideo
        ? { type: 'video', attrs: { src } }
        : { type: 'image', attrs: { src, alt: file.name.replace(/\.[^.]+$/, ''), width: null } };
      const chain = editor.chain().focus();
      (at == null ? chain.insertContent(node) : chain.insertContentAt(at, node)).run();
      at = null;
      toast('Added.', 'success', 1500);
    } catch (err) {
      toast(err.message, 'error', 6000);
    }
  }
}

// Animations are self-contained HTML pages. They are stored as a file next to the notes and
// shown in a sandboxed frame (see editor/src/anim.js).
function openAnimationDialog() {
  $('#anim-code').value = '';
  $('#anim-file').value = '';
  $('#anim-status').textContent = '';
  $('#anim-insert').disabled = false;
  $('#anim-dialog').showModal();
}

function prepareAnimationHtml(code) {
  let html = code.trim();
  if (!/<meta[^>]+charset/i.test(html)) {
    html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}<meta charset="utf-8">`) : `<meta charset="utf-8">${html}`;
  }
  if (!/<meta[^>]+viewport/i.test(html)) html = html.replace(/<meta charset="utf-8">/i, '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">');
  return html;
}

// Save an animation's HTML as a file and put it in the page (at a position, or at the cursor).
async function addAnimationFromSource(source, pos = null) {
  const editor = state.editor;
  const file = new File([prepareAnimationHtml(source)], 'animation.html', { type: 'text/html' });
  const src = await store.uploadMedia(file);
  if (!editor || editor.isDestroyed) return false;
  const node = { type: 'htmlAnimation', attrs: { src, title: 'Animation', height: 420, width: 100 } };
  const chain = editor.chain().focus();
  (pos == null ? chain.insertContent(node) : chain.insertContentAt(pos, node)).run();
  return true;
}

async function insertAnimation() {
  const status = $('#anim-status');
  const chosen = $('#anim-file').files[0];
  const code = $('#anim-code').value;
  if (!chosen && !code.trim()) return (status.textContent = 'Paste the HTML code or choose a file first.');
  const source = chosen ? await chosen.text() : code;
  if (!/<[a-z!]/i.test(source)) return (status.textContent = 'That does not look like HTML code.');
  $('#anim-insert').disabled = true;
  status.textContent = 'Saving…';
  try {
    await addAnimationFromSource(source);
    $('#anim-dialog').close();
    toast('Animation added. Click “Done editing” to play it.', 'success', 5000);
  } catch (err) {
    status.textContent = err.message;
    $('#anim-insert').disabled = false;
  }
}

/* ---------- settings ---------- */

function applySettings() {
  const s = state.nb.settings;
  const root = document.documentElement;
  root.dataset.theme = s.theme;
  root.dataset.codeWrap = String(Boolean(s.codeWrap));
  root.dataset.numbering = String(Boolean(s.numbering));
  root.style.setProperty('--font-size', `${Number(s.fontSize) || 16}px`);
  root.dataset.width = s.contentWidth;
  document.title = s.title;
  $('#site-title').textContent = s.title;
}

/* ---------- rendering ---------- */

function render() {
  document.body.classList.toggle('editing', state.edit);
  $('#edit-toggle').textContent = state.edit ? 'Done editing' : 'Edit';
  $('#edit-toggle').classList.toggle('primary', state.edit);
  updateSaveButton();
  renderSidebar();
  renderMain();
}

function updateSaveButton() {
  const btn = $('#save');
  btn.hidden = !state.dirty && !state.edit;
  btn.disabled = state.saving || !state.dirty;
  btn.textContent = state.saving ? 'Saving…' : state.dirty ? 'Save' : 'Saved';
  btn.classList.toggle('attention', state.dirty && !state.saving);
}

let numbers = null; // section id -> "1.2" when numbering is on

function renderSidebar() {
  const nav = $('#tree');
  const q = state.query.trim().toLowerCase();
  numbers = state.nb.settings.numbering ? model.sectionNumbers(state.nb) : null;
  if (q) {
    const results = model.flatten(state.nb).filter((n) => `${n.title} ${model.docText(n.doc)}`.toLowerCase().includes(q));
    fill(
      nav,
      results.length
        ? h('ul', { class: 'results' }, results.map((n) => h('li', {}, treeLink(n, model.locate(state.nb, n.id).path))))
        : h('p', { class: 'muted pad' }, 'No matches.')
    );
    return;
  }
  const openPath = new Set((model.locate(state.nb, state.currentId)?.path || []).map((n) => n.id));
  numbers = state.nb.settings.numbering ? model.sectionNumbers(state.nb) : null;
  const list = (nodes) =>
    h(
      'ul',
      {},
      nodes.map((n) => {
        const hasKids = n.children.length > 0;
        const open = hasKids && (openPath.has(n.id) || !collapsed.has(n.id));
        return h(
          'li',
          { class: open ? 'open' : '' },
          h(
            'div',
            { class: 'tree-row' },
            hasKids
              ? h('button', { class: 'caret', type: 'button', 'aria-label': open ? 'Collapse' : 'Expand', 'aria-expanded': String(open), onClick: () => toggleCollapsed(n.id, open) }, '▸')
              : h('span', { class: 'caret-space' }),
            treeLink(n)
          ),
          open && list(n.children)
        );
      })
    );
  fill(
    nav,
    state.nb.sections.length ? list(state.nb.sections) : h('p', { class: 'muted pad' }, 'No sections yet.'),
    state.edit && h('button', { class: 'btn block-btn', type: 'button', onClick: () => addSection(null) }, '+ New section')
  );
}

function treeLink(node, path) {
  return h(
    'a',
    {
      href: `#/${node.id}`,
      class: node.id === state.currentId ? 'active' : '',
      'aria-current': node.id === state.currentId ? 'page' : null,
    },
    path && path.length > 1 ? h('small', { class: 'muted' }, path.slice(0, -1).map((p) => p.title).join(' › ') + ' › ') : null,
    numbers && numbers.get(node.id) ? h('span', { class: 'num' }, numbers.get(node.id)) : null,
    node.title || 'Untitled'
  );
}

function toggleCollapsed(id, isOpen) {
  if (isOpen) collapsed.add(id);
  else collapsed.delete(id);
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
  } catch {
    /* not remembered */
  }
  renderSidebar();
}

function renderMain() {
  const main = $('#main');
  const node = currentNode();
  if (!node) {
    destroyEditor();
    $('#outline').hidden = true;
    fill(
      main,
      h(
        'div',
        { class: 'empty' },
        h('h1', {}, state.nb.settings.title),
        h('p', {}, 'There are no sections yet.'),
        h('button', { class: 'btn primary', type: 'button', onClick: () => (state.edit || toggleEdit(), addSection(null)) }, '+ Create the first section')
      )
    );
    return;
  }
  const loc = model.locate(state.nb, node.id);
  const flat = model.flatten(state.nb);
  const pos = flat.indexOf(node);
  const host = h('div', { class: 'doc' });

  fill(
    main,
    h(
      'nav',
      { class: 'crumbs', 'aria-label': 'Breadcrumb' },
      loc.path.slice(0, -1).map((p) => [h('a', { href: `#/${p.id}` }, p.title), h('span', { 'aria-hidden': 'true' }, ' › ')])
    ),
    state.edit ? sectionToolbar(node, loc) : null,
    state.edit
      ? h('input', {
          class: 'title-input',
          value: node.title,
          'aria-label': 'Section title',
          placeholder: 'Section title',
          onInput: (e) => commit(() => (node.title = e.target.value), { rerender: false }),
          onChange: () => renderSidebar(),
        })
      : h('h1', { class: 'page-title' }, node.title || 'Untitled'),
    state.edit ? toolbar.el : null,
    h('details', { class: 'outline-inline', hidden: true }, h('summary', {}, 'On this page'), h('nav', { class: 'outline-list' })),
    host,
    renderChildren(node),
    h(
      'nav',
      { class: 'pager' },
      pos > 0 ? h('a', { href: `#/${flat[pos - 1].id}`, class: 'prev' }, h('small', {}, '← Previous'), flat[pos - 1].title) : h('span'),
      pos < flat.length - 1 ? h('a', { href: `#/${flat[pos + 1].id}`, class: 'next' }, h('small', {}, 'Next →'), flat[pos + 1].title) : h('span')
    )
  );
  mountEditor(node, host);
  refreshOutline();
}

function sectionToolbar(node, loc) {
  const btn = (label, title, onClick, disabled = false) => h('button', { type: 'button', class: 'btn small', title, disabled, onClick }, label);
  return h(
    'div',
    { class: 'section-toolbar' },
    btn('+ Subsection', 'Add a subsection inside this section', () => addSection(node.id)),
    btn('↑', 'Move up', () => commit(() => model.moveNode(state.nb, node.id, -1)), loc.index === 0),
    btn('↓', 'Move down', () => commit(() => model.moveNode(state.nb, node.id, 1)), loc.index === loc.list.length - 1),
    btn('→ Indent', 'Make it a subsection of the section above', () => commit(() => model.indentNode(state.nb, node.id)), loc.index === 0),
    btn('← Outdent', 'Move it up one level', () => commit(() => model.outdentNode(state.nb, node.id)), !loc.parent),
    h('span', { class: 'spacer' }),
    h('button', { type: 'button', class: 'btn small danger', onClick: () => deleteSection(node) }, 'Delete section')
  );
}

function renderChildren(node) {
  if (!node.children.length) return null;
  return h(
    'section',
    { class: 'children' },
    h('h2', {}, 'Subsections'),
    h(
      'div',
      { class: 'cards' },
      node.children.map((c) => {
        const subs = model.countSubsections(c);
        const meta = [model.isEmptyDoc(c.doc) ? 'Empty' : null, subs ? `${subs} subsection${subs === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ');
        return h('a', { class: 'card', href: `#/${c.id}` }, h('strong', {}, c.title || 'Untitled'), meta && h('small', { class: 'muted' }, meta));
      })
    )
  );
}

/* ---------- actions ---------- */

function toggleEdit() {
  flushDoc();
  state.edit = !state.edit;
  if (state.edit && !store.isConnected()) {
    toast('Editing in this browser only. Connect GitHub in Settings to save your notes online.', 'info', 6000);
  }
  render();
}

function addSection(parentId) {
  const title = prompt(parentId ? 'Subsection title' : 'Section title');
  if (title === null) return;
  let node;
  commit(() => (node = model.addNode(state.nb, parentId, title.trim() || 'Untitled')), { rerender: false });
  if (parentId) collapsed.delete(parentId);
  state.edit = true;
  if (location.hash === `#/${node.id}`) render();
  else go(node.id);
}

function deleteSection(node) {
  const subs = model.countSubsections(node);
  const extra = subs ? ` and its ${subs} subsection${subs === 1 ? '' : 's'}` : '';
  if (!confirm(`Delete “${node.title}”${extra}?\n\nYou can still undo by closing without saving, or from the GitHub history after saving.`)) return;
  let loc;
  commit(() => (loc = model.removeNode(state.nb, node.id)), { rerender: false });
  const next = loc.parent || loc.list[Math.min(loc.index, loc.list.length - 1)] || state.nb.sections[0];
  if (next && location.hash !== `#/${next.id}`) go(next.id);
  else route();
}

async function save() {
  flushDoc();
  if (!state.dirty || state.saving) return;
  if (!store.isConnected()) {
    openSettings();
    toast('Connect GitHub to save your notes online. Until then they are kept in this browser.', 'info', 6000);
    return;
  }
  state.saving = true;
  updateSaveButton();
  const message = `Update notes: ${currentNode()?.title || state.nb.settings.title}`;
  try {
    state.sha = await store.saveNotebook(state.nb, state.sha, message);
    state.dirty = false;
    state.source = 'github';
    store.clearDraft();
    toast('Saved. The public site updates within a minute or two.', 'success');
  } catch (err) {
    if (err.status === 409 || err.status === 422) {
      const overwrite = confirm(
        'The notes were changed from another device or tab since you opened them.\n\n' +
          'OK = save my version anyway (replaces the other changes; they stay in the GitHub history)\nCancel = keep editing (reload later to see the other changes)'
      );
      if (overwrite) {
        try {
          state.sha = await store.saveNotebook(state.nb, await store.latestSha(), message);
          state.dirty = false;
          store.clearDraft();
          toast('Saved.', 'success');
        } catch (err2) {
          toast(`Save failed: ${err2.message}`, 'error', 7000);
        }
      }
    } else {
      toast(`Save failed: ${err.message}`, 'error', 7000);
    }
  } finally {
    state.saving = false;
    updateSaveButton();
  }
}

/* ---------- settings dialog ---------- */

function openSettings() {
  const dialog = $('#settings');
  const s = state.nb.settings;
  const cfg = store.getConfig() || { ...store.guessRepo(), branch: 'main', token: '' };
  const f = dialog.querySelector('form').elements;
  f.owner.value = cfg.owner || '';
  f.repo.value = cfg.repo || '';
  f.branch.value = cfg.branch || 'main';
  f.token.value = cfg.token || '';
  f.title.value = s.title;
  f.theme.value = s.theme;
  f.fontSize.value = s.fontSize;
  f.contentWidth.value = s.contentWidth;
  f.codeWrap.checked = s.codeWrap;
  f.numbering.checked = Boolean(s.numbering);
  updateConnectionStatus();
  dialog.showModal();
}

function updateConnectionStatus(message) {
  const el = $('#connection-status');
  const cfg = store.getConfig();
  el.textContent =
    message ||
    (store.isConnected()
      ? `Connected to ${cfg.owner}/${cfg.repo} (${cfg.branch || 'main'}). Saves go straight to GitHub.`
      : 'Not connected: you can read the notes, and edits stay in this browser until you connect.');
  $('#disconnect').hidden = !store.isConnected();
}

async function connect() {
  const f = $('#settings form').elements;
  const cfg = { owner: f.owner.value.trim(), repo: f.repo.value.trim(), branch: f.branch.value.trim() || 'main', token: f.token.value.trim() };
  if (!cfg.owner || !cfg.repo || !cfg.token) return updateConnectionStatus('Fill in owner, repository and token.');
  const previous = store.getConfig();
  store.setConfig(cfg);
  updateConnectionStatus('Checking…');
  try {
    await store.testConnection();
  } catch (err) {
    store.setConfig(previous);
    return updateConnectionStatus(`Could not connect: ${err.message}`);
  }
  updateConnectionStatus();
  flushDoc();
  // Base further saves on the version in the repository, keeping any local edits.
  try {
    const remote = await store.loadNotebook();
    if (state.dirty) {
      state.sha = remote.sha;
      store.saveDraft(state.nb, state.sha);
      toast('Connected. Press Save to store your local changes in GitHub.', 'success', 6000);
    } else {
      state.nb = migrate(remote.notebook);
      state.sha = remote.sha;
      state.source = 'github';
      applySettings();
      route();
      toast('Connected to GitHub.', 'success');
    }
  } catch (err) {
    toast(`Connected, but loading failed: ${err.message}`, 'error');
  }
}

function wireSettings() {
  const dialog = $('#settings');
  const f = dialog.querySelector('form').elements;
  ['title', 'theme', 'fontSize', 'contentWidth', 'codeWrap', 'numbering'].forEach((name) =>
    f[name].addEventListener('change', () => {
      commit(() => {
        const el = f[name];
        state.nb.settings[name] = el.type === 'checkbox' ? el.checked : name === 'fontSize' ? Number(el.value) : el.value;
        applySettings();
      });
    })
  );
  $('#connect').addEventListener('click', connect);
  $('#disconnect').addEventListener('click', () => {
    store.setConfig(null);
    f.token.value = '';
    updateConnectionStatus();
  });
  $('#close-settings').addEventListener('click', () => dialog.close());
  $('#export').addEventListener('click', () => {
    flushDoc();
    const blob = new Blob([JSON.stringify(state.nb, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `notebook-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const nb = migrate(JSON.parse(await file.text()));
      if (!confirm(`Replace all current notes with “${file.name}”? (${model.flatten(nb).length} sections)`)) return;
      commit(() => (state.nb = nb), { rerender: false });
      applySettings();
      dialog.close();
      route();
    } catch (err) {
      toast(`Import failed: ${err.message}`, 'error');
    }
  });
}

/* ---------- export ---------- */

function openExport() {
  flushDoc();
  const dialog = $('#export-dialog');
  const f = dialog.querySelector('form').elements;
  const has = Boolean(currentNode());
  [...f.scope].forEach((r) => (r.disabled = r.value !== 'all' && !has));
  if (!has) f.scope.value = 'all';
  $('#export-status').textContent = '';
  $('#export-go').disabled = false;
  dialog.showModal();
}

async function runExport() {
  const dialog = $('#export-dialog');
  const f = dialog.querySelector('form').elements;
  const scope = f.scope.value;
  const format = f.format.value;
  flushDoc();
  const exporter = await import('./export.js');
  const current = currentNode();
  const sections = exporter.collectSections(state.nb, scope, current);
  if (!sections.length) return ($('#export-status').textContent = 'There is nothing to export yet.');
  const title = exporter.exportTitle(state.nb, scope, current);
  dialog.close();
  try {
    if (format === 'docx') await exporter.exportWord({ nb: state.nb, sections, title });
    else await exporter.exportPdf({ nb: state.nb, sections, title, lib });
  } catch (err) {
    console.error(err);
    toast(`Export failed: ${err.message}`, 'error', 8000);
  }
}

/* ---------- page chrome ---------- */

// On a phone the section list slides over the page; on a computer it can be hidden to give
// the page more room. The choice on a computer is remembered.
const NAV_KEY = 'esl.nav';
const isPhone = () => window.matchMedia('(max-width: 860px)').matches;

function syncSidebarState() {
  let hidden = false;
  try {
    hidden = localStorage.getItem(NAV_KEY) === 'hidden';
  } catch {
    /* default: shown */
  }
  document.body.classList.toggle('nav-collapsed', hidden);
  $('#nav-toggle').setAttribute('aria-expanded', String(isPhone() ? document.body.classList.contains('nav-open') : !hidden));
}

function toggleSidebar() {
  if (isPhone()) document.body.classList.toggle('nav-open');
  else {
    const hide = !document.body.classList.contains('nav-collapsed');
    try {
      localStorage.setItem(NAV_KEY, hide ? 'hidden' : 'shown');
    } catch {
      /* not remembered */
    }
  }
  syncSidebarState();
}

function wireChrome() {
  $('#edit-toggle').addEventListener('click', toggleEdit);
  $('#save').addEventListener('click', save);
  $('#open-settings').addEventListener('click', openSettings);
  const guarded = (fn) => async () => {
    try {
      await fn();
    } catch (err) {
      console.error(err);
      toast(`Something went wrong: ${err.message}`, 'error', 8000);
    }
  };
  $('#open-export').addEventListener('click', guarded(openExport));
  $('#export-go').addEventListener('click', guarded(runExport));
  $('#anim-insert').addEventListener('click', guarded(insertAnimation));
  $('#close-anim').addEventListener('click', () => $('#anim-dialog').close());
  $('#close-export').addEventListener('click', () => $('#export-dialog').close());
  $('#nav-toggle').addEventListener('click', toggleSidebar);
  syncSidebarState();
  window.addEventListener('scroll', () => {
    if (!spyQueued) {
      spyQueued = true;
      requestAnimationFrame(updateOutlineSpy);
    }
  }, { passive: true });
  $('#scrim').addEventListener('click', () => document.body.classList.remove('nav-open'));
  $('#search').addEventListener('input', (e) => {
    state.query = e.target.value;
    renderSidebar();
  });
  wireSettings();

  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key === 's') {
      e.preventDefault();
      save();
    } else if (e.key === 'k' && state.edit && state.editor && state.editor.isFocused) {
      e.preventDefault();
      toolbar.setLink();
    }
  });
  window.addEventListener('beforeunload', (e) => {
    flushDoc();
    if (state.dirty && store.isConnected()) e.preventDefault();
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => state.nb && state.currentId && renderMain());
}

init();
