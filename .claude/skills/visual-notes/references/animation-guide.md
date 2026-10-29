# Choosing and building visuals

## Decision table
| The point is about… | Use | Template |
|---|---|---|
| a process / sequence / protocol exchange | step-by-step player | `stepper.html` |
| variants, modes, options with details | tabs | `tabs-explorer.html` |
| things happening over time, concurrency, scheduling | timeline | `timeline.html` |
| memory / address / register layout | clickable region map (or a table for ≤5 rows) | `region-map.html` |
| "A vs B, when to use which" | side-by-side with scenario toggle (plus a plain table for printing) | `compare-toggle.html` |
| modes / states and events | state machine | `state-machine.html` |
| definitions, Q&A, vocabulary | flashcards | `flashcards.html` |
| checking understanding | quiz | `quiz.html` |
| hierarchy, simple flow, wiring | Mermaid `DIAGRAM` (cheaper than an animation, prints well) | – |
| commands, snippets | `CODE` block with comments | – |
| a plain list of facts | table or list; do not animate for the sake of it | – |

Rules of thumb: at most 2–3 animations per page; every animation must teach something the text alone teaches badly. If a table or diagram is enough, use that.

## Using a template
1. Copy `templates/<name>.html` to the draft folder (e.g. `<scratchpad>/anims/i2c-write.html`).
2. Replace the `DATA` object at the top of the script; leave the engine alone unless the content truly needs more. Keep text short: one sentence per step.
3. Build: `node scripts/build-anims.mjs <draftDir> content/media/animations` (inlines `/*BASE_CSS*/` and `/*BASE_JS*/`; warns on external URLs).
4. Check: `node scripts/check-anim.mjs content/media/animations/<file>.html --out <shots>`; add `--script "…"` to click controls and print what changed.

## Quality bar (learned on this site)
- **Self-contained**: no CDN, fonts or images from the web; everything inline. The frame is sandboxed with no network assumptions.
- **Light and dark**: use the CSS variables from `base.css` (never hard-coded colours); check both.
- **Reduced motion** respected (`reduce` in base.js); the content must still be understandable with no animation.
- **Keyboard**: buttons are real buttons; custom controls get `tabindex` and Enter/Space handlers.
- **Readable at 960 px and on a phone (≈380 px)**; no sideways scrolling; text ≥ 12 px.
- **Short and explicit**: a title, a one-sentence narration per state, visible step counter.
- **Honest**: an animation shows the mechanism that is true for the stated case; say the assumption (e.g. "7-bit addressing, standard mode") in the title or narration.
- Keep each file under ~25 KB. Use `$` safely: the build uses function replacers, but never put `$&`-style text in `DATA`.
- The height you pass to `ANIM(...)` is a starting height; the site auto-fits the frame.
