# Embedded Software Learning Notes

A notes website for learning embedded software. It runs on free GitHub Pages, so you can read it from any device. You can edit it in the browser from any device too, and every save is a commit to this repository.

## Features

- **Sections and subsections** at any depth: create, rename, reorder, indent/outdent, delete
- **Blocks** for building each page:
  - Text (Markdown: lists, tables, checklists, links; paste or drop an image straight in)
  - Heading, callout (info / tip / warning / danger), divider
  - Code with syntax highlighting (C, C++, ARM and x86 assembly, Python, Rust, Verilog, CMake…), line numbers and a copy button
  - Image (click to zoom), animation / video (GIF, WebP, MP4, WebM)
  - Step-by-step animation: frames that play in order, for walking through a protocol, a state machine…
  - Diagram: flowcharts, state machines, sequence diagrams written as [Mermaid](https://mermaid.js.org/intro/) text
  - Embed: YouTube, Wokwi simulations, any embeddable page
- Search across all notes, light/dark theme, works on phones
- Unsaved edits are kept in the browser, so a closed tab doesn't lose work

## One-time setup

1. **Turn on GitHub Pages**: open **Settings → Pages**, choose *Deploy from a branch*, select branch `main` and folder `/ (root)`, then click Save. After a minute the site is at `https://<your-user>.github.io/embedded-software-learning/`.
   GitHub Pages on a *private* repository needs a paid GitHub plan. On a free plan, make the repository public. Your Pages site is public either way.
2. **Create a token for editing**: open [new fine-grained token](https://github.com/settings/personal-access-tokens/new), set *Repository access* to *Only select repositories* and pick this repository, then under *Permissions → Contents* choose **Read and write**. Copy the token.
3. **Connect each device once**: open the site, click **⚙**, paste the token and click **Connect**. Owner and repository are filled in automatically on `github.io`. The token is stored only in that browser.

Then click **Edit** and start writing. **Save** (or Ctrl+S) commits your changes, and the published site updates within a minute or two. Anyone can read the site, but only someone with a token can save changes.

## How backward compatibility works

Notes are stored as **data, not HTML**, in `content/notebook.json`: sections contain blocks, and each block is `{ id, type, data }`. Uploaded files go to `content/media/`.

- **Every page is rendered fresh** by the current code in `js/blocks.js`. When a renderer or editor improves, every note uses the improvement, old or new.
- **Defaults are merged at render time.** When a block type gains a new option, older blocks automatically get its default value.
- **Display settings** (theme, text size, page width, code line numbers…) are global and apply to every section.
- **Format changes are migrations.** If the stored shape ever needs to change, bump `SCHEMA_VERSION` in `js/schema.js` and add a migration. Older notebooks are upgraded when they load.
- **Nothing unknown is thrown away.** Unknown fields and block types are kept as they are, can still be edited as raw JSON, and a broken block shows an error box instead of breaking the page.

### Adding a new block type

Add an entry to `BLOCK_TYPES` in `js/blocks.js` with `label`, `icon`, `defaults()`, `fields` (the editor form is generated from these) and `render(data, ctx)`. It then appears in the **+ Add block** menu.

## Run locally

```sh
npm start        # serves the site on http://localhost:8000
npm test         # unit tests for the data model and migrations
```

No build step: plain HTML, CSS and JavaScript modules. Third-party libraries are copied into `vendor/` (see `vendor/README.md`).

## Layout

```
index.html            page shell and settings dialog
css/app.css           styles (light/dark, mobile)
js/app.js             navigation, editing, saving
js/blocks.js          block types: renderers and editors
js/schema.js          data format version, migrations, defaults
js/model.js           section/block tree operations
js/storage.js         GitHub API, local drafts, media uploads
content/notebook.json your notes
content/media/        your uploaded images and videos
```
