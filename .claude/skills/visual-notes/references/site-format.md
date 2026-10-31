# Site format (what the skill writes)

The site stores everything in `content/notebook.json`:

```json
{ "schemaVersion": 2, "settings": {...}, "sections": [ { "id": "s-i2c", "title": "I2C", "doc": { "type": "doc", "content": [...] }, "children": [ ...same shape... ] } ] }
```

`doc` is ProseMirror JSON. **Never hand-write it**: build pages with `scripts/notes-dsl.mjs` (see below) so the shape always matches what the editor expects. If the site's format changes, `js/schema.js` migrates old notebooks; read `SCHEMA_VERSION` there and keep the DSL in step with it.

## Node types
| Node | DSL helper | Notes |
|---|---|---|
| paragraph | `P("text")` | inline: `` `code` ``, `**bold**`, `[label](url)`, `[label](#/page-id)` |
| heading 1–4 | `H(2,"Title")` | the page title is the section title, so start content at H2 |
| lists | `UL([...])`, `OL([...])`, `TASKLIST(["text",...])` | items are strings (list items may be `["text",[sub-items]]`) |
| table | `TABLE(["Head","Head"],[["a","b"],...])` | first row is the header |
| code | `CODE("c", "int x;")` | languages: c, cpp, arm, x86asm, python, rust, verilog, cmake, bash… |
| callout | `CALLOUT("tip","text")` | variants: info, tip, warning, danger |
| diagram | `DIAGRAM("flowchart LR\n A-->B")` | Mermaid text (flowchart, stateDiagram, sequenceDiagram) |
| animation | `ANIM("name", height, "Title")` (file name without .html) | file lives in `content/media/animations/`; height is only the starting height, the frame auto-fits |
| image | `IMAGE("content/media/x.png","alt",50)` | width in %; only for files that exist |
| pdf | `PDF("content/media/x.pdf","Title",600)` | a PDF file that exists in the repository: card with Preview / Open / Download |
| rule | `HR()` | |

## Ids and structure
- Section id = `s-<topic>` in lower-case kebab case (`s-i2c`, `s-i2c-addressing`). Ids are permanent: links (`#/s-i2c`) and drafts depend on them.
- Subsections go in `children`. Use `S(id, title, nodes, children)` and, to attach under an existing page, set `parent` in the spec.
- Spec file: `export default { parent?: "s-existing-id", sections: [ S(...), ... ] }`.

## Rules
- `import-spec.mjs` **refuses** to touch an id that already exists unless `--update` is passed; with `--update` only the ids in the spec are replaced. All other sections, settings and uploaded media are left alone.
- Never edit `settings`, never delete sections, never rewrite other pages.
- Animations are plain files; page JSON only references them by file name.
