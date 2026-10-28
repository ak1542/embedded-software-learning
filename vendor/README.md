Third-party code used by the site.

- `editor.bundle.js` is built from `editor/src/` by `npm run build:editor`. It bundles, unmodified:
  Tiptap 2.27.3 and its extensions (MIT), ProseMirror (MIT), lowlight 3.3.0 (MIT) and highlight.js 11.9.0 (BSD-3-Clause).
- `highlight-github-dark.min.css` is the highlight.js 11.9.0 "GitHub Dark" theme (BSD-3-Clause).
- `mermaid.min.js` is Mermaid 10.9.1 (MIT), loaded only on pages that contain a diagram.
- `export-docx.bundle.js` is built from `editor/src/export-docx.js` by `npm run build:editor`. It bundles docx 9.15.0 (MIT) and is only loaded when you export to Word.
