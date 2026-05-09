# macOS-Style UI Refresh — Design

**Date:** 2026-05-09
**Branch:** `worktree-macos-ui-refresh`

## Goals

Refresh the LabelEditor webview UI to a modern macOS Ventura/Sonoma visual style. Both light and dark themes covered. The "follow VS Code theme" toggle keeps working unchanged.

Three tracks:

1. **Visual polish** — replace ad-hoc colors / radii / spacing / shadows with a token system aligned to macOS system controls.
2. **Icon system** — replace emoji icons (👁️ ⬠ ▭ 🧠 💾 🔍 🔄 ⚙️ 🛠️ 📂 🤖 …) with monochrome inline SVGs (Lucide-style 1.5px stroke, `currentColor`).
3. **Targeted restructure** — where the current layout fights the macOS idiom, restructure: settings dropdown → popover, mode buttons → segmented control, etc.

**Non-goals**
- No change to canvas rendering, annotation logic, IPC protocol, Python helpers, or `*.ts` business logic — frontend webview only.
- No new dependencies (no Tailwind, no icon font, no React). All changes are within `media/style.css`, `media/main.js` (DOM construction only where needed), and the inline HTML in `src/LabelMePanel.ts`.
- No localization changes.
- "Follow VS Code theme" mode logic is preserved as-is (the existing class-toggling logic still applies the new tokens correctly because we only swap variable values, not selectors).

## Visual direction

**Reference:** macOS 14 (Sonoma) system controls — clean, subtle depth, generous whitespace, bold accent for primary action only, single-color stroke icons. Not the heavy Big Sur gradient look. Not the strong Liquid-Glass blur of Tahoe (some blur is used, but contained to popovers).

## § 1. Design tokens

Replace [media/style.css:1-53](media/style.css#L1-L53) wholesale. Existing variable names are kept where possible so that downstream rules (and the rest of the file we'll progressively rewrite) stay valid during the transition.

### 1.1 New token categories

```css
:root {
    /* ---------- color: dark (default, matches VS Code default) ---------- */
    --color-bg-primary:    #1e1e1e;
    --color-bg-secondary:  #252527;   /* sidebar, toolbar */
    --color-bg-tertiary:   #2d2d30;   /* nested panels */
    --color-bg-input:      #3a3a3c;   /* button face, input field */
    --color-bg-hover:      rgba(255,255,255,0.06);
    --color-bg-active:     rgba(255,255,255,0.10);
    --color-bg-hover-input: #48484a;
    --color-bg-popover:    rgba(44,44,46,0.85);  /* used with backdrop-filter */
    --color-border:        rgba(255,255,255,0.08);
    --color-border-secondary: rgba(255,255,255,0.12);
    --color-border-input:  rgba(255,255,255,0.14);
    --color-text-primary:  #f5f5f7;
    --color-text-secondary: #98989d;
    --color-text-muted:    #6e6e73;
    --color-text-disabled: #48484a;
    --color-accent:        #0a84ff;   /* macOS dark systemBlue */
    --color-accent-hover:  #409cff;
    --color-accent-active: #0064d4;
    --color-danger:        #ff453a;   /* macOS dark systemRed */
    --color-success:       #30d158;
    --color-warning:       #ff9f0a;
    --color-modal-overlay: rgba(0,0,0,0.45);
    --color-scrollbar-track: transparent;
    --color-scrollbar-thumb: rgba(255,255,255,0.18);
    --color-scrollbar-thumb-hover: rgba(255,255,255,0.30);

    /* ---------- radii ---------- */
    --radius-xs:   4px;   /* small chips, badges */
    --radius-sm:   6px;   /* buttons, segmented items, inputs */
    --radius-md:   8px;   /* segmented groups, dropdowns */
    --radius-lg:   10px;  /* popovers, modals */
    --radius-pill: 999px; /* label chips */

    /* ---------- spacing ---------- */
    --space-1: 4px;
    --space-2: 8px;
    --space-3: 12px;
    --space-4: 16px;
    --space-5: 20px;
    --space-6: 24px;

    /* ---------- typography ---------- */
    --font-system: -apple-system, BlinkMacSystemFont, "SF Pro Text",
                   "Segoe UI Variable Text", "Segoe UI", system-ui,
                   "PingFang SC", "Microsoft YaHei", sans-serif;
    --font-mono:   ui-monospace, SFMono-Regular, "SF Mono",
                   "JetBrains Mono", Menlo, Consolas, monospace;
    --font-12: 12px;   /* badges, captions, micro labels */
    --font-13: 13px;   /* default UI text (macOS native control size) */
    --font-14: 14px;   /* section headers */
    --font-17: 17px;   /* modal titles */
    --line-tight: 1.2;
    --line-normal: 1.45;

    /* ---------- elevation / shadow ---------- */
    --shadow-1: 0 0 0 0.5px var(--color-border);                 /* hairline only */
    --shadow-2: 0 1px 2px rgba(0,0,0,0.18),
                0 0 0 0.5px var(--color-border);                 /* button rest, raised chip */
    --shadow-3: 0 8px 24px rgba(0,0,0,0.32),
                0 0 0 0.5px var(--color-border-secondary);       /* popover, dropdown */
    --shadow-modal: 0 20px 60px rgba(0,0,0,0.45),
                    0 0 0 0.5px var(--color-border-secondary);
    --shadow-focus: 0 0 0 3px color-mix(in srgb,
                                        var(--color-accent) 35%,
                                        transparent);            /* keyboard focus ring */

    /* ---------- motion ---------- */
    --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
    --ease-emphasized: cubic-bezier(0.2, 0, 0, 1);
    --dur-fast: 120ms;
    --dur-base: 180ms;
    --dur-slow: 240ms;

    /* ---------- backdrop ---------- */
    --blur-popover: saturate(180%) blur(28px);
}

body.theme-light {
    --color-bg-primary:    #ffffff;
    --color-bg-secondary:  #f5f5f7;       /* macOS off-white */
    --color-bg-tertiary:   #ececef;
    --color-bg-input:      #ffffff;
    --color-bg-hover:      rgba(0,0,0,0.04);
    --color-bg-active:     rgba(0,0,0,0.08);
    --color-bg-hover-input: #f0f0f3;
    --color-bg-popover:    rgba(246,246,248,0.85);
    --color-border:        rgba(0,0,0,0.08);
    --color-border-secondary: rgba(0,0,0,0.12);
    --color-border-input:  rgba(0,0,0,0.14);
    --color-text-primary:  #1d1d1f;
    --color-text-secondary: #6e6e73;
    --color-text-muted:    #8e8e93;
    --color-text-disabled: #c7c7cc;
    --color-accent:        #007aff;
    --color-accent-hover:  #338cff;
    --color-accent-active: #0064d4;
    --color-danger:        #ff3b30;
    --color-success:       #34c759;
    --color-warning:       #ff9500;
    --color-modal-overlay: rgba(0,0,0,0.25);
    --color-scrollbar-thumb: rgba(0,0,0,0.22);
    --color-scrollbar-thumb-hover: rgba(0,0,0,0.36);
    --shadow-2: 0 1px 2px rgba(0,0,0,0.06),
                0 0 0 0.5px var(--color-border);
    --shadow-3: 0 8px 24px rgba(0,0,0,0.10),
                0 0 0 0.5px var(--color-border-secondary);
    --shadow-modal: 0 20px 60px rgba(0,0,0,0.20),
                    0 0 0 0.5px var(--color-border-secondary);
}
```

### 1.2 Body / typography baseline

```css
body {
    font-family: var(--font-system);
    font-size: var(--font-13);
    line-height: var(--line-normal);
    -webkit-font-smoothing: antialiased;
    /* existing layout rules unchanged */
}
```

### 1.3 Compatibility note

All existing variable names from [media/style.css:1-53](media/style.css#L1-L53) are retained (some get new values). The progressive rewrites in §§ 2–5 will replace hardcoded values throughout the file but **do not need a single big-bang rewrite of the entire stylesheet** — each section's rules are self-contained. During the transition, untouched rules continue to read the new tokens and look acceptable (they just won't have the full macOS polish until that section's rewrite lands).

## § 2. Icon system

### 2.1 Icon set

A single inline SVG sprite, defined once in the webview HTML at the top of the body:

```html
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs>
    <symbol id="icon-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </symbol>
    <!-- ... more symbols ... -->
  </defs>
</svg>
```

Used at sites with:

```html
<svg class="icon"><use href="#icon-eye"/></svg>
```

CSS:

```css
.icon { width: 16px; height: 16px; vertical-align: -3px; flex-shrink: 0; }
.icon-sm { width: 14px; height: 14px; }
.icon-lg { width: 18px; height: 18px; }
```

`stroke="currentColor"` means icons inherit text color — no theme switching logic needed.

### 2.2 Icon inventory & emoji → SVG mapping

Audit of every emoji usage in [src/LabelMePanel.ts](src/LabelMePanel.ts) toolbar HTML and modal markup. Each row identifies the *call site* and the chosen Lucide-style replacement.

| Site (line region) | Emoji | New icon (`#icon-…`) |
|---|---|---|
| `searchImagesBtn` | 🔍 | `search` |
| `refreshImagesBtn` | 🔄 | `refresh-cw` |
| `searchCloseBtn` | ✕ | `x` |
| `imageBrowserToggleBtn` | ☰ | `panel-left` |
| `prevImageBtn` / `nextImageBtn` | ◀ / ▶ | `chevron-left` / `chevron-right` |
| `imageInfoBtn` | (TBD — verify in HTML) | `info` |
| `viewModeBtn` | 👁️ | `eye` |
| `polygonModeBtn` | ⬠ | `pentagon` (custom — not in Lucide; draw 5-vertex path) |
| `rectangleModeBtn` | ▭ | `square` |
| `lineModeBtn` | ⟋ | `slash` (45° line) |
| `pointModeBtn` | • | `dot` (filled circle) |
| `samModeBtn` | 🧠 | `sparkles` (used by macOS for AI affordances) |
| `settingsMenuBtn` | ⚙️ | `settings` |
| `toolsMenuBtn` | 🛠️ | `wrench` |
| `saveBtn` | 💾 | `save` (or `arrow-down-to-line` — pick `save` for recognition) |
| `themeLightBtn` / `themeDarkBtn` / `themeAutoBtn` | ☀️ 🌙 🔄 | `sun` / `moon` / `circle-half` |
| `zoomLockBtn` / `channelLockBtn` / `brightnessLockBtn` / `contrastLockBtn` / `claheLockBtn` | 🔓 / 🔒 | `lock-open` / `lock` |
| `claheToggleBtn` | "Off"/"On" text | unchanged (text label, fits segmented style) |
| `…BrowseBtn` (×4 file pickers) | 📂 | `folder-open` |
| `onnxBatchInferMenuItem` | 🤖 | `cpu` |
| `exportSvgMenuItem` | 📐 | `download` |
| `onnxInferModal` / `samConfigModal` titles | 🤖 | `sparkles` |
| `onnxModal` info hint | ⓘ | `info` (sized `--icon-sm`) |
| `colorOption` ✓ marker | inline | keep (overlay check icon: `check`) |
| `recentLabels` shortcut badge | numeric | unchanged (text) |
| Slider reset (`*ResetBtn`) | ↺ (`&#8634;`) | `rotate-ccw` |

**Total new symbols:** ~22 unique SVGs. All can be drawn from memory in Lucide style; no licensing issue (Lucide is ISC, but we're authoring shapes ourselves so even direct copy would be safe).

### 2.3 Sprite location

The `<svg defs>` sprite is generated by a TS helper `getIconSprite()` in [src/LabelMePanel.ts](src/LabelMePanel.ts), inserted at the top of `<body>` in `_getHtmlForWebview()`. Each `<symbol>` is a small string template; total weight under 4 KB.

### 2.4 Accessibility

- `<button>` retains its `title="…"` attribute (already present everywhere) — title becomes the accessible name. No additional ARIA needed.
- Add `aria-hidden="true"` on each `<svg class="icon">` so screen readers skip the decorative graphic.

## § 3. Controls

Rewrites of the visual rules. HTML class names are mostly preserved; new helper classes added where existing ones don't map cleanly.

### 3.1 Buttons

Three variants:

| Variant | Use |
|---|---|
| `.btn` (default, secondary) | Most buttons (toolbar, modal cancel, sidebar actions) |
| `.btn-primary` (filled accent) | Modal OK, "Run" in batch infer, dirty-state Save |
| `.btn-icon` (icon-only chip) | Single-icon buttons in toolbar, lock toggles |

```css
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
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    transition: background-color var(--dur-fast) var(--ease-standard),
                box-shadow var(--dur-fast) var(--ease-standard);
}
.btn:hover     { background: var(--color-bg-hover-input); }
.btn:active    { background: var(--color-bg-active); transform: translateY(0.5px); }
.btn:disabled  { background: var(--color-bg-tertiary); color: var(--color-text-disabled);
                 box-shadow: none; cursor: default; }
.btn:focus-visible { outline: none; box-shadow: var(--shadow-2), var(--shadow-focus); }

.btn-primary { background: var(--color-accent); color: #fff; border-color: transparent; }
.btn-primary:hover  { background: var(--color-accent-hover); }
.btn-primary:active { background: var(--color-accent-active); }

.btn-icon { padding: 5px; min-width: 28px; min-height: 28px;
            justify-content: center; }
.btn-danger { background: var(--color-danger); color: #fff; border-color: transparent; }
```

The existing global `button { … }` rule (currently [media/style.css:323-346](media/style.css#L323-L346) catches every `<button>` indiscriminately) is **replaced by a scoped reset**:

```css
button { all: unset; }   /* nothing inherits anymore */
button.btn, button.btn-icon, button.btn-primary, /* … */ { /* explicit styles */ }
```

…with **explicit class assignment** added to every existing `<button>` in [src/LabelMePanel.ts](src/LabelMePanel.ts) HTML. (See § 6.1 for the migration order — buttons get classes in the same step as the new CSS lands.)

### 3.2 Segmented controls (`mode-toggle-group`, `theme-toggle-group`, `onnx-radio-group`, `sidebar-actions`)

The existing pattern is already segmented. Visual upgrade:

```css
.segmented-group {
    display: inline-flex;
    background: var(--color-bg-tertiary);
    border-radius: var(--radius-md);
    padding: 2px;
    gap: 2px;
    box-shadow: inset 0 0 0 0.5px var(--color-border);
}
.segmented-group > .segmented-item {
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
.segmented-group > .segmented-item:hover  { background: var(--color-bg-hover); }
.segmented-group > .segmented-item.active {
    background: var(--color-bg-input);
    box-shadow: var(--shadow-2);
}
```

Existing classes `.mode-toggle-group / .theme-toggle-group / .onnx-radio-group` get **aliased** (kept as additional class names so JS selectors keep working) and `.segmented-group` is added. Item-level classes (`.mode-btn / .theme-btn / .onnx-radio`) get aliased to `.segmented-item`.

This converges five near-duplicate definitions ([media/style.css:793-823](media/style.css#L793-L823), [media/style.css:991-1023](media/style.css#L991-L1023), [media/style.css:1377-1415](media/style.css#L1377-L1415), [media/style.css:1034-1093](media/style.css#L1034-L1093) etc.) into one set of rules.

### 3.3 Sliders

```css
input[type="range"] {
    appearance: none;
    background: transparent;
    height: 18px;
    margin: 0;
}
input[type="range"]::-webkit-slider-runnable-track,
input[type="range"]::-moz-range-track {
    height: 4px;
    border-radius: 2px;
    background: var(--color-bg-tertiary);
    box-shadow: inset 0 0 0 0.5px var(--color-border);
}
input[type="range"]::-webkit-slider-thumb {
    appearance: none;
    margin-top: -6px;       /* center on track */
    width: 16px; height: 16px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 2px rgba(0,0,0,0.25), 0 0 0 0.5px rgba(0,0,0,0.2);
    cursor: pointer;
    transition: transform var(--dur-fast) var(--ease-standard);
}
input[type="range"]::-moz-range-thumb {
    width: 16px; height: 16px;
    border-radius: 50%;
    background: #fff;
    border: none;
    box-shadow: 0 1px 2px rgba(0,0,0,0.25), 0 0 0 0.5px rgba(0,0,0,0.2);
    cursor: pointer;
}
input[type="range"]:hover::-webkit-slider-thumb,
input[type="range"]:hover::-moz-range-thumb { transform: scale(1.08); }
input[type="range"]:focus-visible {
    outline: none;
}
input[type="range"]:focus-visible::-webkit-slider-thumb,
input[type="range"]:focus-visible::-moz-range-thumb {
    box-shadow: 0 1px 2px rgba(0,0,0,0.25), var(--shadow-focus);
}
```

White thumb (matches macOS), subtle shadow, and a hover scale tick. The four duplicate `.slider-control input[type="range"]` / `.zoom-control input[type="range"]` blocks ([media/style.css:737-762](media/style.css#L737-L762), [media/style.css:837-863](media/style.css#L837-L863)) collapse into the single global rule above.

### 3.4 Inputs (text, textarea, number, search)

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
}
input:focus-visible, textarea:focus-visible {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: var(--shadow-focus);
}
```

### 3.5 Label chips (`.label-chip`)

```css
.label-chip {
    background: var(--color-bg-input);
    border: 0.5px solid var(--color-border-input);
    border-radius: var(--radius-pill);
    padding: 3px 10px;
    font-size: var(--font-12);
    transition: background var(--dur-fast), color var(--dur-fast);
}
.label-chip.selected {
    background: var(--color-accent);
    color: #fff;
    border-color: transparent;
    box-shadow: 0 0 0 0.5px var(--color-accent-active) inset;
}
.chip-shortcut-badge {
    /* … macOS-style monospaced kbd badge instead of solid blue square */
    background: rgba(0,0,0,0.5);
    color: #fff;
    font-family: var(--font-mono);
    border-radius: 3px;
    width: auto; min-width: 14px; padding: 0 3px;
}
```

### 3.6 Lock buttons (`.zoom-lock-btn`, `.channelLockBtn`, …)

Repurposed as `.btn-icon` with an `.is-locked` modifier. Lock state shows a filled accent background (matches "engaged" affordance in macOS):

```css
.btn-icon.is-locked {
    background: var(--color-accent);
    color: #fff;
    border-color: transparent;
}
```

## § 4. Containers

### 4.1 Toolbar ([media/style.css:312-321](media/style.css#L312-L321))

```css
.toolbar {
    height: 38px;
    background: var(--color-bg-secondary);
    border-bottom: 0.5px solid var(--color-border);
    padding: 0 var(--space-3);
    display: flex;
    align-items: center;
    gap: var(--space-2);   /* replaces button { margin-right:10px } */
    flex-shrink: 0;
}
```

Buttons inside the toolbar get `gap` from the parent rather than per-button margin.

### 4.2 Sidebar

- Sidebar bg: `--color-bg-secondary`.
- Section headers (`h3`) — keep uppercase + `var(--font-12)`, color `--color-text-secondary`, but remove the visual heaviness via thinner letter-spacing and a 0.5px separator line below the header.
- The `.sidebar-section-resizer` becomes 1px hairline at rest, expanding to 4px on hover with a delay (no jump).
- `#shapeList li` and `#labelsList li`: 6px vertical padding, `--radius-sm`, hover `--color-bg-hover`, active `--color-bg-active`.
- `#shapeList li.active` keeps the existing 3px left accent bar but uses `--color-accent` and `var(--radius-sm) 0 0 var(--radius-sm)` rounding.

### 4.3 Modals

Replace the rule block at [media/style.css:411-467](media/style.css#L411-L467):

```css
.modal {
    background: var(--color-modal-overlay);
    backdrop-filter: blur(4px);  /* subtle scrim blur — present in macOS sheets */
}
.modal-content {
    background: var(--color-bg-popover);
    backdrop-filter: var(--blur-popover);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-modal);
    border: none;
    padding: var(--space-5);
    min-width: 320px;
    max-width: min(560px, 92vw);
    /* fade-in */
    animation: modal-in var(--dur-base) var(--ease-emphasized);
}
.modal-content h3 {
    font-size: var(--font-17);
    font-weight: 600;
    margin: 0 0 var(--space-3) 0;
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

Cancel button → `.btn`. OK / Run / Start Service → `.btn-primary`.

### 4.4 Settings dropdown → popover (restructure)

Currently the settings dropdown is rendered inline below the gear button as a `.sidebar-dropdown` block ([src/LabelMePanel.ts:792-855](src/LabelMePanel.ts#L792-L855)) which pushes the labels list down when opened. macOS pattern: a *floating popover* anchored to the trigger, with arrow.

**Mechanics:**

- DOM stays where it is (no reparent) — only positioning changes via CSS:
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
      /* arrow indicator pointing up-right toward the gear */
      content: ""; position: absolute; top: -5px; right: 12px;
      width: 10px; height: 10px;
      background: inherit;
      backdrop-filter: inherit;
      border-left: 0.5px solid var(--color-border-secondary);
      border-top:  0.5px solid var(--color-border-secondary);
      transform: rotate(45deg);
  }
  ```
- Container `.sidebar-toolbar` gets `position: relative`.
- Existing toggle JS (in [media/main.js](media/main.js)) is unchanged — it still toggles `display:block/none`. The animation runs on each open via the `animation` property.
- Click-outside-to-close: existing handler (likely already present — verify; if not, add a `mousedown` listener on `document` that hides the dropdown when target is outside).

**Same treatment** for `#toolsMenuDropdown` and `#imageInfoPopup` (which is already popover-positioned, just gets the new visual tokens).

### 4.5 Context menu (`.shape-context-menu`)

Convert from "panel with rows" to macOS contextual menu styling:

```css
.shape-context-menu {
    background: var(--color-bg-popover);
    backdrop-filter: var(--blur-popover);
    border: 0.5px solid var(--color-border-secondary);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-3);
    padding: var(--space-1);
    min-width: 160px;
    animation: popover-in var(--dur-fast) var(--ease-standard);
}
.context-menu-item {
    padding: 5px 10px;
    border-radius: var(--radius-xs);
    font-size: var(--font-13);
}
.context-menu-item:hover {
    background: var(--color-accent);
    color: #fff;
}
.context-menu-item.context-menu-danger { color: var(--color-danger); }
.context-menu-item.context-menu-danger:hover {
    background: var(--color-danger); color: #fff;
}
```

(Hover = solid accent fill, matching macOS native menus.)

### 4.6 Image browser items

Active item: keep the 3px left accent border but transition the background to `--color-accent` with 12 % alpha (`color-mix(in srgb, var(--color-accent) 12%, transparent)`). Hover stays at `--color-bg-hover`.

### 4.7 Color palette (modal)

Each `.color-option` becomes a perfect circle (`border-radius: 50%`) with a 1px outer stroke matching the swatch color (helps very-light swatches stand out on the off-white background):

```css
.color-option {
    border-radius: 50%;
    box-shadow: 0 0 0 0.5px rgba(0,0,0,0.12) inset;
    transition: transform var(--dur-fast), box-shadow var(--dur-fast);
}
.color-option.selected {
    box-shadow: 0 0 0 0.5px rgba(0,0,0,0.12) inset,
                0 0 0 3px var(--color-bg-secondary),
                0 0 0 5px var(--color-accent);  /* halo ring */
    transform: scale(1.08);
}
```

## § 5. Restructure (allowed by user)

These are the structural reshuffles enabled by the brainstorming choice "C – allow larger restructuring". Each is bounded.

### 5.1 Settings dropdown → popover

Already covered in § 4.4. **Risk:** none beyond CSS positioning; existing toggle JS reused.

### 5.2 Mode buttons → labeled segmented control

Currently `.mode-toggle-group` is a row of 6 single-icon buttons. Stays as 6 buttons, but each item now shows **icon + tooltip only** (no text), with the segmented styling from § 3.2. The change is mostly cosmetic (no DOM restructure) — listed here because it's the visual identity of the most-used control surface.

### 5.3 Sidebar header for Labels & Instances

Currently `<h3>Labels <span class="section-count">…</span></h3>`. New: header row with title on the left, count on the right, optional collapse caret on the far right. Adds a small `.sidebar-section-header` wrapper:

```html
<div class="sidebar-section-header">
  <h3>Labels</h3>
  <span class="section-count" id="labelsCount"></span>
</div>
```

Existing `#labelsCount` id preserved (JS that updates the count keeps working). No collapse functionality added (out of scope) — just visual structure.

### 5.4 Modal close affordance

Add a small `×` close button (icon `x`) in the top-right of every `.modal-content`, in addition to the existing Cancel button. Clicking it triggers the same handler as Cancel:

```html
<button class="modal-close btn-icon" aria-label="Close">
  <svg class="icon"><use href="#icon-x"/></svg>
</button>
```

CSS positions it absolute top-right with no border, hover background `--color-bg-hover`. JS: each modal's existing cancel-button handler is duplicated/aliased onto its close button.

### 5.5 Search input chrome

The image browser search input gets a leading inline icon (`search` symbol) inside the input container, and the existing close `×` becomes a clear-when-non-empty button positioned inside the input:

```html
<div class="search-field">
  <svg class="icon icon-sm search-field__icon"><use href="#icon-search"/></svg>
  <input type="search" id="searchInput" placeholder="Search images…"/>
  <button class="search-field__clear btn-icon" id="searchCloseBtn">
    <svg class="icon icon-sm"><use href="#icon-x"/></svg>
  </button>
</div>
```

This is the macOS native search-field idiom. Behavior unchanged.

## § 6. Implementation order (execution layers)

Bound to the "B – layered, single PR" choice. Each layer is a checkpoint; nothing is skipped.

| Layer | Scope | Files touched |
|---|---|---|
| **L1: tokens** | Replace `:root` and `.theme-light` blocks with the new token set. Update `body` typography. Verify visual sanity. | `media/style.css` |
| **L2: icon sprite + replacement** | Add `getIconSprite()` helper + inject into HTML. Replace every emoji site identified in § 2.2. Add `.icon` rule. | `src/LabelMePanel.ts`, `media/style.css` |
| **L3: controls** | Buttons (`.btn`, `.btn-primary`, `.btn-icon`, `.btn-danger`). Segmented (`.segmented-group/.segmented-item` + class aliases). Sliders. Inputs/textarea. Label chips. Lock buttons. Reset/aliasing of global `button{}`. | `media/style.css`, button class additions in `src/LabelMePanel.ts` HTML; for buttons created dynamically in `media/main.js`, ensure new classes are added at creation. |
| **L4: containers** | Toolbar, sidebar (incl. headers, section resizer), modals (incl. animation), context menu, image-browser items, color palette. | `media/style.css` |
| **L5: restructure** | Settings/tools dropdown → popover with arrow. Modal close button. Search field chrome. Sidebar section header wrapper. | `src/LabelMePanel.ts` HTML, small `media/main.js` additions for modal-close handlers and click-outside-popover dismissal, `media/style.css`. |

After L5: smoke test (full launch in Extension Development Host, exercise every feature). **This is the user's checkpoint.**

## § 7. Testing strategy

The repo's automated tests are in [test/](test/) and cover annotation logic (DSU merge helpers, SAM prompt routing, shift-feedback decisions). They are **not** UI tests — none of this work should affect them.

**Verification gate:** `npm test` continues to pass after every layer (`L1…L5`). Run after each layer; if any test fails, the layer's changes are wrong (it has touched something outside the frontend boundary by mistake).

**Smoke test (manual, end-of-L5):**

1. Launch Extension Development Host (`F5` in VS Code).
2. Open an image folder, then an image.
3. Toggle dark / light / auto theme via the gear popover. Verify all three render cleanly and switch without flicker.
4. Exercise every mode button (View / Polygon / Rect / Line / Point / SAM). Confirm icon clarity at 100 % zoom and 150 % zoom.
5. Open every modal (Label, Color, ONNX, SAM Config). Verify centered, blurred backdrop, animation in, close button works, OK/Cancel both styled correctly.
6. Open every popover (Settings, Tools, Image Info). Verify arrow points at trigger, click-outside dismisses.
7. Use sliders (border, fill, brightness, contrast, CLAHE clip). Verify thumb hover-scale, focus ring on tab.
8. Right-click a shape → context menu. Verify hover = solid accent.
9. Color picker: pick + verify halo ring on selection.
10. Save with dirty state — verify `.btn-primary` accent fill.

## § 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| `button { all: unset }` removes too much (e.g., from `<button>` we don't reach with explicit class). | Audit every `<button>` in [src/LabelMePanel.ts](src/LabelMePanel.ts) and [media/main.js](media/main.js) (the latter has dynamic button creation). Each must get an explicit class. The L3 task includes this audit. |
| `backdrop-filter` may not paint correctly inside webview on older VS Code/Electron. | Each rule that uses `backdrop-filter` also sets a solid-fallback background (`rgba(...)` instead of pure transparency). Result: gracefully degrades to a flat panel. |
| Icon sprite IDs collide with existing IDs in the document. | Prefix every symbol id with `icon-` (already in spec). Audit existing ids before merging. |
| Dynamic buttons in `main.js` (e.g., context menu items, label list items) miss new class names. | L3 task list includes "search `media/main.js` for `createElement('button')` and `innerHTML += '<button'`; add explicit class names at every site." |
| Color contrast regression (especially in light theme, `#1d1d1f` on `#f5f5f7`). | Spot-check via DevTools accessibility panel during smoke test. macOS palette is WCAG-compliant by design. |
| `-webkit-appearance: none` on range inputs already handled cross-browser, but `transform` on thumb may visually clip in some Chromium versions. | Container row gets `min-height: 18px` via the slider rule above. |

## § 9. Open verifications (to confirm before / during L1–L5)

- [ ] Verify there is no existing `imageInfoBtn` emoji symbol (table in § 2.2 marks it TBD — check actual HTML).
- [ ] Verify `media/main.js` doesn't construct any `<button>` without a class that would lose all styling under the `button { all: unset }` reset.
- [ ] Confirm whether VS Code webview honors `backdrop-filter` in current versions; if not, document the fallback (the tokens already include solid fallbacks).
- [ ] Confirm `position: relative` on `.sidebar-toolbar` doesn't break existing dropdown coordinates (which currently rely on the static stacking context).
