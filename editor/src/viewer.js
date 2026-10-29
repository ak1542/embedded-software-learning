// The big view for pictures, animations and diagrams: a scrollable stage with real zoom
// controls. Opened only from the "Enlarge" button on the media, never by clicking the media.
//
// kinds:
//   image : a picture (src)
//   svg   : an inline diagram (markup)
//   html  : an animation page (src), laid out at a fixed design width and scaled, so it is never
//           stretched to the size of the window

export const SANDBOX = 'allow-scripts allow-popups allow-forms allow-modals allow-pointer-lock';

// The animation page runs in a sandbox, so the note cannot measure it from outside. A tiny
// script is added when the page is shown; it reports the page's height so the frame can grow
// to fit and the note keeps a single scrollbar.
const FIT_SCRIPT =
  '<script>(function(){var last=0;function send(){var h=Math.ceil(document.documentElement.getBoundingClientRect().height);' +
  'if(h&&h!==last){last=h;parent.postMessage({eslFrameHeight:h},"*");}}' +
  'addEventListener("load",send);addEventListener("resize",send);' +
  'if(window.ResizeObserver){new ResizeObserver(send).observe(document.documentElement);}else{setInterval(send,400);}send();})();</script>';

export function withFitScript(html) {
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, () => `${FIT_SCRIPT}</body>`) : html + FIT_SCRIPT;
}

// The small corner button that opens the viewer (the only way to open it).
export function expandButton(onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'media-expand';
  b.textContent = '⤢';
  b.title = 'Enlarge: zoom in and out, scroll';
  b.setAttribute('aria-label', 'Enlarge');
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', onClick);
  return b;
}

const ANIM_WIDTH = 960; // CSS px an animation is laid out at before scaling
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2, 3, 4, 6, 8];

function make(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

export function openViewer({ kind, src, markup, title, openUrl }) {
  const dialog = make('dialog', 'viewer');
  dialog.setAttribute('aria-label', title || 'Enlarged view');

  /* ---- top bar ---- */
  const bar = make('div', 'viewer-bar');
  const heading = make('span', 'viewer-title', title || (kind === 'html' ? 'Animation' : kind === 'svg' ? 'Diagram' : 'Picture'));
  const btn = (label, tip, onClick, className = 'btn small') => {
    const b = make('button', className, label);
    b.type = 'button';
    b.title = tip;
    b.setAttribute('aria-label', tip);
    b.addEventListener('click', onClick);
    return b;
  };
  const zoomOut = btn('−', 'Zoom out (-)', () => step(-1));
  const label = make('span', 'viewer-zoom', '100%');
  const zoomIn = btn('+', 'Zoom in (+)', () => step(1));
  const fitBtn = btn('Fit', 'Fit to the window (0)', () => realFit());
  const actualBtn = btn('100%', 'Actual size (1)', () => zoomTo(1));
  const spacer = make('span', 'viewer-spacer');
  const closeBtn = btn('✕ Close', 'Close (Esc)', () => dialog.close());
  bar.append(heading, spacer, zoomOut, label, zoomIn, fitBtn, actualBtn);
  if (openUrl) bar.append(btn('Open in tab ↗', 'Open in its own tab', () => window.open(openUrl, '_blank', 'noopener')));
  bar.append(closeBtn);

  /* ---- stage ---- */
  const stage = make('div', 'viewer-stage');
  stage.tabIndex = 0;
  const canvas = make('div', 'viewer-canvas');
  stage.append(canvas);
  dialog.append(bar, stage);
  document.body.append(dialog);

  /* ---- content ---- */
  let z = 1;
  let fitMode = true;
  let nw = 0; // natural size (image / svg) in CSS px
  let nh = 0;
  let frameHeight = 640; // animation page height at ANIM_WIDTH
  let el = null; // img | svg | iframe
  const interactive = kind !== 'html'; // wheel / pinch / drag only where the content does not swallow events

  const size = () => (kind === 'html' ? { w: ANIM_WIDTH, h: frameHeight } : { w: nw, h: nh });
  const stageInner = () => ({ w: Math.max(50, stage.clientWidth - 24), h: Math.max(50, stage.clientHeight - 24) });
  const fitZoom = () => {
    const s = size();
    const box = stageInner();
    if (!s.w || !s.h) return 1;
    return kind === 'html' ? box.w / s.w : Math.min(box.w / s.w, box.h / s.h);
  };
  const clamp = (v) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v));

  function paint() {
    const s = size();
    if (!el || !s.w) return;
    const w = s.w * z;
    const h = s.h * z;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    if (kind === 'image') {
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
    } else if (kind === 'svg') {
      el.setAttribute('width', w);
      el.setAttribute('height', h);
    } else {
      el.style.width = `${ANIM_WIDTH}px`;
      el.style.height = `${frameHeight}px`;
      el.style.transform = `scale(${z})`;
    }
    label.textContent = `${Math.round(z * 100)}%`;
    zoomOut.disabled = z <= MIN_ZOOM + 0.001;
    zoomIn.disabled = z >= MAX_ZOOM - 0.001;
    stage.classList.toggle('can-pan', interactive && (w > stage.clientWidth || h > stage.clientHeight));
  }

  // Change the zoom while keeping the point under (ax, ay), in stage coordinates, where it is.
  function zoomTo(next, ax, ay, manual = true) {
    next = clamp(next);
    if (manual) fitMode = false;
    if (ax === undefined) {
      ax = stage.clientWidth / 2;
      ay = stage.clientHeight / 2;
    }
    const before = { left: canvas.offsetLeft, top: canvas.offsetTop, w: canvas.offsetWidth || 1, h: canvas.offsetHeight || 1 };
    const fx = (stage.scrollLeft + ax - before.left) / before.w;
    const fy = (stage.scrollTop + ay - before.top) / before.h;
    z = next;
    paint();
    stage.scrollLeft = fx * canvas.offsetWidth + canvas.offsetLeft - ax;
    stage.scrollTop = fy * canvas.offsetHeight + canvas.offsetTop - ay;
  }
  function step(dir) {
    const cur = z;
    const next = dir > 0 ? STEPS.find((s) => s > cur + 0.001) : [...STEPS].reverse().find((s) => s < cur - 0.001);
    zoomTo(next ?? (dir > 0 ? MAX_ZOOM : MIN_ZOOM));
  }
  // The opening view: fit the window, but never enlarge pictures and animations past 100 %
  // (diagrams are often small, so they may open up to 250 %).
  function setFit() {
    fitMode = true;
    z = clamp(Math.min(kind === 'svg' ? 2.5 : 1, fitZoom()));
    paint();
    stage.scrollLeft = 0;
    stage.scrollTop = 0;
  }
  // The Fit button: fit the window exactly (a small picture may be enlarged).
  function realFit() {
    fitMode = true;
    z = clamp(fitZoom());
    paint();
    stage.scrollLeft = 0;
    stage.scrollTop = 0;
  }

  /* ---- build the content ---- */
  if (kind === 'image') {
    el = make('img');
    el.alt = title || '';
    el.draggable = false;
    el.addEventListener('load', () => {
      nw = el.naturalWidth || 1;
      nh = el.naturalHeight || 1;
      setFit();
    });
    el.src = src;
    canvas.append(el);
  } else if (kind === 'svg') {
    const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
    const svg = doc.documentElement;
    if (svg && svg.nodeName.toLowerCase() === 'svg' && !doc.querySelector('parsererror')) {
      el = document.importNode(svg, true);
      const vb = (el.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
      nw = vb[2] || parseFloat(el.getAttribute('width')) || 800;
      nh = vb[3] || parseFloat(el.getAttribute('height')) || 600;
      el.removeAttribute('style');
      el.style.maxWidth = 'none';
      canvas.append(el);
      requestAnimationFrame(setFit);
    } else {
      canvas.textContent = 'This diagram cannot be enlarged.';
    }
  } else {
    el = make('iframe');
    el.setAttribute('sandbox', SANDBOX);
    el.setAttribute('allow', 'fullscreen');
    el.allowFullscreen = true;
    el.title = title || 'Animation';
    el.setAttribute('scrolling', 'no');
    canvas.append(el);
    let stamps = [];
    const onMessage = (e) => {
      if (e.source !== el.contentWindow) return;
      const h = e.data && e.data.eslFrameHeight;
      if (typeof h !== 'number' || !Number.isFinite(h)) return;
      const now = Date.now();
      stamps = stamps.filter((t) => now - t < 1500);
      stamps.push(now);
      if (stamps.length > 8) return; // a page whose height follows the frame (100vh) must not grow forever
      frameHeight = Math.max(120, Math.min(4000, Math.ceil(h)));
      if (fitMode) {
        z = clamp(Math.min(1, fitZoom()));
      }
      paint();
    };
    window.addEventListener('message', onMessage);
    dialog.addEventListener('close', () => window.removeEventListener('message', onMessage));
    fetch(src)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((html) => (el.srcdoc = withFitScript(html)))
      .catch(() => el.setAttribute('src', src));
  }

  /* ---- interaction ---- */
  dialog.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '+' || e.key === '=') (e.preventDefault(), step(1));
    else if (e.key === '-' || e.key === '_') (e.preventDefault(), step(-1));
    else if (e.key === '0') (e.preventDefault(), realFit());
    else if (e.key === '1') (e.preventDefault(), zoomTo(1));
  });
  dialog.addEventListener('click', (e) => e.target === dialog && dialog.close());
  dialog.addEventListener('close', () => dialog.remove());
  window.addEventListener('resize', () => {
    if (!dialog.isConnected) return;
    if (fitMode && el) setFit();
  });

  if (interactive) {
    stage.style.touchAction = 'none';
    // Ctrl / Cmd + wheel (and trackpad pinch, which arrives as ctrl+wheel) zoom around the pointer.
    stage.addEventListener(
      'wheel',
      (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        const r = stage.getBoundingClientRect();
        zoomTo(z * Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top);
      },
      { passive: false }
    );
    stage.addEventListener('dblclick', (e) => {
      if (!el) return;
      const f = clamp(Math.min(1, fitZoom()));
      const r = stage.getBoundingClientRect();
      if (Math.abs(z - f) < 0.02) zoomTo(1, e.clientX - r.left, e.clientY - r.top);
      else setFit();
    });
    // Drag to pan with one pointer, pinch with two.
    const pointers = new Map();
    let pinch = null;
    let pan = null;
    stage.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      stage.setPointerCapture(e.pointerId);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z };
        pan = null;
      } else {
        pan = { x: e.clientX, y: e.clientY, sl: stage.scrollLeft, st: stage.scrollTop };
        stage.classList.add('panning');
      }
    });
    stage.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const r = stage.getBoundingClientRect();
        zoomTo(pinch.z * (d / pinch.d), (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      } else if (pan) {
        stage.scrollLeft = pan.sl - (e.clientX - pan.x);
        stage.scrollTop = pan.st - (e.clientY - pan.y);
      }
    });
    const end = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) {
        pan = null;
        stage.classList.remove('panning');
      }
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
  }

  dialog.showModal();
  if (kind === 'html') {
    z = clamp(Math.min(1, fitZoom()));
    paint();
  }
  stage.focus({ preventScroll: true });
  return dialog;
}
