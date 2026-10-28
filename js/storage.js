// Where notes live.
//
// - Reading: anyone can read content/notebook.json straight from the website.
// - Editing: after you connect GitHub (once per device, in Settings), the site
//   reads and writes content/notebook.json and content/media/* in your repository
//   through the GitHub API. Every save is a commit, so you get full history.
// - Unsaved edits are kept as a draft in this browser until they are saved.

const CONFIG_KEY = 'esl.github';
const DRAFT_KEY = 'esl.draft';
export const NOTEBOOK_PATH = 'content/notebook.json';

// Media uploaded in this session, shown from memory until GitHub Pages republishes.
const pendingMedia = new Map();

export function getConfig() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY)) || null;
  } catch {
    return null;
  }
}

export function setConfig(config) {
  try {
    if (config) localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    else localStorage.removeItem(CONFIG_KEY);
  } catch {
    /* storage blocked: the connection lasts for this visit only */
  }
}

export function isConnected() {
  const c = getConfig();
  return Boolean(c && c.token && c.owner && c.repo);
}

// On https://<owner>.github.io/<repo>/ the repository can be guessed from the URL.
export function guessRepo() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
  if (!m) return { owner: '', repo: '' };
  const first = location.pathname.split('/').filter(Boolean)[0];
  return { owner: m[1], repo: first || `${m[1]}.github.io` };
}

async function gh(path, options = {}) {
  const c = getConfig();
  // Keep requests "simple" for CORS: no cache: 'no-store' (browsers then add Cache-Control and
  // Pragma headers, which api.github.com rejects) and no extra custom headers. Reads are kept
  // fresh with a throwaway query parameter instead.
  const fresh = options.method || !path ? '' : `${path.includes('?') ? '&' : '?'}_=${Date.now()}`;
  const url = `https://api.github.com/repos/${c.owner}/${c.repo}${path ? `/${path}` : ''}${fresh}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${c.token}`,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json()).message || '';
    } catch {
      /* no JSON body */
    }
    const err = new Error(`GitHub ${res.status}${detail ? `: ${detail}` : ''}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

function branchRef() {
  return encodeURIComponent(getConfig().branch || 'main');
}

export async function testConnection() {
  const repo = await (await gh('')).json();
  if (!repo.permissions || !repo.permissions.push) {
    throw new Error('This token can read the repository but cannot write to it. Give it "Contents: Read and write".');
  }
  return repo;
}

export async function loadNotebook() {
  if (isConnected()) {
    try {
      const meta = await (await gh(`contents/${NOTEBOOK_PATH}?ref=${branchRef()}`)).json();
      const text =
        meta.encoding === 'base64' && meta.content
          ? decodeBase64Utf8(meta.content)
          : await (await gh(`git/blobs/${meta.sha}`, { headers: { Accept: 'application/vnd.github.raw+json' } })).text();
      return { notebook: JSON.parse(text), sha: meta.sha, source: 'github' };
    } catch (err) {
      if (err.status !== 404) throw err;
      await gh(''); // Throws if the repository itself is missing or not shared with the token.
      return { notebook: {}, sha: null, source: 'github' };
    }
  }
  const res = await fetch(NOTEBOOK_PATH, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not load ${NOTEBOOK_PATH} (${res.status})`);
  return { notebook: await res.json(), sha: null, source: 'site' };
}

export async function latestSha() {
  try {
    const meta = await (await gh(`contents/${NOTEBOOK_PATH}?ref=${branchRef()}`)).json();
    return meta.sha;
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

// Returns the new file sha. Throws with status 409 if the file changed elsewhere.
export async function saveNotebook(notebook, sha, message) {
  const body = {
    message,
    content: encodeBase64Utf8(JSON.stringify(notebook, null, 2) + '\n'),
    branch: getConfig().branch || 'main',
  };
  if (sha) body.sha = sha;
  const res = await gh(`contents/${NOTEBOOK_PATH}`, { method: 'PUT', body: JSON.stringify(body) });
  return (await res.json()).content.sha;
}

// Store a file and return the path or URL a block should reference.
export async function uploadMedia(file) {
  if (!isConnected()) {
    if (file.size > 1.5 * 1024 * 1024) {
      throw new Error('Connect GitHub in Settings to add files larger than 1.5 MB.');
    }
    return readAsDataUrl(file);
  }
  const month = new Date().toISOString().slice(0, 7);
  const safeName = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '') || 'file';
  const path = `content/media/${month}/${Date.now().toString(36)}-${safeName}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  await gh(`contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `Add media ${file.name}`,
      content: bytesToBase64(bytes),
      branch: getConfig().branch || 'main',
    }),
  });
  pendingMedia.set(path, URL.createObjectURL(file));
  return path;
}

export function resolveMedia(src) {
  return (src && pendingMedia.get(src)) || src || '';
}

export function loadDraft() {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY)) || null;
  } catch {
    return null;
  }
}

export function saveDraft(notebook, baseSha) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ notebook, baseSha, savedAt: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* nothing to clear */
  }
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function encodeBase64Utf8(text) {
  return bytesToBase64(new TextEncoder().encode(text));
}

function decodeBase64Utf8(b64) {
  const binary = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}
