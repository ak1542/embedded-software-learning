---
name: visual-notes
description: Turn plain-text study notes into reviewed, illustrated pages for this Embedded Software Notes site. Pasted notes are cross-checked (with web sources, each point labelled verified / plausible / unverified / likely wrong), improved, previewed for approval, then built into pages with animations, diagrams, tables, code and revision aids (summary, flashcards, quiz, common mistakes, checklist) that are easy to revisit. Use whenever the user pastes notes, bullet points or a topic they want explained, checked, improved, visualised, animated or added to the notebook, even if they do not say "skill" or "animation".
argument-hint: <paste your notes, or a topic>
---

# visual-notes

Turn rough notes into trustworthy, visual, revisit-friendly pages of the notebook (`content/notebook.json`). The user reviews twice before anything is published: a **text preview** (what is right, wrong, added) and a **visual preview** (screenshots). Work from the repo root. Read the reference files when the step says so; they hold the details.

## Principles
- **Honesty over polish.** Never invent facts or sources. Say what you could not verify.
- **Their notes stay recognisable.** Improve wording only where it is wrong or unclear; mark everything you add as *Added* so they can drop it.
- **Nothing is published without approval**, and existing pages are never overwritten or deleted without showing a diff and getting an explicit yes.
- **Visuals must teach.** Choose them from the decision table, not for decoration.
- No secrets (tokens) in files, commits or messages.

## Workflow

### 0. Intake
1. Take the notes from the argument; if none, ask the user to paste them (and the topic).
2. `git pull` (merge, never force) and read the outline of `content/notebook.json` (ids and titles) so you can link to or avoid duplicating existing pages. Ask only what is missing: where it should live (new section or under which existing page) and the level (beginner / interview / expert). Default to a new top-level section.

### 1. Understand
Split into atomic points, number them P1…Pn, and classify each (definition, process, comparison, command, layout, state machine, Q&A, numbers).

### 2. Cross-check
Read `references/review-rubric.md`. Label every point ✅ 🟡 ❓ ❌, use WebSearch for technical claims (official sources first), and note contradictions, typos, unit slips and missing prerequisites.

### 3. Improve
Propose rewordings, ordering, and additions (prerequisites, worked example, common mistakes, interview questions), each with a one-line reason.

### 4. Visual plan
Read `references/animation-guide.md` (decision table) and `references/revision-aids.md`. Decide the page structure, one visual per point or group, and the revision aids. Cap animations at 2–3 per page.

### 5. Gate 1: text preview
Present it exactly as `references/preview-format.md` describes (review table, before/after, additions tick-list via AskUserQuestion, proposed structure with storyboards). Loop until approved. Record what was accepted or dropped.

### 6. Build the draft (scratchpad only)
- Write a spec `spec.mjs` with the DSL (`scripts/notes-dsl.mjs`; shape in `references/site-format.md`). Use accepted text, label added items, link between pages with `#/id`.
- For each animation: copy the right template from `templates/`, edit its `DATA`, build with `node .claude/skills/visual-notes/scripts/build-anims.mjs <srcDir> <builtDir>`, and test it with `check-anim.mjs` (use `--script` to click through it). Fix errors, sideways scrolling, and anything unreadable in dark mode or at phone width.

### 7. Gate 2: visual preview
`node .claude/skills/visual-notes/scripts/preview.mjs --spec spec.mjs --anims <builtDir> --out <shotsDir>` renders a throw-away copy of the site (the real notebook is not touched). Send the key screenshots with SendUserFile, say what was checked automatically, then ask for approval or changes. Go back to step 6 as often as needed.

### 8. Publish (only after approval)
1. Copy the built animations to `content/media/animations/`.
2. `node .claude/skills/visual-notes/scripts/import-spec.mjs spec.mjs` (add `--update` only for pages the user agreed to replace; try `--dry` first).
3. Run `npm test`, `node .claude/skills/visual-notes/scripts/check-pages.mjs --only <new ids>` and `check-anim.mjs` on each new animation. Fix failures before continuing.
4. `git fetch origin main` and merge it first (the user may have saved from the site); then commit and push to `main` (`git push -u origin main`; retry on network errors only).
5. Report: pages added, what came from the user vs *Added*, anything still flagged 🟡/❓/❌ to verify, and remind them to hard-refresh (Ctrl+Shift+R) after GitHub Pages republishes (about a minute).

## Scripts (in `.claude/skills/visual-notes/scripts/`)
`notes-dsl.mjs` page builders · `import-spec.mjs` merge into the notebook · `build-anims.mjs` inline base CSS/JS · `check-anim.mjs` browser test of one animation · `check-pages.mjs` load pages and count content · `preview.mjs` staged screenshots · `serve.mjs` helper. They need Node and Playwright (preinstalled in the cloud session; otherwise `npm i -D playwright`).
