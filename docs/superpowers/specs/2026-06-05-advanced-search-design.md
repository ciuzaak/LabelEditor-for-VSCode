# Design: Advanced search — multi-criteria image filtering with weighted ranking

Date: 2026-06-05

> **Revision 2026-06-05b (post-smoke feedback).** Three changes supersede parts of the
> original design below:
> 1. **Incremental condition builder.** Instead of a fixed 3-field form with a global
>    ALL/ANY toggle, the user **adds conditions one at a time**. There can be several
>    name / class / description conditions at once. Combination rule: **conditions are AND'd**
>    together; **within a single class condition, multiple selected classes are OR'd**. The
>    global ALL/ANY toggle is removed. Query model becomes
>    `{ conditions: Array<{type:'name'|'description', value} | {type:'class', values[]}> }`.
> 2. **Lazy indexing.** Name-only searches read **no** sidecar JSON (name matching uses the
>    relative path the host already has). The sidecar scan happens only when a class or
>    description condition is present; the class universe is fetched only when a class
>    condition is added. Cache + save-time incremental update + refresh invalidation unchanged.
> 3. **Filtered navigation.** prev/next buttons and the a/d keys navigate **within the current
>    effective (filtered) list, in its order**, wrapping around — for both quick search and
>    advanced search. Navigation is computed in the webview from `getEffectiveImageList()` and
>    dispatched as `navigateToImage`, preserving the existing dirty-save flow.
>
> Sections below describe the original (superseded) ALL/ANY-toggle design; read them with the
> revision in mind.

The file-navigation sidebar currently offers only a substring filter over image paths
([media/main.js:6984](../../../media/main.js#L6984)). This adds an **advanced search** that
can additionally filter by **annotation class name** (multi-select) and **shape description**
(substring), combine the three criteria with a global **ALL (AND) / ANY (OR)** switch, and
present results in the sidebar **ranked by a composite match score**.

The scoring/ranking logic is extracted into a pure, unit-tested module `src/searchEngine.ts`.
`src/LabelMePanel.ts` owns the filesystem index and message wiring; `media/main.js` (plus a new
`media/advancedSearchHelpers.js`) only renders the modal, collects the query, and shows results.

---

## Background — current behavior & constraints

- The webview holds the **current** image's annotation data plus a flat `workspaceImages`
  array of relative paths ([src/LabelMePanel.ts:1300](../../../src/LabelMePanel.ts#L1300)). It
  does **not** have annotation data for other images.
- Annotations are sidecar JSON files (`<image>.json`, LabelMe v5 format). Each shape is
  `{label, points, shape_type, description?}` ([src/labelMeUtils.ts:4](../../../src/labelMeUtils.ts#L4)).
  "Class name" = shape `label`; "description" is **per-shape**.
- The existing quick search is a webview-side substring filter on `workspaceImages`
  ([`filterImages`](../../../media/main.js#L6984)); results render through `filteredImages` +
  virtual scrolling ([`renderImageBrowserList`](../../../media/main.js#L7035),
  [`updateVirtualScroll`](../../../media/main.js#L7084)).
- The extension already batch-reads every sidecar JSON and enumerates the class universe in
  [`_collectExportImages`](../../../src/LabelMePanel.ts#L1423) /
  [`_prepareExportDataset`](../../../src/LabelMePanel.ts#L1488) — the index here follows the
  same read pattern.
- Reusable infra: the `.modal` pattern (e.g. `exportDatasetModal`,
  [src/LabelMePanel.ts:1207](../../../src/LabelMePanel.ts#L1207)), the icon sprite
  ([`_getIconSprite`](../../../src/LabelMePanel.ts#L764)), the i18n dictionary
  (`media/i18n.js`, en + zh-CN), the notification bus, and the rich tooltip.

**Hard constraint:** class/description search needs to read *all* sidecar JSONs, which only the
extension host can do. Scoring therefore runs on the extension host; the webview receives an
already-ranked list of relative paths and feeds it into the existing `filteredImages` rendering
path.

---

## Data flow

```
[sliders button in search field] → open modal → advancedSearchPrepare
                                          ↓ extension builds / reuses annotation index
  modal populates class multi-select ← advancedSearchPrepareResult {classes:[{name,count}], imageCount}
[fill criteria → Search] → advancedSearchRun {combinator, name, classes[], description}
                                          ↓ extension scores via searchEngine (pure)
  sidebar renders ranked results ← advancedSearchRunResult {results:[{relPath, score, …}], total}
```

---

## Module breakdown (isolated, independently testable)

| Unit | Location | Responsibility |
|---|---|---|
| **searchEngine.ts** (new, pure) | `src/` | Index/query types; `scoreImage(record, query)`; `runAdvancedSearch(index, query)` → ranked results. No I/O. Unit-tested. |
| **Index layer** (edit) | `src/LabelMePanel.ts` | Build/cache/invalidate the annotation index from fs; handle `advancedSearchPrepare` / `advancedSearchRun`. |
| **Modal DOM + icon** (edit) | `src/LabelMePanel.ts` `_getHtmlForWebview` / `_getIconSprite` | `advancedSearchModal` markup (reuses `.modal`); new `icon-sliders`; sliders button inside `.search-field`. |
| **advancedSearchHelpers.js** (new, pure) + main.js wiring | `media/` | `collectQuery(dom)`, `renderClassList`, banner text formatting; main.js wires open/search/reset/clear, applies ranked results, manages the banner. |
| CSS + i18n (edit) | `media/style.css`, `media/i18n.js` | Class multi-select list + result banner styles; en + zh-CN strings. |

---

## Extension side — annotation index

```ts
// searchEngine.ts
export interface AnnotationRecord {
    relPath: string;
    labels: Map<string, number>;   // class name -> instance count on this image
    descriptions: string[];        // every non-empty shape description
}
export type AnnotationIndex = AnnotationRecord[];
```

`LabelMePanel` owns the cache:

```ts
private _annotationIndex: AnnotationRecord[] | null = null;
private _annotationIndexGeneration = -1;   // matches _scanGeneration when valid
```

- **Lazy build** (`_buildAnnotationIndex()`): iterate `_workspaceImages`; for each, derive the
  sidecar path (`replace(/\.[^/.]+$/, '') + '.json'`), `existsSync → readFile → JSON.parse`
  (mirroring `_collectExportImages`). Collect `labels` (count per `label`) and non-empty
  `descriptions`. Images with no/invalid JSON yield an empty record (still matchable by image
  name). Read concurrently in bounded batches (e.g. 32 at a time) to keep large folders fast.
- **Cache / invalidation**: store on `_annotationIndex`, stamped with `_scanGeneration`.
  Rebuild when stale (`_annotationIndexGeneration !== _scanGeneration`) or null. Invalidate by
  setting `_annotationIndex = null` in `_refreshWorkspaceImages` and on folder change. After a
  successful `saveAnnotation`, **update just that image's record in place** (re-derive labels +
  descriptions from the saved shapes) so the index stays fresh without a full rescan.
- **Indexing feedback**: the index is built on `advancedSearchPrepare` (modal open). For large
  sets this can take a moment, so the trigger button shows a transient "indexing…" / disabled
  state until `advancedSearchPrepareResult` arrives; the actual `advancedSearchRun` is then an
  in-memory pass and returns immediately. Build is best-effort — one bad file is skipped, not
  fatal.
- **Scope**: the full scanned tree (`_workspaceImages`), identical to what the sidebar lists.
- **Trade-off**: the index reflects the **saved-to-disk** state. Unsaved edits to the current
  image are not searched until saved (consistent with "search the dataset"). A future
  `currentOverride` could fix this; out of scope (YAGNI).

---

## Scoring — composite weighted (pure)

```ts
export interface SearchQuery {
    combinator: 'all' | 'any';
    name: string;            // image-name substring, '' = inactive
    classes: string[];       // selected class names, [] = inactive
    description: string;     // description substring, '' = inactive
}
export interface SearchResult {
    relPath: string;
    score: number;
    nameMatchKind: 'exact' | 'prefix' | 'substr' | 'none';
    matchedClasses: string[];     // selected classes present on the image
    classInstanceCount: number;   // total instances of matched classes
    descMatchCount: number;       // shapes whose description contains the query
}
```

Only **active** (non-empty) criteria participate.

- **ALL (AND)**: an image qualifies only if it satisfies *every* active criterion; score = sum
  of all criteria contributions.
- **ANY (OR)**: an image qualifies if it satisfies *at least one* active criterion; score = sum
  of contributions from the satisfied criteria.

Per-criterion contributions (weights are a tunable constant table; initial values):

- **Image name** (case-insensitive, on the relative path's basename, falling back to the full
  relPath): exact basename `1000`; prefix `500`; substring `200`; else `0`.
- **Class names** (multi-select, internally **OR** — image matches if it contains *any* selected
  class): `+100` per distinct selected class present, `+10` per matching instance.
- **Description** (substring, case-insensitive): `+50` per shape whose description contains the
  query, `+20` extra if a description equals or starts with the query.

**Ranking**: score descending; ties broken by the existing natural path order
(`comparePathsNaturally`, reused from `labelMeUtils.ts`). The result carries `nameMatchKind /
matchedClasses / classInstanceCount / descMatchCount` so the UI can show match badges.

`runAdvancedSearch(index, query)` maps each record → score, drops non-qualifying images, and
returns the sorted `SearchResult[]`. Empty query (no active criteria) returns `[]` and the UI
treats it as "clear".

---

## Webview UI

- **Trigger button**: a sliders/filter icon button added **inside** `.search-field` (next to the
  clear ×), id `advancedSearchBtn` → opens `advancedSearchModal`. (Satisfies "add a button in the
  search box".) Requires a new `icon-sliders` symbol in the sprite.
- **Modal** (reuses `.modal` / `.modal-content`):
  - Segmented combinator toggle: `Match ALL (AND)` / `Match ANY (OR)`.
  - Image name: text input.
  - Class names: scrollable multi-select checklist with per-class instance counts, a small
    type-to-filter box over the class names, and select-all / clear actions.
  - Description: text input (substring).
  - Buttons: `Search` / `Reset` / `Cancel`.
- **Results (takes over list + banner)**: on Search the modal closes; the sidebar shows the
  ranked results via `filteredImages`. A clearable banner appears above the list:
  **"Advanced filter active (N) ✕"**. The quick text field is hidden while the advanced filter is
  active; the × on the banner clears the filter and restores the quick field. Each result row
  gets a lightweight match badge (matched-class chip / `×N`) — minor / nice-to-have.
- **Interaction with quick search**: applying an advanced filter clears any active quick-search
  query and sets an `advancedFilterActive` flag; quick-search input is suppressed until the
  banner is cleared. Clearing the banner returns to the normal (unfiltered or quick-search)
  state.

---

## Message protocol

| Direction | command | payload |
|---|---|---|
| web→ext | `advancedSearchPrepare` | — |
| ext→web | `advancedSearchPrepareResult` | `{ classes: [{name, count}], imageCount }` |
| web→ext | `advancedSearchRun` | `{ combinator, name, classes: string[], description }` |
| ext→web | `advancedSearchRunResult` | `{ results: [{relPath, score, nameMatchKind, matchedClasses, classInstanceCount, descMatchCount}], total }` |

The webview applies `results.map(r => r.relPath)` as the ordered `filteredImages`, sets the
banner to `total`, and re-renders the virtual list.

---

## Testing

`src/searchEngine.ts` is pure → covered by `node --test` (reusing the existing `out-test`
harness, `tsconfig.test.json`). Cases:

- Each criterion's scoring in isolation (name exact/prefix/substring; class distinct + instance
  counts; description hit + prefix bonus).
- `combinator: 'all'` requires every active criterion; `combinator: 'any'` requires one.
- Multi-select class is OR (image with any selected class qualifies).
- Ranking order is score-descending; equal scores fall back to natural path order.
- Empty query (no active criteria) → `[]`.

The fs index layer and webview wiring are verified by a manual smoke test (open a folder, run
each criterion and the ALL/ANY toggle, confirm ranking and the clearable banner).

---

## Explicitly out of scope (YAGNI)

- Nested boolean groups, e.g. `(A AND B) OR C`.
- Regex / fuzzy matching.
- Indexing the current image's *unsaved* edits.
- Persisted search history.
