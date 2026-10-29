# The two preview gates

Show these in the chat, in this order. Keep them scannable; the user is reviewing, not reading an essay.

## Gate 1: text preview (before building anything)
**A. Review table** (every point, same numbering as the input)

| # | Your point (short) | Status | Note / source |
|---|---|---|---|
| P1 | "I2C is 2-wire" | ✅ | NXP UM10204 |
| P2 | "max 400 kHz" | 🟡 | Fast mode; Fast-mode Plus is 1 MHz |
| P3 | "address is 8 bits" | ❌ | 7-bit address + R/W bit; fix proposed |

Then a one-line summary: "12 points: 8 ✅, 2 🟡, 1 ❓, 1 ❌".

**B. Suggested changes**: before/after for the 2–3 most important points, each with a one-line reason.

**C. Additions as a tick list**: use AskUserQuestion with `multiSelect: true` (max 4 options per question; split into several questions if needed). Each option: label = the addition, description = why it helps. Examples: prerequisite explanation, worked example, common mistake, interview question.

**D. Proposed structure**: a tree of pages with, per page, its visuals as one-line storyboards and the revision aids.

```
I2C (s-i2c)
├─ How it works      anim: stepper "a write transaction, start → ack → stop"
├─ Addressing        table + callout (7-bit vs 8-bit mistake)
└─ Revise            summary · common mistakes · quiz anim (6 Qs) · checklist
```

Ask: "Approve, or tell me what to change?" Loop until approved.

## Gate 2: visual preview (before publishing)
1. Build the draft in the scratchpad (spec file + built animations).
2. Run `scripts/preview.mjs` to render a throw-away copy of the site; it writes one PNG per page and per animation.
3. Send the key PNGs with SendUserFile (`display: render`), caption each with what to look at.
4. List what was checked automatically (no errors, light/dark/phone) and anything you could not check.
5. Ask for approval or changes. Only after approval go to publish.
