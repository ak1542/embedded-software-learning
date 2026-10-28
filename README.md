# Embedded Software Learning Notes

A notes website for learning embedded software. It runs on free GitHub Pages, so you can read it from any device. You can edit it in the browser from any device too, and every save is a commit to this repository.

## Writing notes

Click **Edit** and the page itself becomes the editor, like a word processor. Click and type; a toolbar above the page has the formatting tools.

- **Text:** paragraph styles (Normal, Heading 1–4, Quote), bold, italic, underline, strikethrough, inline code, highlight, text colour, bulleted / numbered lists and checklists, alignment, links. Markdown shortcuts also work: `# ` for a heading, `- ` for a list, `**bold**`.
- **Pictures, GIFs and videos:** use the *Image* / *Video* buttons, or paste or drag a file onto the page. Click a picture to pick a size (25 / 50 / 75 / 100 %) and alignment, or drag its round corner handle to resize it freely. Videos have a *Loop* option to play like a GIF.
- **Tables:** insert one, then add or delete rows and columns from the toolbar that appears while the cursor is in the table.
- **Code:** a code block with syntax highlighting (C, C++, ARM and x86 assembly, Python, Rust, Verilog, CMake, shell…); pick the language from the toolbar while the cursor is in it.
- **Highlighted boxes** (info, tip, warning, danger), horizontal lines, **diagrams** (flowcharts, state machines and sequence diagrams written as [Mermaid](https://mermaid.js.org/intro/) text) and **embeds** (YouTube, Wokwi simulations, any embeddable page).
- **Sections and subsections** at any depth: create, rename, reorder, indent / outdent, delete. Search covers all notes. The ☰ button hides or shows the section list (your choice is remembered).
- **On this page:** an outline built automatically from your headings (H1–H4). Click an entry to jump there; the one you are reading is highlighted. It sits at the right on wide screens and at the top of the page on narrower ones.
- **Numbering:** in ⚙ Settings, *Number sections and headings* adds 1, 1.1, 1.2… numbers to the section list, the headings and the outline. Off by default.
- **Export** (top bar) to **PDF** or **Word (.docx)**: this page, a section with its subsections, or the whole notebook. PDF opens your browser's print window (choose *Save as PDF*) and always prints in light colours. Word files keep headings (so Word's Navigation Pane works), lists, tables, code, pictures and diagrams (as pictures).
- Light and dark theme, works on phones, and unsaved edits are kept in the browser so a closed tab doesn't lose work.

## One-time setup

1. **Turn on GitHub Pages**: open **Settings → Pages**, choose *Deploy from a branch*, select branch `main` and folder `/ (root)`, then click Save. After a minute the site is at `https://<your-user>.github.io/embedded-software-learning/`.
   GitHub Pages on a *private* repository needs a paid GitHub plan. On a free plan, make the repository public. Your Pages site is public either way.
2. **Create a token for editing**: open [new fine-grained token](https://github.com/settings/personal-access-tokens/new), set *Repository access* to *Only select repositories* and pick this repository, then under *Permissions → Contents* choose **Read and write**. Copy the token.
3. **Connect each device once**: open the site, click **⚙**, paste the token and click **Connect**. Owner and repository are filled in automatically on `github.io`. The token is stored only in that browser.

Then click **Edit** and start writing. **Save** (or Ctrl+S) commits your changes, and the published site updates within a minute or two. Anyone can read the site, but only someone with a token can save changes.

## How backward compatibility works

Notes are stored as **data, not HTML**, in `content/notebook.json`: each section holds a rich-text document (ProseMirror / Tiptap JSON) made of headings, paragraphs, lists, tables, images and so on. Uploaded files go to `content/media/`.

- **Every page is rendered fresh** by the current editor code. When the editor, a node's look or the styling improves, every note uses the improvement, old or new.
- **Display settings** (theme, text size, page width, code wrapping) are global and apply to every section.
- **Format changes are migrations.** The notebook carries a `schemaVersion`. If the stored shape ever has to change, bump `SCHEMA_VERSION` in `js/schema.js` and add a migration; older notebooks are upgraded when they load. (Version 1 notes, made of typed blocks, are converted to documents this way.)
- **Nothing unknown is thrown away.** Unknown fields are kept when saving, and a notebook written by a newer version of the site is refused instead of being damaged.

## Changing the editor

The editor is [Tiptap](https://tiptap.dev), bundled into `vendor/editor.bundle.js` from `editor/src/` (and the Word exporter into `vendor/export-docx.bundle.js`). Those bundles are committed, so the site needs no build step to run. After changing anything in `editor/src/` (a new extension, a custom node), rebuild it:

```sh
npm install
npm run build:editor
```

The toolbar is in `js/toolbar.js`; its styles and the page styles are in `css/app.css`.

## Run locally

```sh
npm start        # serves the site on http://localhost:8000
npm test         # unit tests for the data model and migrations
```

## Layout

```
index.html            page shell and settings dialog
css/app.css           styles (light/dark, mobile, the page and editor)
js/app.js             navigation, editing, saving
js/toolbar.js         the formatting toolbar
js/schema.js          data format version, migrations, defaults
js/model.js           section tree operations, search text
js/diagram.js         Mermaid diagram rendering (and diagram-to-picture for Word)
js/export.js          export to PDF and Word
js/storage.js         GitHub API, local drafts, media uploads
editor/src/           editor source (Tiptap setup, picture/video/embed/diagram nodes)
editor/src/export-docx.js  converts pages to a Word file
vendor/               built editor bundle and third-party libraries
content/notebook.json your notes
content/media/        your uploaded images and videos
```
