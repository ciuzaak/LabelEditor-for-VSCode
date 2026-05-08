# Settings Panel Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply three small visual fixes to the settings dropdown — drop Theme/View group headers, halve the lock button width, and pin the CLAHE toggle button width so its neighbors stop jiggling.

**Architecture:** Two files, one commit. HTML edits in `src/LabelMePanel.ts` and CSS edits in `media/style.css`. No JS changes.

**Tech Stack:** Plain CSS, settings dropdown HTML inside a TypeScript template literal.

**Spec:** [`docs/superpowers/specs/2026-05-08-settings-panel-polish-design.md`](../specs/2026-05-08-settings-panel-polish-design.md)

---

## File Structure

| Path | Touched | Responsibility |
|---|---|---|
| `src/LabelMePanel.ts` | yes | Remove the `Theme` and `View` group-header `<div>`s |
| `media/style.css` | yes | Lock button width 33.33% → 16.67%; `.channel-btn` `min-width: 40px`; drop `:first-child` rule |

---

### Task 1: Apply the three polish tweaks

**Files:**
- Modify: `src/LabelMePanel.ts` (settings dropdown body)
- Modify: `media/style.css` (`.zoom-lock-btn`, `.channel-btn`, `.settings-group-header:first-child`)

- [ ] **Step 1: Remove the Theme group header from the dropdown**

In `src/LabelMePanel.ts`, replace:

```html
                                    <div class="settings-group-header">Theme</div>
                                    <div class="theme-control">
```

with:

```html
                                    <div class="theme-control">
```

- [ ] **Step 2: Remove the View group header from the dropdown**

In `src/LabelMePanel.ts`, replace:

```html
                                    <div class="settings-group-header">View</div>
                                    <div class="zoom-control">
                                        <div class="zoom-header">
                                            <label>Zoom: <span id="zoomPercentage">100%</span> <span id="zoomResetBtn" class="slider-reset-btn" title="Reset zoom to fit screen">&#8634;</span></label>
                                            <button id="zoomLockBtn" class="zoom-lock-btn" title="Lock: Keep zoom and position when switching images">🔓</button>
                                        </div>
                                    </div>
```

with:

```html
                                    <div class="zoom-control">
                                        <div class="zoom-header">
                                            <label>Zoom: <span id="zoomPercentage">100%</span> <span id="zoomResetBtn" class="slider-reset-btn" title="Reset zoom to fit screen">&#8634;</span></label>
                                            <button id="zoomLockBtn" class="zoom-lock-btn" title="Lock: Keep zoom and position when switching images">🔓</button>
                                        </div>
                                    </div>
```

(Identical body — only the preceding `<div class="settings-group-header">View</div>` line goes away.)

- [ ] **Step 3: Halve `.zoom-lock-btn` width in `media/style.css`**

Find the `.zoom-lock-btn` rule (around line 838). Replace:

```css
.zoom-lock-btn {
    padding: 4px 8px;
    font-size: 14px;
    margin: 0;
    width: 33.33%;
    flex: 0 0 33.33%;
```

with:

```css
.zoom-lock-btn {
    padding: 4px 8px;
    font-size: 14px;
    margin: 0;
    width: 16.67%;
    flex: 0 0 16.67%;
```

(Only the two width values change. The rest of the rule continues unchanged after this snippet.)

- [ ] **Step 4: Add `min-width` to `.channel-btn`**

In `media/style.css`, find the `.channel-btn` block (around lines 866-877). Replace:

```css
.channel-btn {
    padding: 4px 8px;
    margin: 0 2px;
    border: 1px solid var(--color-border-input);
    background: var(--color-bg-tertiary);
    color: var(--color-text-primary);
    cursor: pointer;
    border-radius: 3px;
    font-size: 0.9em;
    transition: all 0.2s;
}
```

with:

```css
.channel-btn {
    padding: 4px 8px;
    margin: 0 2px;
    min-width: 40px;
    border: 1px solid var(--color-border-input);
    background: var(--color-bg-tertiary);
    color: var(--color-text-primary);
    cursor: pointer;
    border-radius: 3px;
    font-size: 0.9em;
    transition: all 0.2s;
}
```

- [ ] **Step 5: Drop the now-dead `.settings-group-header:first-child` rule**

In `media/style.css`, remove this block (added at the end of the file in an earlier task):

```css
.settings-group-header:first-child {
    margin-top: 0;
}
```

After removal, the preceding `.settings-group-header` rule should remain intact. The first child of `#settingsMenuDropdown` is now `.theme-control`, not a `.settings-group-header`, so this rule never matched after step 1 anyway.

- [ ] **Step 6: Compile**

Run: `npm run compile`
Expected: exits 0.

- [ ] **Step 7: Run tests**

Run: `npm test`
Expected: 5 tests pass.

- [ ] **Step 8: Sanity-check the diff**

Run: `git diff --stat src/LabelMePanel.ts media/style.css`
Expected: 2 files, small net change (≈ -7 / +2 lines total — 2 group-header div removals, 3 CSS line tweaks).

- [ ] **Step 9: Commit**

```bash
git add src/LabelMePanel.ts media/style.css
git commit -m "Polish settings dropdown: drop Theme/View headers, slim lock button, pin CLAHE toggle width"
```

---

### Task 2: Final verification

**Files:** None modified.

- [ ] **Step 1: Re-run compile + tests**

Run: `npm run compile && npm test`
Expected: compile exits 0; 5 tests pass.

- [ ] **Step 2: Document manual verification list**

Report to the user that the following must be tested in VSCode Extension Development Host:
1. Settings dropdown — Theme buttons sit at the top with no header above; Zoom row directly below; first visible group header is `Annotation Style`.
2. Lock buttons (Zoom / Brightness / Contrast / Channel / CLAHE) are visibly narrower than before, roughly half the previous width.
3. CLAHE toggle button — clicking flips Off ↔ On, but the button's own width stays the same; reset (↻) and lock (🔓) icons next to it don't shift left or right.
4. Other controls behave as before.
