import { h, fill, toast, prefersReducedMotion } from './dom.js';
import { migrate } from './schema.js';
import * as model from './model.js';
import { BLOCK_TYPES, buildBlockEditor, renderBlockBody, blockText } from './blocks.js';
import * as store from './storage.js';

const state = {
  nb: null,
  sha: null, // version of content/notebook.json the edits are based on
  source: 'site',
  currentId: null,
  edit: false,
  dirty: false,
  saving: false,
  editingBlockId: null,
  newBlockId: null, // a just-inserted block, removed again if its first edit is cancelled
  query: '',
};

const COLLAPSED_KEY = 'esl.collapsed';
let collapsed = new Set();
try {
  collapsed = new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY)) || []);
} catch {
  /* start expanded */
}

const $ = (sel) => document.querySelector(sel);

const ctx = {
  get settings() {
    return state.nb.settings;
  },
  resolveMedia: store.resolveMedia,
  uploadMedia: store.uploadMedia,
};

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
  } catch (err) {
    return fatal(err);
  }
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
  $('#main').replaceChildren(h('div', { class: 'empty' }, h('h1', {}, 'Could not open the notes'), h('p', {}, err.message)));
}

/* ---------- state changes ---------- */

function commit(mutate, { rerender = true } = {}) {
  mutate();
  state.dirty = true;
  if (!store.saveDraft(state.nb, state.sha)) toast('Browser storage is full: save to GitHub soon so you don\'t lose changes.', 'error');
  updateSaveButton();
  if (rerender) render();
}

function currentNode() {
  return state.currentId ? model.locate(state.nb, state.currentId)?.node : null;
}

function go(id) {
  if (state.editingBlockId) cancelBlockEdit(false);
  location.hash = id ? `#/${id}` : '#/';
}

function route() {
  const id = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const exists = id && model.locate(state.nb, id);
  state.currentId = exists ? id : state.nb.sections[0]?.id || null;
  state.editingBlockId = null;
  state.newBlockId = null;
  document.body.classList.remove('nav-open');
  render();
  window.scrollTo(0, 0);
}

/* ---------- settings ---------- */

function applySettings() {
  const s = state.nb.settings;
  const root = document.documentElement;
  root.dataset.theme = s.theme;
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

function renderSidebar() {
  const nav = $('#tree');
  const q = state.query.trim().toLowerCase();
  if (q) {
    const results = model.flatten(state.nb).filter((n) => {
      const text = `${n.title} ${n.blocks.map(blockText).join(' ')}`.toLowerCase();
      return text.includes(q);
    });
    fill(nav,
      results.length
        ? h('ul', { class: 'results' }, results.map((n) => h('li', {}, treeLink(n, model.locate(state.nb, n.id).path))))
        : h('p', { class: 'muted pad' }, 'No matches.')
    );
    return;
  }
  const openPath = new Set((model.locate(state.nb, state.currentId)?.path || []).map((n) => n.id));
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
  fill(nav,
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
    fill(main,
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

  fill(main,
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
          onInput: (e) =>
            commit(
              () => (node.title = e.target.value),
              { rerender: false }
            ),
          onChange: () => renderSidebar(),
        })
      : h('h1', { class: 'page-title' }, node.title || 'Untitled'),
    h('div', { class: 'blocks' }, renderBlocks(node)),
    renderChildren(node),
    h(
      'nav',
      { class: 'pager' },
      pos > 0 ? h('a', { href: `#/${flat[pos - 1].id}`, class: 'prev' }, h('small', {}, '← Previous'), flat[pos - 1].title) : h('span'),
      pos < flat.length - 1 ? h('a', { href: `#/${flat[pos + 1].id}`, class: 'next' }, h('small', {}, 'Next →'), flat[pos + 1].title) : h('span')
    )
  );
  revealBlocks(main);
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

function renderBlocks(node) {
  const out = [];
  if (state.edit) out.push(inserter(node, 0));
  node.blocks.forEach((block, i) => {
    const editing = state.editingBlockId === block.id;
    out.push(
      h(
        'div',
        { class: `block block-${block.type}${editing ? ' is-editing' : ''}`, 'data-id': block.id },
        state.edit && !editing && blockToolbar(node, block, i),
        editing
          ? buildBlockEditor(block, ctx, {
              onDone: (data) => {
                commit(() => (block.data = data), { rerender: false });
                state.editingBlockId = null;
                state.newBlockId = null;
                render();
              },
              onCancel: () => cancelBlockEdit(true),
            })
          : h('div', { class: 'block-body', onDblclick: state.edit ? () => startBlockEdit(block.id) : null }, renderBlockBody(block.type, block.data, ctx))
      )
    );
    if (state.edit) out.push(inserter(node, i + 1));
  });
  if (!node.blocks.length && !state.edit) {
    out.push(h('p', { class: 'muted' }, node.children.length ? '' : 'Nothing here yet. Click Edit to add notes.'));
  }
  return out;
}

function blockToolbar(node, block, i) {
  const btn = (label, title, onClick, disabled = false, extra = '') =>
    h('button', { type: 'button', class: `btn small ${extra}`, title, 'aria-label': title, disabled, onClick }, label);
  const def = BLOCK_TYPES[block.type];
  return h(
    'div',
    { class: 'block-toolbar' },
    h('span', { class: 'block-kind' }, def ? `${def.icon} ${def.label}` : block.type),
    h('span', { class: 'spacer' }),
    btn('Edit', 'Edit block', () => startBlockEdit(block.id)),
    btn('↑', 'Move block up', () => commit(() => model.moveBlock(node, block.id, -1)), i === 0),
    btn('↓', 'Move block down', () => commit(() => model.moveBlock(node, block.id, 1)), i === node.blocks.length - 1),
    btn('⧉', 'Duplicate block', () => commit(() => model.duplicateBlock(node, block.id))),
    btn('✕', 'Delete block', () => confirm('Delete this block?') && commit(() => model.removeBlock(node, block.id)), false, 'danger')
  );
}

function inserter(node, index) {
  const menu = h(
    'div',
    { class: 'insert-menu', hidden: true },
    Object.entries(BLOCK_TYPES).map(([type, def]) =>
      h(
        'button',
        {
          type: 'button',
          onClick: () => {
            let block;
            commit(() => (block = model.insertBlock(node, index, type, def.defaults())), { rerender: false });
            if (def.fields.length) {
              state.editingBlockId = block.id;
              state.newBlockId = block.id;
            }
            render();
            focusEditor();
          },
        },
        h('span', { class: 'icon' }, def.icon),
        h('span', {}, h('strong', {}, def.label), def.hint && h('small', {}, def.hint))
      )
    )
  );
  const toggle = h(
    'button',
    {
      type: 'button',
      class: 'insert-btn',
      'aria-label': 'Add a block here',
      onClick: () => {
        document.querySelectorAll('.insert-menu').forEach((m) => m !== menu && (m.hidden = true));
        menu.hidden = !menu.hidden;
      },
    },
    '+ Add block'
  );
  return h('div', { class: 'inserter' }, toggle, menu);
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
        const counts = model.countContents(c);
        const meta = [c.blocks.length && `${c.blocks.length} block${c.blocks.length === 1 ? '' : 's'}`, counts.sections && `${counts.sections} subsection${counts.sections === 1 ? '' : 's'}`]
          .filter(Boolean)
          .join(' · ');
        return h('a', { class: 'card', href: `#/${c.id}` }, h('strong', {}, c.title || 'Untitled'), h('small', { class: 'muted' }, meta || 'Empty'));
      })
    )
  );
}

let revealObserver;
function revealBlocks(root) {
  const blocks = root.querySelectorAll('.block');
  if (!state.nb.settings.animateBlocks || prefersReducedMotion() || state.edit || !('IntersectionObserver' in window)) return;
  revealObserver?.disconnect();
  revealObserver = new IntersectionObserver(
    (entries) =>
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('revealed');
          revealObserver.unobserve(e.target);
        }
      }),
    { rootMargin: '0px 0px -40px 0px' }
  );
  blocks.forEach((b) => {
    b.classList.add('reveal');
    revealObserver.observe(b);
  });
}

/* ---------- actions ---------- */

function toggleEdit() {
  if (state.edit && state.editingBlockId) cancelBlockEdit(false);
  state.edit = !state.edit;
  if (state.edit && !store.isConnected()) {
    toast('Editing in this browser only. Connect GitHub in Settings to save your notes online.', 'info', 6000);
  }
  render();
}

function startBlockEdit(id) {
  if (state.editingBlockId && state.editingBlockId !== id) cancelBlockEdit(false);
  state.editingBlockId = id;
  render();
  focusEditor();
}

function cancelBlockEdit(rerender) {
  const node = currentNode();
  if (node && state.newBlockId && state.newBlockId === state.editingBlockId) {
    const id = state.newBlockId;
    commit(() => model.removeBlock(node, id), { rerender: false });
  }
  state.editingBlockId = null;
  state.newBlockId = null;
  if (rerender) render();
}

function focusEditor() {
  requestAnimationFrame(() => {
    const editor = document.querySelector('.block-editor');
    if (!editor) return;
    editor.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    editor.querySelector('textarea, input:not([type=checkbox]), select')?.focus({ preventScroll: true });
  });
}

function addSection(parentId) {
  const title = prompt(parentId ? 'Subsection title' : 'Section title');
  if (title === null) return;
  let node;
  commit(() => (node = model.addNode(state.nb, parentId, title.trim() || 'Untitled')), { rerender: false });
  if (parentId) collapsed.delete(parentId);
  if (!state.edit) state.edit = true;
  go(node.id);
}

function deleteSection(node) {
  const c = model.countContents(node);
  const extra = [c.sections && `${c.sections} subsection${c.sections === 1 ? '' : 's'}`, c.blocks && `${c.blocks} block${c.blocks === 1 ? '' : 's'}`]
    .filter(Boolean)
    .join(' and ');
  if (!confirm(`Delete “${node.title}”${extra ? ` with ${extra}` : ''}?\n\nYou can still undo by closing without saving, or from the GitHub history after saving.`)) return;
  let loc;
  commit(() => (loc = model.removeNode(state.nb, node.id)), { rerender: false });
  const next = loc.parent || loc.list[Math.min(loc.index, loc.list.length - 1)] || state.nb.sections[0];
  go(next ? next.id : null);
  if (!next) render();
}

async function save() {
  if (!state.dirty || state.saving) return;
  if (!store.isConnected()) {
    openSettings();
    toast('Connect GitHub to save your notes online. Until then they are kept in this browser.', 'info', 6000);
    return;
  }
  if (state.editingBlockId) {
    toast('Finish or cancel the block you are editing first.', 'info');
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
  f.animateBlocks.checked = s.animateBlocks;
  f.codeLineNumbers.checked = s.codeLineNumbers;
  f.codeWrap.checked = s.codeWrap;
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
  const display = ['title', 'theme', 'fontSize', 'contentWidth', 'animateBlocks', 'codeLineNumbers', 'codeWrap'];
  display.forEach((name) =>
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

/* ---------- page chrome ---------- */

function wireChrome() {
  $('#edit-toggle').addEventListener('click', toggleEdit);
  $('#save').addEventListener('click', save);
  $('#open-settings').addEventListener('click', openSettings);
  $('#nav-toggle').addEventListener('click', () => document.body.classList.toggle('nav-open'));
  $('#scrim').addEventListener('click', () => document.body.classList.remove('nav-open'));
  $('#search').addEventListener('input', (e) => {
    state.query = e.target.value;
    renderSidebar();
  });
  wireSettings();

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      save();
    }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.inserter')) document.querySelectorAll('.insert-menu').forEach((m) => (m.hidden = true));
  });
  window.addEventListener('beforeunload', (e) => {
    if (state.dirty && store.isConnected()) e.preventDefault();
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => state.nb && renderMain());
}

init();
