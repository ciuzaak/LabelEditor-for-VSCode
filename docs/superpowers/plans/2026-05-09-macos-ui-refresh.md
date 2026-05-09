# macOS-Style UI Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the LabelEditor webview to a modern macOS Ventura/Sonoma look — token-based theme, inline-SVG icons replacing emoji, restyled controls/containers, and a small set of structural upgrades (popovers, modal close, search field, sidebar headers).

**Architecture:** Five sequential layers, single PR. L1 lays the design tokens. L2 swaps emoji to inline SVG. L3 restyles atoms (buttons, segmented, sliders, inputs, chips). L4 restyles containers (toolbar, sidebar, modals, popovers, lists). L5 makes the targeted structural changes from § 5 of the spec. Each layer commits when `npm test` (61 tests) and `npm run compile` both pass.

**Tech Stack:** Plain CSS variables, inline SVG sprite, vanilla TS template literal HTML, vanilla JS event handlers. No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-05-09-macos-ui-refresh-design.md`](../specs/2026-05-09-macos-ui-refresh-design.md)

---

## File Structure

| Path | Touched | Responsibility |
|---|---|---|
| `media/style.css` | full rewrite of 80-90% of rules | All visual tokens, control styles, container styles |
| `src/LabelMePanel.ts` | edits to `_getHtmlForWebview` template + new `getIconSprite()` helper | Inject SVG sprite, replace emoji button bodies with `<svg><use/></svg>`, add `.btn` classes, restructure popover/search/modal-close/header markup |
| `media/main.js` | small additions only | Modal close button handlers; popover click-outside dismissal helper; pure helper `shouldDismissPopover()` for unit testing |
| `test/popoverDismiss.test.js` | NEW | Unit tests for `shouldDismissPopover()` helper |

No file is moved. No file is deleted.

---

## Conventions for every task

- Run `npm run compile` after every edit that changes `.ts` files. Treat any compile error as the layer being broken.
- Run `npm test` after every commit. Expected: 61 pass / 0 fail (62 after Task 21).
- Commit messages start with `ui:` (this PR is purely UI).
- If a step asks you to "verify visually", launch the Extension Development Host (F5) and look — but only at the end of each layer, not after every micro-step.

---

## Task 0: Audit dynamic button creation (no edits)

**Files:** none modified.

- [ ] **Step 0.1: Confirm no dynamic `<button>` creation in JS.**

Run:
```
grep -n "createElement('button')" media/main.js
grep -n "createElement(\"button\")" media/main.js
grep -in "<button" media/main.js
```
Expected: no matches in any of the three. (Audit performed during planning — but the implementer must re-confirm in case the file changed.)

If matches appear: each new dynamic `<button>` creation site must add `.btn` (or `.btn-icon` / `.btn-primary`) explicitly when constructed, and the L3 button task below must be expanded to include those sites.

- [ ] **Step 0.2: Confirm `imageInfoBtn` element type.**

Run:
```
grep -n "imageInfoBtn" src/LabelMePanel.ts
```
Expected: a single match showing `<span id="imageInfoBtn" class="image-info-btn" title="Image Info">ℹ</span>` (it is a span, not a button — so it does not need `.btn` class, only icon-swap in L2).

---

## Task 1 (L1): Replace design tokens

**Files:** Modify `media/style.css` lines 1-96 (the `:root`, `.theme-light`, `body`, scrollbar blocks).

- [ ] **Step 1.1: Replace the `:root` block.**

Replace the existing block at [media/style.css:1-27](media/style.css#L1-L27) with the full token list from spec § 1.1 (the `:root { … }` block). Paste the exact 80 lines from the spec's first code block (everything from `--color-bg-primary` through `--blur-popover`).

- [ ] **Step 1.2: Replace the `.theme-light` block.**

Replace the existing block at [media/style.css:29-53](media/style.css#L29-L53) with the `body.theme-light { … }` block from spec § 1.1 (lines starting `--color-bg-primary: #ffffff;` through the `--shadow-modal:` override).

- [ ] **Step 1.3: Update `body` font.**

In the existing `body { … }` block at [media/style.css:55-68](media/style.css#L55-L68), add (insert before `font-family`):
```css
font-family: var(--font-system);
font-size: var(--font-13);
line-height: var(--line-normal);
-webkit-font-smoothing: antialiased;
```
…and remove the line `font-family: sans-serif;`.

- [ ] **Step 1.4: Update scrollbar tokens.**

The scrollbar rules at [media/style.css:70-96](media/style.css#L70-L96) already use the renamed tokens (`--color-scrollbar-thumb`, etc.) — no change needed; the new token values flow through automatically. No edit.

- [ ] **Step 1.5: Compile & test.**

```
npm run compile
npm test
```
Expected: compile clean, 61 tests pass.

- [ ] **Step 1.6: Commit.**

```
git add media/style.css
git commit -m "ui: replace CSS variables with macOS design tokens"
```

---

## Task 2 (L2a): Add icon SVG sprite and helper

**Files:**
- Modify: `src/LabelMePanel.ts` (add a new helper function, inject sprite into HTML).
- Modify: `media/style.css` (add `.icon` rules).

- [ ] **Step 2.1: Add `.icon` CSS rules.**

Append to `media/style.css`:

```css
/* Inline SVG icons (Lucide-style 1.6px stroke, currentColor) */
.icon { width: 16px; height: 16px; vertical-align: -3px; flex-shrink: 0; }
.icon-sm { width: 14px; height: 14px; }
.icon-lg { width: 18px; height: 18px; }
```

- [ ] **Step 2.2: Add `getIconSprite()` helper to LabelMePanel.ts.**

Inside the `LabelMePanel` class (just before `_getHtmlForWebview`), add this private method. The 22 symbols implement the icons in spec § 2.2:

```ts
private _getIconSprite(): string {
    const SW = 'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"';
    return `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
        <symbol id="icon-search" viewBox="0 0 24 24" ${SW}><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></symbol>
        <symbol id="icon-refresh-cw" viewBox="0 0 24 24" ${SW}><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/></symbol>
        <symbol id="icon-x" viewBox="0 0 24 24" ${SW}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></symbol>
        <symbol id="icon-panel-left" viewBox="0 0 24 24" ${SW}><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></symbol>
        <symbol id="icon-chevron-left" viewBox="0 0 24 24" ${SW}><polyline points="15 18 9 12 15 6"/></symbol>
        <symbol id="icon-chevron-right" viewBox="0 0 24 24" ${SW}><polyline points="9 18 15 12 9 6"/></symbol>
        <symbol id="icon-info" viewBox="0 0 24 24" ${SW}><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></symbol>
        <symbol id="icon-eye" viewBox="0 0 24 24" ${SW}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></symbol>
        <symbol id="icon-eye-off" viewBox="0 0 24 24" ${SW}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.51 18.51 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></symbol>
        <symbol id="icon-pentagon" viewBox="0 0 24 24" ${SW}><polygon points="12,2 22,9.5 18,21.5 6,21.5 2,9.5"/></symbol>
        <symbol id="icon-square" viewBox="0 0 24 24" ${SW}><rect x="3" y="3" width="18" height="18" rx="1"/></symbol>
        <symbol id="icon-slash" viewBox="0 0 24 24" ${SW}><line x1="5" y1="19" x2="19" y2="5"/></symbol>
        <symbol id="icon-dot" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="12" r="4"/></symbol>
        <symbol id="icon-sparkles" viewBox="0 0 24 24" ${SW}><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="3"/></symbol>
        <symbol id="icon-settings" viewBox="0 0 24 24" ${SW}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></symbol>
        <symbol id="icon-wrench" viewBox="0 0 24 24" ${SW}><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></symbol>
        <symbol id="icon-save" viewBox="0 0 24 24" ${SW}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></symbol>
        <symbol id="icon-sun" viewBox="0 0 24 24" ${SW}><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="6.34" y2="17.66"/><line x1="17.66" y1="6.34" x2="19.07" y2="4.93"/></symbol>
        <symbol id="icon-moon" viewBox="0 0 24 24" ${SW}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></symbol>
        <symbol id="icon-circle-half" viewBox="0 0 24 24" ${SW}><circle cx="12" cy="12" r="9"/><path d="M12 3v18" fill="currentColor" stroke="none"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/></symbol>
        <symbol id="icon-lock" viewBox="0 0 24 24" ${SW}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></symbol>
        <symbol id="icon-lock-open" viewBox="0 0 24 24" ${SW}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></symbol>
        <symbol id="icon-folder-open" viewBox="0 0 24 24" ${SW}><path d="M6 14l-2 6h17l2-6H6z"/><path d="M22 13V6a2 2 0 0 0-2-2h-7l-2-2H4a2 2 0 0 0-2 2v14"/></symbol>
        <symbol id="icon-cpu" viewBox="0 0 24 24" ${SW}><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></symbol>
        <symbol id="icon-download" viewBox="0 0 24 24" ${SW}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></symbol>
        <symbol id="icon-rotate-ccw" viewBox="0 0 24 24" ${SW}><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></symbol>
        <symbol id="icon-check" viewBox="0 0 24 24" ${SW}><polyline points="20 6 9 17 4 12"/></symbol>
    </defs></svg>`;
}
```

- [ ] **Step 2.3: Inject the sprite into the HTML.**

In `_getHtmlForWebview` in `src/LabelMePanel.ts`, locate the line that opens `<body>` (search for `<body>` inside the template literal). Immediately after `<body>` (or as the first child of `<body>`), insert:

```ts
                ${this._getIconSprite()}
```

- [ ] **Step 2.4: Compile & test.**

```
npm run compile
npm test
```
Expected: clean compile, 61 pass.

- [ ] **Step 2.5: Commit.**

```
git add media/style.css src/LabelMePanel.ts
git commit -m "ui: add inline SVG icon sprite + .icon CSS rules"
```

---

## Task 3 (L2b): Replace emoji with `<svg><use>` at every site

**Files:** Modify `src/LabelMePanel.ts` (HTML in `_getHtmlForWebview`).

Each step replaces one emoji site. The replacement form is:

```html
<svg class="icon" aria-hidden="true"><use href="#icon-NAME"/></svg>
```

For sites where the original `<button>` body is *only* an emoji, the entire body becomes the `<svg>` tag. For sites where the original is a span (not a button), same swap.

- [ ] **Step 3.1: Image browser header buttons.**

| Selector | Old body | New body |
|---|---|---|
| `#searchImagesBtn` | `🔍` | `<svg class="icon" aria-hidden="true"><use href="#icon-search"/></svg>` |
| `#refreshImagesBtn` | `🔄` | `<svg class="icon" aria-hidden="true"><use href="#icon-refresh-cw"/></svg>` |
| `#searchCloseBtn` | `✕` | `<svg class="icon icon-sm" aria-hidden="true"><use href="#icon-x"/></svg>` |

- [ ] **Step 3.2: Toolbar nav buttons.**

| `#imageBrowserToggleBtn` | `☰` | `<svg class="icon" aria-hidden="true"><use href="#icon-panel-left"/></svg>` |
| `#prevImageBtn` | `◀` | `<svg class="icon" aria-hidden="true"><use href="#icon-chevron-left"/></svg>` |
| `#nextImageBtn` | `▶` | `<svg class="icon" aria-hidden="true"><use href="#icon-chevron-right"/></svg>` |
| `#imageInfoBtn` (span) | `ℹ` | `<svg class="icon icon-sm" aria-hidden="true"><use href="#icon-info"/></svg>` |

- [ ] **Step 3.3: Mode toggle buttons.**

| `#viewModeBtn` | `👁️` | `#icon-eye` |
| `#polygonModeBtn` | `⬠` | `#icon-pentagon` |
| `#rectangleModeBtn` | `▭` | `#icon-square` |
| `#lineModeBtn` | `⟋` | `#icon-slash` |
| `#pointModeBtn` | `•` | `#icon-dot` |
| `#samModeBtn` | `🧠` | `#icon-sparkles` |

For each, the body becomes `<svg class="icon" aria-hidden="true"><use href="#…"/></svg>`.

- [ ] **Step 3.4: Sidebar action buttons.**

| `#settingsMenuBtn` | `⚙️` | `#icon-settings` |
| `#toolsMenuBtn` | `🛠️` | `#icon-wrench` |
| `#saveBtn` | `💾` | `#icon-save` |

- [ ] **Step 3.5: Theme buttons.**

| `#themeLightBtn` | `☀️` | `#icon-sun` |
| `#themeDarkBtn` | `🌙` | `#icon-moon` |
| `#themeAutoBtn` | `🔄` | `#icon-circle-half` |

- [ ] **Step 3.6: Lock buttons.**

For `#zoomLockBtn`, `#channelLockBtn`, `#brightnessLockBtn`, `#contrastLockBtn`, `#claheLockBtn`: each currently has body `🔓` (lock open). Replace with:

```html
<svg class="icon icon-sm" aria-hidden="true"><use href="#icon-lock-open"/></svg>
```

(The "is-locked" state — which paints the button accent and previously also swapped the emoji to `🔒` — will be handled in JS; see Step 3.10 below.)

- [ ] **Step 3.7: Slider reset spans.**

For `#brightnessResetBtn`, `#contrastResetBtn`, `#claheResetBtn`, and any other `slider-reset-btn` span containing `&#8634;`:

```html
<svg class="icon icon-sm" aria-hidden="true"><use href="#icon-rotate-ccw"/></svg>
```

(They are spans, so this is a body swap only.)

- [ ] **Step 3.8: Folder browse buttons.**

`#onnxModelDirBrowse`, `#onnxPythonPathBrowse`, `#samModelDirBrowse`, `#samPythonPathBrowse`: body `📂` → `<svg class="icon icon-sm" aria-hidden="true"><use href="#icon-folder-open"/></svg>`.

- [ ] **Step 3.9: Tools dropdown items + modal titles.**

| `#exportSvgMenuItem` | `📐` (prefix in label text) | Replace `📐 Export SVG` with `<svg class="icon icon-sm" aria-hidden="true"><use href="#icon-download"/></svg> Export SVG` |
| `#onnxBatchInferMenuItem` | `🤖` | …same with `#icon-cpu` and text `ONNX Batch Infer` |
| `#onnxInferModal h3` | `🤖 ONNX Batch Inference` | `<svg class="icon" aria-hidden="true"><use href="#icon-sparkles"/></svg> ONNX Batch Inference` |
| `#samConfigModal h3` | `🤖 SAM AI Annotation` | …same |
| ONNX/SAM `ⓘ` info hints (two sites with `<span class="onnx-hint">ⓘ`) | `ⓘ` | `<svg class="icon icon-sm" aria-hidden="true"><use href="#icon-info"/></svg>` |

- [ ] **Step 3.10: Update lock-button toggle JS.**

In `media/main.js`, search for any code that flips a lock button's text content between `🔓` and `🔒` (likely along the lines of `el.textContent = locked ? '🔒' : '🔓'`).

For each match, replace with:

```js
el.innerHTML = locked
    ? '<svg class="icon icon-sm" aria-hidden="true"><use href="#icon-lock"/></svg>'
    : '<svg class="icon icon-sm" aria-hidden="true"><use href="#icon-lock-open"/></svg>';
```

If no such code exists (the lock state is purely visual via `.locked` class), no change needed; verify by searching the file:
```
grep -n "🔒\|🔓" media/main.js
```
If matches exist, update each. If none, skip.

- [ ] **Step 3.11: CLAHE toggle button text update.**

`#claheToggleBtn` body is currently `Off` (text). Leave as text; do not swap to icon — text labels are clearer for binary state and fit the segmented idiom.

- [ ] **Step 3.12: Compile & test.**

```
npm run compile
npm test
```
Expected: clean compile, 61 pass.

- [ ] **Step 3.13: Final emoji audit.**

```
grep -nP "[\x{1F300}-\x{1FAFF}]|[\x{2600}-\x{27BF}]" src/LabelMePanel.ts
```
Expected: no matches. (If any remain — e.g., a string label or comment — verify each is intentional, not a missed icon site.)

- [ ] **Step 3.14: Commit.**

```
git add src/LabelMePanel.ts media/main.js
git commit -m "ui: replace emoji icons with inline SVG <use> references"
```

---

## Task 4 (L3a): Restyle buttons

**Files:** Modify `media/style.css` (replace [media/style.css:323-346](media/style.css#L323-L346) and add new rules).

- [ ] **Step 4.1: Replace the global `button { … }` block.**

At [media/style.css:323-346](media/style.css#L323-L346), delete the existing `button { … }`, `button:hover`, `button:disabled`, `button.dirty` rules.

Insert the following block in their place:

```css
/* Reset native button styling so explicit classes win */
button { all: unset; cursor: pointer; box-sizing: border-box; }
button:focus-visible { outline: none; }

/* ---------- .btn (default secondary) ---------- */
.btn {
    appearance: none;
    background: var(--color-bg-input);
    color: var(--color-text-primary);
    border: 0.5px solid var(--color-border-input);
    border-radius: var(--radius-sm);
    font: inherit;
    line-height: 1;
    padding: 5px 12px;
    box-shadow: var(--shadow-2);
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    transition: background-color var(--dur-fast) var(--ease-standard),
                box-shadow var(--dur-fast) var(--ease-standard);
}
.btn:hover    { background: var(--color-bg-hover-input); }
.btn:active   { background: var(--color-bg-active); transform: translateY(0.5px); }
.btn:disabled { background: var(--color-bg-tertiary); color: var(--color-text-disabled);
                box-shadow: none; cursor: default; }
.btn:focus-visible { box-shadow: var(--shadow-2), var(--shadow-focus); }

.btn-primary { background: var(--color-accent); color: #fff; border-color: transparent; }
.btn-primary:hover  { background: var(--color-accent-hover); }
.btn-primary:active { background: var(--color-accent-active); }
.btn-primary:focus-visible { box-shadow: var(--shadow-focus); }

.btn-icon { padding: 5px; min-width: 28px; min-height: 28px; justify-content: center; }
.btn-danger { background: var(--color-danger); color: #fff; border-color: transparent; }

/* dirty state preserved for save button */
.btn.dirty, .sidebar-icon-btn.dirty { background: var(--color-accent); color: #fff;
                                       border-color: transparent; }
```

- [ ] **Step 4.2: Add `.btn` / `.btn-icon` / `.btn-primary` classes to every static `<button>` in `src/LabelMePanel.ts`.**

There are 36 `<button>` elements in `src/LabelMePanel.ts`. For each, add the appropriate class according to this rule:

- **Modal action buttons** (`#modalOkBtn`, `#colorOkBtn`, `#onnxInferOkBtn`, `#samConfigOkBtn`): add `class="btn btn-primary"`.
- **Modal cancel buttons** (`#modalCancelBtn`, `#colorCancelBtn`, `#onnxInferCancelBtn`, `#samConfigCancelBtn`): add `class="btn"`.
- **Toolbar nav buttons** that already have `class="nav-btn"`: replace with `class="btn btn-icon nav-btn"`. (Keep `nav-btn` so `.toolbar` gap rule and any JS selectors keep working.)
- **Header buttons** that already have `class="header-btn"`: replace with `class="btn btn-icon header-btn"`.
- **Mode toggle buttons** (`#viewModeBtn` etc., already `mode-btn`): keep `mode-btn` class only — they are styled by `.segmented-item` rule (Task 5). Do not add `.btn` here.
- **Theme/onnx-radio buttons**: same — they are segmented items. Keep their existing class only.
- **Sidebar action icon buttons** (`#settingsMenuBtn`, `#toolsMenuBtn`, `#saveBtn`, already `sidebar-icon-btn`): keep `sidebar-icon-btn` only — segmented styling.
- **Lock buttons** (`#zoomLockBtn` etc., already `zoom-lock-btn`): replace with `class="btn-icon zoom-lock-btn"` (the existing class becomes a positional/sizing helper; visuals come from `.btn-icon`).
- **Browse buttons** (`#onnxModelDirBrowse` etc., `onnx-browse-btn`): replace with `class="btn btn-icon onnx-browse-btn"`.
- **Channel toggle button** (`#claheToggleBtn`, `channel-btn`): keep `channel-btn` (has its own segmented-style rule until Task 5 collapses it).
- **Advanced options btn** (`.advanced-options-btn`): replace with `class="btn btn-icon advanced-options-btn"`.

After this step, every `<button>` has at least one of: `.btn`, `.btn-icon`, `.btn-primary`, `.mode-btn` (segmented), `.theme-btn` (segmented), `.onnx-radio` (segmented label, see § 5), `.sidebar-icon-btn` (segmented), `.channel-btn`, `.zoom-lock-btn` + `.btn-icon`. None should be styled solely by the `button` selector.

- [ ] **Step 4.3: Compile & test.**

```
npm run compile
npm test
```
Expected: clean, 61 pass.

- [ ] **Step 4.4: Visual sanity smoke (quick).**

Launch Extension Development Host, open one image, verify:
- Toolbar nav buttons render with backgrounds (not transparent).
- Modal OK button is blue, Cancel is grey.
- Save button shows dirty-state blue when an annotation is added.

If any button looks unstyled / transparent, that site missed a `.btn` class — go back and add it. (Common miss: dynamically created elements; re-run Task 0 audit.)

- [ ] **Step 4.5: Commit.**

```
git add media/style.css src/LabelMePanel.ts
git commit -m "ui: introduce .btn / .btn-icon / .btn-primary atoms"
```

---

## Task 5 (L3b): Consolidate segmented controls

**Files:** Modify `media/style.css`. Modify `src/LabelMePanel.ts` to add `.segmented-group` / `.segmented-item` aliases.

- [ ] **Step 5.1: Add the unified segmented rules.**

Insert into `media/style.css` (anywhere after the buttons block from Task 4):

```css
/* ---------- segmented control (mode/theme/onnx-radio/sidebar-actions) ---------- */
.segmented-group {
    display: inline-flex;
    background: var(--color-bg-tertiary);
    border-radius: var(--radius-md);
    padding: 2px;
    gap: 2px;
    box-shadow: inset 0 0 0 0.5px var(--color-border);
}
.segmented-item {
    flex: 1;
    appearance: none;
    background: transparent;
    border: none;
    color: var(--color-text-primary);
    border-radius: var(--radius-sm);
    padding: 4px 10px;
    font: inherit;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    transition: background var(--dur-fast) var(--ease-standard);
}
.segmented-item:hover  { background: var(--color-bg-hover); }
.segmented-item.active,
.segmented-group > label.onnx-radio:has(input:checked),
.segmented-item.locked {
    background: var(--color-bg-input);
    box-shadow: var(--shadow-2);
    color: var(--color-text-primary);
}
.segmented-group > label.onnx-radio:has(input:checked) {
    background: var(--color-accent);  /* radio-style segments use solid accent for selected */
    color: #fff;
}
```

- [ ] **Step 5.2: Delete the old per-component segmented blocks.**

Remove these now-redundant blocks from `media/style.css`:
- `.theme-toggle-group`, `.theme-btn`, `.theme-btn:last-child`, `.theme-btn:hover`, `.theme-btn.active` ([media/style.css:793-824](media/style.css#L793-L824))
- `.mode-toggle-group`, `.mode-btn`, `.mode-btn:last-child`, `.mode-btn:hover`, `.mode-btn.active` ([media/style.css:991-1023](media/style.css#L991-L1023))
- `.onnx-radio-group`, `.onnx-radio`, `.onnx-radio:last-child`, `.onnx-radio:hover`, `.onnx-radio:has(input:checked)` ([media/style.css:1377-1415](media/style.css#L1377-L1415))
- `.sidebar-actions`, `.sidebar-icon-btn`, `.sidebar-icon-btn:last-child`, `.sidebar-icon-btn:hover`, `.sidebar-icon-btn:disabled`, `.sidebar-icon-btn:disabled:hover`, `.sidebar-icon-btn.dirty`, `.sidebar-icon-btn.dirty:hover`, `.sidebar-icon-btn.locked` ([media/style.css:1034-1093](media/style.css#L1034-L1093))

(These all collapse into the unified `.segmented-*` rules.)

- [ ] **Step 5.3: Add `.segmented-group` / `.segmented-item` class aliases in HTML.**

In `src/LabelMePanel.ts`, add both classes alongside existing class names (do not remove existing — JS selectors use them):

| Element | Old class | New class |
|---|---|---|
| `.mode-toggle-group` div | `mode-toggle-group` | `mode-toggle-group segmented-group` |
| `#viewModeBtn` etc. (6 mode buttons) | `mode-btn …` | `mode-btn segmented-item …` |
| `.theme-toggle-group` div | `theme-toggle-group` | `theme-toggle-group segmented-group` |
| `#themeLightBtn` etc. (3 theme buttons) | `theme-btn …` | `theme-btn segmented-item …` |
| Every `.onnx-radio-group` div (6 sites) | `onnx-radio-group` | `onnx-radio-group segmented-group` |
| Every `.onnx-radio` label inside | `onnx-radio` | (do not change — see § 5.1 selector that handles the label form) |
| `.sidebar-actions` div | `sidebar-actions` | `sidebar-actions segmented-group` |
| `#settingsMenuBtn`, `#toolsMenuBtn`, `#saveBtn` | `sidebar-icon-btn` | `sidebar-icon-btn segmented-item` |

- [ ] **Step 5.4: Confirm `disabled` styling for `#saveBtn`.**

The save button has `disabled` attribute initially. With the new `.segmented-item` rule, add to CSS:

```css
.segmented-item:disabled { opacity: 0.4; cursor: default; background: transparent; }
```

(Append to the segmented block from Step 5.1.)

- [ ] **Step 5.5: Compile, test, visual sanity.**

```
npm run compile
npm test
```
Then F5 → verify mode buttons, theme buttons, sidebar actions all show:
- The "active" item has a slightly raised pill background.
- The container has a subtle inset background showing the segmented track.
- ONNX modal radio groups still highlight the chosen option in accent blue.

- [ ] **Step 5.6: Commit.**

```
git add media/style.css src/LabelMePanel.ts
git commit -m "ui: consolidate mode/theme/radio/sidebar groups into .segmented-*"
```

---

## Task 6 (L3c): Restyle sliders, inputs, label chips

**Files:** Modify `media/style.css`.

- [ ] **Step 6.1: Replace slider rules.**

Delete every existing `input[type="range"]` rule from `media/style.css`:
- `.slider-control input[type="range"]`, `.slider-control input[type="range"]::-webkit-slider-thumb`, `.slider-control input[type="range"]::-moz-range-thumb` ([media/style.css:737-762](media/style.css#L737-L762))
- `.zoom-control input[type="range"]`, `.zoom-control input[type="range"]::-webkit-slider-thumb`, `.zoom-control input[type="range"]::-moz-range-thumb` ([media/style.css:837-863](media/style.css#L837-L863))

Insert the unified slider rules from spec § 3.3 (the entire `input[type="range"]` block — track, webkit thumb, moz thumb, hover scale, focus ring).

- [ ] **Step 6.2: Replace input/textarea rules.**

Delete the input rules at:
- `.modal-content input` ([media/style.css:438-446](media/style.css#L438-L446))
- `.modal-content textarea` ([media/style.css:448-461](media/style.css#L448-L461))
- `.search-input-container input`, `.search-input-container input:focus` ([media/style.css:1189-1203](media/style.css#L1189-L1203))
- `.custom-color-input input` ([media/style.css:632-640](media/style.css#L632-L640))
- `.onnx-path-input input` ([media/style.css:1350-1359](media/style.css#L1350-L1359))

Replace with the unified rules from spec § 3.4:

```css
input[type="text"], input[type="number"], input[type="search"], textarea {
    background: var(--color-bg-input);
    border: 0.5px solid var(--color-border-input);
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
    font: inherit;
    padding: 6px 10px;
    box-shadow: inset 0 1px 1px rgba(0,0,0,0.04);
    transition: border-color var(--dur-fast), box-shadow var(--dur-fast);
    box-sizing: border-box;
}
input:focus-visible, textarea:focus-visible {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: var(--shadow-focus);
}
textarea { resize: vertical; min-height: 36px; max-height: 120px; }
.modal-content input, .modal-content textarea { width: 100%; margin: 10px 0; }
.custom-color-input input { font-family: var(--font-mono); }
```

- [ ] **Step 6.3: Restyle label chips.**

Replace `.label-chip`, `.label-chip:hover`, `.label-chip.selected`, `.chip-shortcut-badge` rules at [media/style.css:495-529](media/style.css#L495-L529) with the spec § 3.5 versions:

```css
.label-chip {
    position: relative;
    background: var(--color-bg-input);
    border: 0.5px solid var(--color-border-input);
    border-radius: var(--radius-pill);
    padding: 3px 10px;
    font-size: var(--font-12);
    cursor: pointer;
    transition: background var(--dur-fast), color var(--dur-fast);
}
.label-chip:hover { background: var(--color-bg-hover-input); }
.label-chip.selected {
    background: var(--color-accent);
    color: #fff;
    border-color: transparent;
}
.chip-shortcut-badge {
    position: absolute;
    top: -6px; left: -6px;
    background: rgba(0,0,0,0.6);
    color: #fff;
    font-family: var(--font-mono);
    font-size: 10px;
    line-height: 14px;
    border-radius: 3px;
    min-width: 14px;
    padding: 0 3px;
    text-align: center;
    pointer-events: none;
    display: none;
}
#recentLabels.show-shortcuts .chip-shortcut-badge { display: block; }
```

- [ ] **Step 6.4: Compile, test, visual sanity.**

```
npm run compile
npm test
```
F5 → verify sliders have white thumbs that scale on hover, inputs show focus ring on tab, label chips look pill-shaped with shortcut badges visible when modal opens.

- [ ] **Step 6.5: Commit.**

```
git add media/style.css
git commit -m "ui: macOS-style sliders, inputs, label chips"
```

---

## Task 7 (L3d): Lock buttons + advanced options + remaining atoms

**Files:** Modify `media/style.css`. Modify `media/main.js` for lock state.

- [ ] **Step 7.1: Replace lock button rules.**

The existing `.zoom-lock-btn` ([media/style.css:875-899](media/style.css#L875-L899)) is widely reused (zoom, channel, brightness, contrast, CLAHE). Replace with a single rule:

```css
.zoom-lock-btn {
    /* container layout helper kept for backward compat */
    flex: 0 0 auto;
    margin: 0;
    line-height: 1;
}
.zoom-lock-btn.locked,
.btn-icon.is-locked {
    background: var(--color-accent);
    color: #fff;
    border-color: transparent;
}
.zoom-lock-btn.locked:hover {
    background: var(--color-accent-hover);
}
```

- [ ] **Step 7.2: Replace channel button rules (now redundant).**

Remove `.channel-btn`, `.channel-btn:hover`, `.channel-btn.active` ([media/style.css:902-923](media/style.css#L902-L923)) and replace with:

```css
.channel-btn {
    /* used by CLAHE on/off toggle — minimal styling, segmented look */
    background: var(--color-bg-input);
    color: var(--color-text-primary);
    border: 0.5px solid var(--color-border-input);
    border-radius: var(--radius-sm);
    padding: 4px 10px;
    font-size: var(--font-12);
    cursor: pointer;
    transition: background var(--dur-fast), color var(--dur-fast);
}
.channel-btn:hover { background: var(--color-bg-hover-input); }
.channel-btn.active {
    background: var(--color-accent);
    color: #fff;
    border-color: transparent;
}
```

- [ ] **Step 7.3: Replace nav button + advanced options + image info rules.**

Delete (now subsumed by `.btn`):
- `.nav-btn`, `.nav-btn:hover` ([media/style.css:926-937](media/style.css#L926-L937))
- `.advanced-options-btn`, `.advanced-options-btn:hover` ([media/style.css:700-715](media/style.css#L700-L715))
- `.image-info-btn`, `.image-info-btn:hover` ([media/style.css:940-953](media/style.css#L940-L953))

Add small positional helpers if needed (these were ONLY for layout, not visual styling):

```css
.nav-btn         { /* no extra styling — covered by .btn .btn-icon */ }
.advanced-options-btn { opacity: 0.7; }
.advanced-options-btn:hover { opacity: 1; }
.image-info-btn  { padding: 2px 6px; opacity: 0.6; cursor: pointer; user-select: none; }
.image-info-btn:hover { opacity: 1; }
```

- [ ] **Step 7.4: Compile, test, visual sanity.**

```
npm run compile
npm test
```
F5 → verify lock buttons toggle to blue when locked, CLAHE on/off toggles between accent and neutral, nav arrows look uniform.

- [ ] **Step 7.5: Commit.**

```
git add media/style.css media/main.js
git commit -m "ui: lock buttons, channel button, nav/info atom cleanup"
```

---

## Task 8 (L4a): Restyle toolbar and sidebar

**Files:** Modify `media/style.css`.

- [ ] **Step 8.1: Update toolbar rules.**

Replace `.toolbar` ([media/style.css:312-321](media/style.css#L312-L321)) with:

```css
.toolbar {
    height: 38px;
    background: var(--color-bg-secondary);
    border-bottom: 0.5px solid var(--color-border);
    padding: 0 var(--space-3);
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
    position: relative;
}
```

(Loses the per-button `margin-right: 10px` — replaced by container `gap`. Verify by removing the `margin-right` from the now-deleted global `button {}` happened in Task 4.)

- [ ] **Step 8.2: Update sidebar layout rules.**

Update the sidebar rules at [media/style.css:112-226](media/style.css#L112-L226). Specifically:

- `.sidebar`: change `padding: 10px;` to `padding: var(--space-3);`. Background already uses the token.
- `.sidebar-labels-section h3`, `.sidebar-instances-section h3`, `.labels-section h3`, `.sidebar h3`: replace each occurrence with:

```css
.sidebar h3,
.sidebar-labels-section h3,
.sidebar-instances-section h3,
.labels-section h3 {
    margin: 0 0 var(--space-2) 0;
    font-size: var(--font-12);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--color-text-secondary);
    flex-shrink: 0;
}
```

(Replace each separate definition; the consolidated rule above covers all four.)

- `.section-count`: change `font-size: 11px;` → `font-size: var(--font-12);`. Color stays `--color-text-muted`.

- [ ] **Step 8.3: Update sidebar resizers.**

Replace `.sidebar-section-resizer`, `.sidebar-section-resizer:hover`, `.sidebar-section-resizer.resizing`, `.resizer`, `.resizer:hover`, `.resizer.resizing`, `.image-browser-resizer`, `.image-browser-resizer:hover`, `.image-browser-resizer.resizing` rules ([media/style.css:163-218](media/style.css#L163-L218) and [media/style.css:1252-1262](media/style.css#L1252-L1262)) with:

```css
.resizer, .image-browser-resizer {
    width: 1px;
    background: var(--color-border);
    cursor: col-resize;
    transition: background var(--dur-base), width var(--dur-base);
    flex-shrink: 0;
}
.sidebar-section-resizer {
    height: 1px;
    background: var(--color-border);
    cursor: row-resize;
    transition: background var(--dur-base), height var(--dur-base);
    flex-shrink: 0;
}
.resizer:hover, .resizer.resizing,
.image-browser-resizer:hover, .image-browser-resizer.resizing {
    background: var(--color-accent);
    width: 3px;
}
.sidebar-section-resizer:hover, .sidebar-section-resizer.resizing {
    background: var(--color-accent);
    height: 3px;
}
```

- [ ] **Step 8.4: Update shape list and labels list rows.**

Replace `#shapeList li`, `#shapeList li:hover`, `#shapeList li.active` ([media/style.css:234-251](media/style.css#L234-L251)) with:

```css
#shapeList li {
    padding: 6px var(--space-2);
    cursor: pointer;
    border-radius: var(--radius-sm);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    border-left: 3px solid transparent;
    margin-bottom: 2px;
    transition: background var(--dur-fast);
}
#shapeList li:hover  { background: var(--color-bg-hover); }
#shapeList li.active {
    background: var(--color-bg-active);
    border-left-color: var(--color-accent);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}
```

Replace `#labelsList li`, `#labelsList li:hover` ([media/style.css:556-568](media/style.css#L556-L568)) with:

```css
#labelsList li {
    padding: 6px var(--space-2);
    cursor: pointer;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    margin-bottom: 2px;
    gap: var(--space-2);
    transition: background var(--dur-fast);
}
#labelsList li:hover { background: var(--color-bg-hover); }
```

- [ ] **Step 8.5: Compile, test, visual sanity.**

```
npm run compile
npm test
```
F5 → verify sidebar headers look refined (uppercase, smaller, more letter-spacing), resizers are hairline at rest, list items have rounded hover backgrounds.

- [ ] **Step 8.6: Commit.**

```
git add media/style.css
git commit -m "ui: restyle toolbar, sidebar headers, resizers, list rows"
```

---

## Task 9 (L4b): Restyle modals

**Files:** Modify `media/style.css`.

- [ ] **Step 9.1: Replace modal rules.**

Replace [media/style.css:411-467](media/style.css#L411-L467) (the `.modal`, `.modal-content`, `.modal-content h3`, `.modal-content input`, `.modal-content textarea`, `.modal-buttons` blocks — note input/textarea were already replaced in Task 6, so only modal/modal-content/h3/buttons remain) with:

```css
.modal {
    display: none;
    position: fixed;
    z-index: 1000;
    inset: 0;
    background: var(--color-modal-overlay);
    backdrop-filter: blur(4px);
    justify-content: center;
    align-items: center;
}
.modal-content {
    position: relative;       /* anchor for the close button added in Task 12 */
    background: var(--color-bg-popover);
    backdrop-filter: var(--blur-popover);
    border: none;
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-modal);
    padding: var(--space-5);
    min-width: 320px;
    max-width: min(560px, 92vw);
    box-sizing: border-box;
    color: var(--color-text-primary);
    animation: modal-in var(--dur-base) var(--ease-emphasized);
}
.modal-content h3 {
    margin: 0 0 var(--space-3) 0;
    font-size: var(--font-17);
    font-weight: 600;
    color: var(--color-text-primary);
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
.modal-buttons {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-4);
}
@keyframes modal-in {
    from { opacity: 0; transform: scale(0.97); }
    to   { opacity: 1; transform: scale(1); }
}
```

- [ ] **Step 9.2: Compile, test, visual sanity.**

```
npm run compile
npm test
```
F5 → click "+" on a label / open color picker / open ONNX dialog. Verify:
- Backdrop has subtle blur.
- Modal has rounded corners + soft shadow + appears with a small zoom-in animation.
- Modal title has icon + text aligned (where applicable).
- Buttons aligned right with proper gap, OK is blue.

- [ ] **Step 9.3: Commit.**

```
git add media/style.css
git commit -m "ui: restyle modals with blur backdrop and animation"
```

---

## Task 10 (L4c): Restyle context menu, image browser items, color palette

**Files:** Modify `media/style.css`.

- [ ] **Step 10.1: Replace context menu rules.**

Replace `.shape-context-menu`, `.context-menu-item`, `.context-menu-item:hover`, `.context-menu-item:active`, `.context-menu-item.context-menu-danger`, `.context-menu-item.context-menu-danger:hover` at [media/style.css:1269-1302](media/style.css#L1269-L1302) with:

```css
.shape-context-menu {
    position: absolute;
    background: var(--color-bg-popover);
    backdrop-filter: var(--blur-popover);
    border: 0.5px solid var(--color-border-secondary);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-3);
    padding: var(--space-1);
    z-index: 1000;
    min-width: 160px;
    overflow: hidden;
    animation: popover-in var(--dur-fast) var(--ease-standard);
}
@keyframes popover-in {
    from { opacity: 0; transform: scale(0.96) translateY(-2px); }
    to   { opacity: 1; transform: scale(1) translateY(0); }
}
.context-menu-item {
    padding: 5px 10px;
    border-radius: var(--radius-xs);
    cursor: pointer;
    font-size: var(--font-13);
    color: var(--color-text-primary);
    transition: background var(--dur-fast), color var(--dur-fast);
}
.context-menu-item:hover {
    background: var(--color-accent);
    color: #fff;
}
.context-menu-item.context-menu-danger { color: var(--color-danger); }
.context-menu-item.context-menu-danger:hover { background: var(--color-danger); color: #fff; }
```

- [ ] **Step 10.2: Update image browser items.**

Replace `.image-browser-item`, `.image-browser-item:hover`, `.image-browser-item.active` at [media/style.css:1230-1249](media/style.css#L1230-L1249):

```css
.image-browser-item {
    padding: 6px var(--space-3);
    cursor: pointer;
    border-left: 3px solid transparent;
    font-size: var(--font-13);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--color-text-primary);
    transition: background var(--dur-fast);
}
.image-browser-item:hover { background: var(--color-bg-hover); }
.image-browser-item.active {
    background: color-mix(in srgb, var(--color-accent) 14%, transparent);
    border-left-color: var(--color-accent);
}
```

- [ ] **Step 10.3: Update image browser header.**

Update `.image-browser-header` ([media/style.css:1137-1144](media/style.css#L1137-L1144)) padding to `var(--space-3)` and the header h3 styling already covered by Task 8 sidebar h3 rule; ensure no duplicate definition exists. If the sidebar h3 selector doesn't catch `.image-browser-header h3`, add it explicitly to the consolidated rule from Task 8.2:

```css
.sidebar h3, .sidebar-labels-section h3, .sidebar-instances-section h3,
.labels-section h3, .image-browser-header h3 { /* same body */ }
```

- [ ] **Step 10.4: Update color palette.**

Replace `.color-option`, `.color-option:hover`, `.color-option.selected` at [media/style.css:661-679](media/style.css#L661-L679) with:

```css
.color-option {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 50%;
    cursor: pointer;
    box-shadow: 0 0 0 0.5px rgba(0,0,0,0.18) inset;
    transition: transform var(--dur-fast) var(--ease-standard),
                box-shadow var(--dur-fast) var(--ease-standard);
    min-width: 26px;
}
.color-option:hover { transform: scale(1.1); }
.color-option.selected {
    box-shadow: 0 0 0 0.5px rgba(0,0,0,0.18) inset,
                0 0 0 3px var(--color-bg-secondary),
                0 0 0 5px var(--color-accent);
    transform: scale(1.08);
}
```

- [ ] **Step 10.5: Update label color indicator.**

Replace `.label-color-indicator`, `.label-color-indicator:hover` at [media/style.css:570-581](media/style.css#L570-L581):

```css
.label-color-indicator {
    width: 14px;
    height: 14px;
    border-radius: var(--radius-xs);
    box-shadow: 0 0 0 0.5px rgba(0,0,0,0.2) inset;
    flex-shrink: 0;
    cursor: pointer;
    transition: transform var(--dur-fast);
}
.label-color-indicator:hover { transform: scale(1.15); }
```

- [ ] **Step 10.6: Compile, test, visual sanity.**

```
npm run compile
npm test
```
F5 → right-click a shape (verify context menu has blur + accent hover), open color picker (verify circular swatches + halo on selection), pick an image in the browser (verify subtle accent-tinted active row).

- [ ] **Step 10.7: Commit.**

```
git add media/style.css
git commit -m "ui: macOS-style context menu, image browser items, color palette"
```

---

## Task 11 (L5a): Settings/tools dropdown → popover with arrow

**Files:** Modify `media/style.css`. Modify `src/LabelMePanel.ts`. Add `media/main.js` click-outside dismissal helper. Add unit tests.

- [ ] **Step 11.1: Add a `position: relative` anchor on the sidebar toolbar.**

In `media/style.css`, find `.sidebar-toolbar` ([media/style.css:1026-1032](media/style.css#L1026-L1032)) and add `position: relative;` to the rule. (Existing rules unchanged otherwise.)

- [ ] **Step 11.2: Replace `.sidebar-dropdown` rules.**

Replace `.sidebar-dropdown` ([media/style.css:717-724](media/style.css#L717-L724)) and the related `.sidebar-dropdown .theme-control` etc. ([media/style.css:1096-1108](media/style.css#L1096-L1108)) with the popover styling:

```css
.sidebar-dropdown {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    min-width: 240px;
    background: var(--color-bg-popover);
    backdrop-filter: var(--blur-popover);
    border: 0.5px solid var(--color-border-secondary);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-3);
    padding: var(--space-2);
    z-index: 100;
    animation: popover-in var(--dur-fast) var(--ease-standard);
}
.sidebar-dropdown::before {
    content: "";
    position: absolute;
    top: -5px; right: 12px;
    width: 10px; height: 10px;
    background: inherit;
    backdrop-filter: inherit;
    border-left:  0.5px solid var(--color-border-secondary);
    border-top:   0.5px solid var(--color-border-secondary);
    transform: rotate(45deg);
}
.sidebar-dropdown .theme-control,
.sidebar-dropdown .zoom-control,
.sidebar-dropdown .slider-control { padding: 0 var(--space-2); }
.sidebar-dropdown .theme-control:first-child { padding-top: var(--space-1); }
.sidebar-dropdown .slider-control:last-child  { padding-bottom: var(--space-1); }
```

- [ ] **Step 11.3: Verify popover layout doesn't break the column.**

F5 → click gear → verify popover floats over the labels list (no longer pushes it down). Note any positional issue (e.g., popover clipped by sidebar boundary). If clipped, add to the rule:

```css
.sidebar-config-section { overflow: visible; }
```

(Append to the existing `.sidebar-config-section` rule near [media/style.css:122-125](media/style.css#L122-L125).) The original `overflow: hidden` on `.sidebar` does not apply to absolutely-positioned children outside the flow.

If the popover is still clipped by `.sidebar { overflow: hidden }` ([media/style.css:118](media/style.css#L118)), change that line to `overflow: visible;` — the sidebar's children that need clipping (lists) handle it themselves.

- [ ] **Step 11.4: Write the failing test for `shouldDismissPopover`.**

Create `test/popoverDismiss.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { shouldDismissPopover } = require('../media/popoverDismiss.js');

test('dismisses when click target is outside both popover and trigger', () => {
    const popover = { contains: (el) => el === popover };
    const trigger = { contains: (el) => el === trigger };
    const target = { id: 'elsewhere' };
    assert.strictEqual(shouldDismissPopover(target, popover, trigger), true);
});

test('does not dismiss when click target is inside the popover', () => {
    const inside = {};
    const popover = { contains: (el) => el === inside };
    const trigger = { contains: () => false };
    assert.strictEqual(shouldDismissPopover(inside, popover, trigger), false);
});

test('does not dismiss when click target is inside the trigger', () => {
    const trigger = { contains: () => true };
    const popover = { contains: () => false };
    assert.strictEqual(shouldDismissPopover({}, popover, trigger), false);
});

test('returns false when popover is null (already closed)', () => {
    assert.strictEqual(shouldDismissPopover({}, null, {}), false);
});
```

- [ ] **Step 11.5: Run the test (expect FAIL).**

```
npm test
```
Expected: 1 failure — `Cannot find module '../media/popoverDismiss.js'`.

- [ ] **Step 11.6: Implement the helper.**

Create `media/popoverDismiss.js`:

```js
function shouldDismissPopover(clickTarget, popoverEl, triggerEl) {
    if (!popoverEl) return false;
    if (popoverEl.contains(clickTarget)) return false;
    if (triggerEl && triggerEl.contains(clickTarget)) return false;
    return true;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { shouldDismissPopover };
}
if (typeof window !== 'undefined') {
    window.LabelEditorHelpers = window.LabelEditorHelpers || {};
    window.LabelEditorHelpers.shouldDismissPopover = shouldDismissPopover;
}
```

(The repo already loads multiple JS files via `<script>` tags — see how `polygon-clipping.umd.min.js` is loaded; add a `<script>` tag for `popoverDismiss.js` in `_getHtmlForWebview`.)

- [ ] **Step 11.7: Add the script tag.**

In `src/LabelMePanel.ts`, locate the `<script>` tags inside `_getHtmlForWebview`. Add one for the new helper, e.g.:

```ts
                <script src="${webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'popoverDismiss.js'))}"></script>
```

(Place it before `<script src="…/main.js"></script>` so the helper is defined first.)

- [ ] **Step 11.8: Run tests (expect PASS).**

```
npm test
```
Expected: 65 pass / 0 fail (61 + 4 new).

- [ ] **Step 11.9: Wire click-outside dismissal in `media/main.js`.**

Find the existing toggle handlers for `#settingsMenuBtn` and `#toolsMenuBtn` (they currently flip `display: block`/`display: none` on the dropdown). Just after each toggle that opens the dropdown, install a one-shot dismissal listener:

```js
function installPopoverDismiss(popoverEl, triggerEl, closeFn) {
    const handler = (e) => {
        if (window.LabelEditorHelpers.shouldDismissPopover(e.target, popoverEl, triggerEl)) {
            closeFn();
            document.removeEventListener('mousedown', handler, true);
        }
    };
    // capture phase so we beat any stopPropagation inside
    document.addEventListener('mousedown', handler, true);
}
```

…and at each "open" site:

```js
installPopoverDismiss(settingsDropdown, settingsBtn, () => settingsDropdown.style.display = 'none');
```

(Adjust variable names to match the existing code. Identify them by the existing `display = 'block'` / `display = 'none'` pairs around `settingsMenuDropdown` and `toolsMenuDropdown`.)

- [ ] **Step 11.10: Compile, test, visual sanity.**

```
npm run compile
npm test
```
F5 → click gear (verify popover with arrow), click anywhere outside (verify it dismisses), reopen, click an item inside (verify it does NOT dismiss prematurely — it should stay open until that item's own action closes it OR you click outside).

- [ ] **Step 11.11: Commit.**

```
git add media/style.css media/main.js media/popoverDismiss.js src/LabelMePanel.ts test/popoverDismiss.test.js
git commit -m "ui: convert settings/tools dropdown to popover with arrow + click-outside dismiss"
```

---

## Task 12 (L5b): Modal close button

**Files:** Modify `src/LabelMePanel.ts`. Modify `media/main.js`. Modify `media/style.css`.

- [ ] **Step 12.1: Add `.modal-close` CSS.**

Append to `media/style.css`:

```css
.modal-close {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
    background: transparent;
    color: var(--color-text-secondary);
    border: none;
    border-radius: var(--radius-xs);
    padding: 4px;
    width: 24px; height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background var(--dur-fast), color var(--dur-fast);
}
.modal-close:hover {
    background: var(--color-bg-hover);
    color: var(--color-text-primary);
}
```

- [ ] **Step 12.2: Add a close button to every modal in HTML.**

For each of `#labelModal`, `#colorPickerModal`, `#onnxInferModal`, `#samConfigModal`: inside `<div class="modal-content …">`, immediately before the `<h3>`, insert:

```html
<button class="modal-close" data-modal-close="<MODAL_ID>" aria-label="Close">
    <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-x"/></svg>
</button>
```

Where `<MODAL_ID>` is the id of the enclosing modal (e.g., `labelModal`).

- [ ] **Step 12.3: Wire the close handlers.**

In `media/main.js`, near the existing modal cancel-button handlers, add a generic listener (one-time install at startup):

```js
document.querySelectorAll('.modal-close').forEach((btn) => {
    btn.addEventListener('click', () => {
        const modalId = btn.getAttribute('data-modal-close');
        const modal = document.getElementById(modalId);
        if (modal) {
            // Find a sibling cancel button if any, click it (so any cleanup logic runs)
            const cancelBtn = modal.querySelector('[id$="CancelBtn"]');
            if (cancelBtn) {
                cancelBtn.click();
            } else {
                modal.style.display = 'none';
            }
        }
    });
});
```

(Place this after the DOM-ready block where other one-time listeners are wired. If unsure of the right location, place it in the same scope as the existing `modalCancelBtn` listener.)

- [ ] **Step 12.4: Compile, test, visual sanity.**

```
npm run compile
npm test
```
F5 → open each modal, click the close `×` in the top-right, verify the modal closes and any state cleanup behaves identically to clicking the existing Cancel button.

- [ ] **Step 12.5: Commit.**

```
git add src/LabelMePanel.ts media/main.js media/style.css
git commit -m "ui: add close (×) button to modals"
```

---

## Task 13 (L5c): Search field with leading icon and clear-when-non-empty

**Files:** Modify `src/LabelMePanel.ts`. Modify `media/style.css`. Modify `media/main.js`.

- [ ] **Step 13.1: Add `.search-field` CSS.**

Append to `media/style.css`:

```css
.search-field {
    position: relative;
    display: flex;
    align-items: center;
    flex: 1;
}
.search-field__icon {
    position: absolute;
    left: 8px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--color-text-secondary);
    pointer-events: none;
}
.search-field input[type="search"] {
    flex: 1;
    padding-left: 28px;
    padding-right: 28px;
    margin: 0;
}
.search-field__clear {
    position: absolute;
    right: 4px;
    top: 50%;
    transform: translateY(-50%);
    width: 20px; height: 20px;
    padding: 2px;
    color: var(--color-text-secondary);
    background: transparent;
    border: none;
    border-radius: var(--radius-xs);
    display: none;            /* only shown when input has value (toggled by JS) */
    align-items: center;
    justify-content: center;
    cursor: pointer;
}
.search-field__clear.visible { display: inline-flex; }
.search-field__clear:hover { background: var(--color-bg-hover); color: var(--color-text-primary); }
```

- [ ] **Step 13.2: Restructure the search input markup.**

In `src/LabelMePanel.ts`, locate the search container ([src/LabelMePanel.ts](src/LabelMePanel.ts) — the block currently containing `<div class="search-input-container">…<input id="searchInput"…><button id="searchCloseBtn"…>`).

Replace with:

```html
<div class="search-input-container">
    <div class="search-field">
        <svg class="icon icon-sm search-field__icon" aria-hidden="true"><use href="#icon-search"/></svg>
        <input type="search" id="searchInput" placeholder="Search images…" />
        <button class="search-field__clear" id="searchCloseBtn" aria-label="Clear search">
            <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-x"/></svg>
        </button>
    </div>
</div>
```

(Note: `type="text"` becomes `type="search"`.)

- [ ] **Step 13.3: Toggle the clear button visibility based on input value.**

In `media/main.js`, find where `searchInput` and `searchCloseBtn` are wired up. Add an input listener:

```js
searchInput.addEventListener('input', () => {
    searchCloseBtn.classList.toggle('visible', searchInput.value.length > 0);
});
```

The existing `searchCloseBtn` click handler (which clears the search and closes / clears the input) is preserved unchanged.

- [ ] **Step 13.4: Adjust the `.search-input-container` padding to match.**

Replace `.search-input-container` rule at [media/style.css:1180-1187](media/style.css#L1180-L1187) with:

```css
.search-input-container {
    display: flex;
    align-items: center;
    padding: var(--space-2) var(--space-3);
    border-bottom: 0.5px solid var(--color-border);
    flex-shrink: 0;
}
```

(Removes the flex `gap` that was spacing the old close button — no longer needed since the close button is inside the search-field.)

Also delete the now-orphaned `.search-close-btn` and `.search-close-btn:hover` rules ([media/style.css:1205-1220](media/style.css#L1205-L1220)) — replaced by `.search-field__clear`.

- [ ] **Step 13.5: Compile, test, visual sanity.**

```
npm run compile
npm test
```
F5 → click the search icon (search input visible), type a character (`×` clear appears inside the field), click `×` (clears input, hides clear button).

- [ ] **Step 13.6: Commit.**

```
git add src/LabelMePanel.ts media/style.css media/main.js
git commit -m "ui: macOS-style search field with leading icon + inline clear button"
```

---

## Task 14 (L5d): Sidebar section header wrapper

**Files:** Modify `src/LabelMePanel.ts`. Modify `media/style.css`.

- [ ] **Step 14.1: Add `.sidebar-section-header` CSS.**

Append to `media/style.css`:

```css
.sidebar-section-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin: 0 0 var(--space-2) 0;
    flex-shrink: 0;
}
.sidebar-section-header h3 { margin: 0; }   /* override the consolidated h3 margin */
.sidebar-section-header .section-count {
    margin-left: auto;
}
```

- [ ] **Step 14.2: Restructure each section header in HTML.**

In `src/LabelMePanel.ts`, replace each occurrence of:

```html
<h3>Labels <span id="labelsCount" class="section-count"></span></h3>
```

with:

```html
<div class="sidebar-section-header">
    <h3>Labels</h3>
    <span id="labelsCount" class="section-count"></span>
</div>
```

Same for `Instances` (`#instancesCount`) — `<h3>Instances <span …>` becomes the wrapper form.

(IDs preserved; existing JS that reads `document.getElementById('labelsCount').textContent = …` continues to work.)

- [ ] **Step 14.3: Compile, test, visual sanity.**

```
npm run compile
npm test
```
F5 → verify Labels and Instances sections have title left, count right (instead of count appearing inline after title).

- [ ] **Step 14.4: Commit.**

```
git add src/LabelMePanel.ts media/style.css
git commit -m "ui: dedicated header rows for Labels / Instances with right-aligned count"
```

---

## Task 15: Smoke test prep + ping user

**Files:** none modified. This task is the verification gate.

- [ ] **Step 15.1: Final compile & full test pass.**

```
npm run compile
npm test
```
Expected: clean compile, 65 pass (61 original + 4 from Task 11). 0 fail.

- [ ] **Step 15.2: Final emoji audit (defense in depth).**

```
grep -nP "[\x{1F300}-\x{1FAFF}]|[\x{2600}-\x{27BF}]" src/LabelMePanel.ts media/style.css media/main.js
```
Expected: only matches inside *string contents* that aren't UI labels (e.g., comments). Verify each remaining match is intentional.

- [ ] **Step 15.3: Build the VSIX.**

```
npm run package
```
Expected: a new `labeleditor-vscode-*.vsix` file generated in the worktree root.

- [ ] **Step 15.4: Ping the user.**

Output to the user (do not commit anything more): the worktree path, the spec/plan file paths, and a request to run the smoke test from spec § 7. Wait for their feedback.

Suggested message: "L1–L5 complete in worktree `<path>`. All 65 tests pass. VSIX built. Please run the smoke test from spec § 7 (steps 1-10) — F5 to launch the Extension Development Host. Let me know what needs adjustment."

- [ ] **Step 15.5: After user smoke test feedback** — apply any requested adjustments as additional commits, then proceed to PR creation per `superpowers:finishing-a-development-branch` (or whichever flow the user prefers).
