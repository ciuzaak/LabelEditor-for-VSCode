# Settings Panel Polish — Design

**Date**: 2026-05-08
**Branch**: `pr-1-fixed`
**Predecessor**: settings panel redesign on the same branch (commits `7fc4211`, `e8e3897`, `d39dbd0`)

## Goal

Three small visual fixes on top of the redesigned settings dropdown:

1. **Theme** and **View** sections lose their group headers — they're each one row, so a header just adds noise. They become two ungrouped rows at the top of the dropdown.
2. **Lock button width** is halved (`33.33%` → `16.67%` of its row). The current chunky pill is too dominant for what is essentially a binary toggle on a label row.
3. **CLAHE Off/On toggle button width** is pinned with `min-width: 40px` so the button doesn't shrink/grow as text flips between `Off` (3 chars) and `On` (2 chars) — that's what currently shifts the reset and lock icons left and right.

## Non-goals

- Not changing other visual properties (padding, font-size, border, color) of the lock button.
- Not renaming `.channel-btn` even though it now only styles the CLAHE toggle.
- Not touching `media/main.js`.
- Not touching the Annotation Style or Image Adjustment groups, or any control behavior.

## Design

### File touch list

| Path | Action | Responsibility |
|---|---|---|
| `src/LabelMePanel.ts` | Modify | Remove the `Theme` and `View` group-header `<div>`s |
| `media/style.css` | Modify | `.zoom-lock-btn` width 33.33% → 16.67%; `.channel-btn` add `min-width: 40px`; remove `.settings-group-header:first-child` rule |

### Resulting dropdown structure

```
[ Theme buttons ]                    ← ungrouped, top of menu
[ Zoom row ]                         ← ungrouped
── Annotation Style ──               ← first group header, normal 10px top margin
[ Border Width slider ]
[ Fill Opacity slider ]
── Image Adjustment ──
[ Channel radios + lock ]
[ Brightness slider + lock ]
[ Contrast slider + lock ]
[ CLAHE toggle + lock + (slider when on) ]
```

Visual separation between the ungrouped rows and the first group header comes from the header's own `margin-top: 10px` and `border-bottom`. No extra divider needed.

### CSS changes

**`.zoom-lock-btn`** (lines around 838-844 in `media/style.css`):

- Old: `width: 33.33%; flex: 0 0 33.33%;`
- New: `width: 16.67%; flex: 0 0 16.67%;`

Padding (`4px 8px`), font-size (`14px`), border, and background untouched. Halving width only.

**`.channel-btn`** (lines around 866-877 in `media/style.css`):

Add one declaration:

```css
.channel-btn {
    /* ... existing rules ... */
    min-width: 40px;
}
```

Why 40px: with `font-size: 0.9em` (~12px) and `padding: 4px 8px`, "Off" renders at ~38px. 40px gives a 2px safety margin and locks the button width at the wider of the two states; "On" pads with whitespace.

**`.settings-group-header:first-child`**:

Remove the rule. After change 1, the first child of `#settingsMenuDropdown` is `.theme-control`, not a `.settings-group-header`, so the rule never matches. Dead code — drop it.

### HTML changes

In `src/LabelMePanel.ts` (`#settingsMenuDropdown` template):

- Remove the line `<div class="settings-group-header">Theme</div>`
- Remove the line `<div class="settings-group-header">View</div>`

The `.theme-control` and the View `.zoom-control` remain in their current positions.

## Verification

- `npm run compile` — TypeScript build passes.
- `npm test` — 5 existing utils tests pass.
- Manual:
  1. Open settings dropdown — Theme buttons sit at the top with no header above them; Zoom row directly below; first visible group header is `Annotation Style`.
  2. Click any lock button (Zoom / Brightness / Contrast / Channel / CLAHE) — button is visibly narrower than before, roughly half its previous width.
  3. Click CLAHE toggle to flip between Off and On — the button itself stays the same width; reset (↻) and lock (🔓) icons next to it don't shift horizontally.

## Risks

- **`.channel-btn` semantic name drift**: the class name now describes a use case that no longer exists, but renaming touches more files for marginal benefit. Acceptable.
- **Lock button at 16.67% on a very narrow panel**: a 200px-wide settings panel × 16.67% = 33px, which still fits the emoji (~24px) plus reduced padding. No layout break expected, but worth eyeballing during manual verification.
- **`min-width: 40px` larger than the natural width of "On"**: intentional — the whole point is to keep the width stable across states.
