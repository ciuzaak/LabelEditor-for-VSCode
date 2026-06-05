# Advanced Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an advanced search to the file-navigation sidebar that filters images by name, annotation class (multi-select), and shape description, combined with a global ALL/ANY switch, and shows results ranked by a composite match score.

**Architecture:** Pure scoring/ranking lives in a new `src/searchEngine.ts` (unit-tested). `src/LabelMePanel.ts` builds/caches an annotation index from the sidecar JSONs and answers two new webview messages. The webview gets a new modal + a sliders button in the search field; `media/advancedSearchHelpers.js` holds the DOM-free query/format helpers (unit-tested), and `media/main.js` wires the modal, applies ranked results to the existing `filteredImages` rendering path, and shows a clearable banner.

**Tech Stack:** TypeScript (extension host), vanilla JS webview, `node --test` via `tsconfig.test.json` → `out-test/`.

Spec: [docs/superpowers/specs/2026-06-05-advanced-search-design.md](../specs/2026-06-05-advanced-search-design.md)

---

## File structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `src/searchEngine.ts` | Create | Pure types + `scoreImage` + `runAdvancedSearch` (ranking). |
| `test/searchEngine.test.ts` | Create | Unit tests for scoring/ranking. |
| `src/labelMeUtils.ts` | Modify | `export` the existing `comparePathsNaturally`. |
| `src/LabelMePanel.ts` | Modify | Annotation index (build/cache/invalidate); `advancedSearchPrepare` / `advancedSearchRun` handlers; modal HTML; sliders button; banner; `icon-sliders`. |
| `media/advancedSearchHelpers.js` | Create | DOM-free helpers: `normalizeQuery`, `hasActiveCriteria`, `filterClassNames`, `formatBanner`. |
| `test/advancedSearchHelpers.test.ts` | Create | Unit tests for the webview helpers. |
| `media/main.js` | Modify | Modal open/close, class-list render, run search, apply results, banner, suppress quick-search while active. |
| `media/style.css` | Modify | Class multi-select list, banner, sliders button styles. |
| `media/i18n.js` | Modify | en + zh-CN strings. |
| `media/tipsData.js` | Modify | `browser.advancedSearch` tooltip. |

---

## Task 1: Export `comparePathsNaturally` from labelMeUtils

**Files:**
- Modify: `src/labelMeUtils.ts` (the `function comparePathsNaturally` declaration, ~line 208)

- [ ] **Step 1: Add the `export` keyword**

In `src/labelMeUtils.ts`, change:

```ts
function comparePathsNaturally(a: string, b: string): number {
```

to:

```ts
export function comparePathsNaturally(a: string, b: string): number {
```

(Its existing internal callers in this file keep working unchanged.)

- [ ] **Step 2: Verify it still compiles**

Run: `npm run compile`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/labelMeUtils.ts
git commit -m "refactor: export comparePathsNaturally for reuse"
```

---

## Task 2: Pure search engine (`src/searchEngine.ts`) — TDD

**Files:**
- Create: `src/searchEngine.ts`
- Test: `test/searchEngine.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/searchEngine.test.ts`:

```ts
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { AnnotationRecord, SearchQuery, runAdvancedSearch } from '../src/searchEngine';

function rec(relPath: string, labels: Record<string, number> = {}, descriptions: string[] = []): AnnotationRecord {
    return { relPath, labels: new Map(Object.entries(labels)), descriptions };
}

function q(partial: Partial<SearchQuery>): SearchQuery {
    return { combinator: 'all', name: '', classes: [], description: '', ...partial };
}

describe('runAdvancedSearch — name criterion', () => {
    const index: AnnotationRecord[] = [
        rec('a/cat.jpg'),
        rec('b/cat_2.jpg'),
        rec('c/dog.jpg'),
    ];

    it('returns [] when no criteria are active', () => {
        assert.deepEqual(runAdvancedSearch(index, q({})), []);
    });

    it('ranks exact basename above prefix above plain substring', () => {
        const res = runAdvancedSearch(index, q({ name: 'cat' }));
        assert.deepEqual(res.map(r => r.relPath), ['a/cat.jpg', 'b/cat_2.jpg']);
        assert.equal(res[0].nameMatchKind, 'exact');   // basename "cat" === query
        assert.equal(res[1].nameMatchKind, 'prefix');  // "cat_2" startsWith "cat"
        assert.ok(res[0].score > res[1].score);
    });

    it('matches case-insensitively', () => {
        const res = runAdvancedSearch(index, q({ name: 'CAT' }));
        assert.equal(res.length, 2);
    });
});

describe('runAdvancedSearch — class criterion (multi-select OR)', () => {
    const index: AnnotationRecord[] = [
        rec('img1.jpg', { car: 2, tree: 1 }),
        rec('img2.jpg', { tree: 5 }),
        rec('img3.jpg', { person: 1 }),
    ];

    it('matches images containing ANY selected class', () => {
        const res = runAdvancedSearch(index, q({ classes: ['car', 'person'] }));
        assert.deepEqual(res.map(r => r.relPath).sort(), ['img1.jpg', 'img3.jpg']);
    });

    it('scores more distinct matched classes and more instances higher', () => {
        const res = runAdvancedSearch(index, q({ classes: ['car', 'tree'] }));
        // img1 has both car(2)+tree(1) => 2*100 + 3*10 = 230
        // img2 has tree(5)           => 1*100 + 5*10 = 150
        assert.deepEqual(res.map(r => r.relPath), ['img1.jpg', 'img2.jpg']);
        assert.equal(res[0].matchedClasses.sort().join(','), 'car,tree');
        assert.equal(res[0].classInstanceCount, 3);
    });
});

describe('runAdvancedSearch — description criterion (substring)', () => {
    const index: AnnotationRecord[] = [
        rec('d1.jpg', {}, ['blurry edge', 'occluded']),
        rec('d2.jpg', {}, ['sharp']),
    ];

    it('matches shapes whose description contains the query', () => {
        const res = runAdvancedSearch(index, q({ description: 'occl' }));
        assert.deepEqual(res.map(r => r.relPath), ['d1.jpg']);
        assert.equal(res[0].descMatchCount, 1);
    });
});

describe('runAdvancedSearch — combinator', () => {
    const index: AnnotationRecord[] = [
        rec('only_name_cat.jpg', { dog: 1 }),
        rec('has_car.jpg', { car: 1 }),
        rec('cat_and_car.jpg', { car: 1 }),
    ];

    it('ALL requires every active criterion', () => {
        const res = runAdvancedSearch(index, q({ combinator: 'all', name: 'cat', classes: ['car'] }));
        assert.deepEqual(res.map(r => r.relPath), ['cat_and_car.jpg']);
    });

    it('ANY requires at least one active criterion', () => {
        const res = runAdvancedSearch(index, q({ combinator: 'any', name: 'cat', classes: ['car'] }));
        assert.deepEqual(res.map(r => r.relPath).sort(), ['cat_and_car.jpg', 'has_car.jpg', 'only_name_cat.jpg']);
    });
});

describe('runAdvancedSearch — tie-break', () => {
    it('equal scores fall back to natural path order', () => {
        const index: AnnotationRecord[] = [
            rec('z/img10.jpg', { car: 1 }),
            rec('z/img2.jpg', { car: 1 }),
        ];
        const res = runAdvancedSearch(index, q({ classes: ['car'] }));
        assert.deepEqual(res.map(r => r.relPath), ['z/img2.jpg', 'z/img10.jpg']); // numeric-aware
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/searchEngine'`.

- [ ] **Step 3: Implement `src/searchEngine.ts`**

Create `src/searchEngine.ts`:

```ts
import { comparePathsNaturally } from './labelMeUtils';

export interface AnnotationRecord {
    relPath: string;
    labels: Map<string, number>;   // class name -> instance count
    descriptions: string[];        // non-empty shape descriptions
}

export type AnnotationIndex = AnnotationRecord[];

export interface SearchQuery {
    combinator: 'all' | 'any';
    name: string;          // image-name substring, '' = inactive
    classes: string[];     // selected class names, [] = inactive
    description: string;   // description substring, '' = inactive
}

export interface SearchResult {
    relPath: string;
    score: number;
    nameMatchKind: 'exact' | 'prefix' | 'substr' | 'none';
    matchedClasses: string[];
    classInstanceCount: number;
    descMatchCount: number;
}

const WEIGHTS = {
    nameExact: 1000,
    namePrefix: 500,
    nameSubstr: 200,
    classPresent: 100,
    classInstance: 10,
    descHit: 50,
    descPrefixBonus: 20,
};

function basename(relPath: string): string {
    const parts = relPath.split(/[\\/]/);
    return parts[parts.length - 1] || relPath;
}

interface Scored {
    result: SearchResult;
    nameContribution: number;
    classContribution: number;
    descContribution: number;
    nameSatisfied: boolean;
    classSatisfied: boolean;
    descSatisfied: boolean;
}

function evaluate(record: AnnotationRecord, query: SearchQuery): Scored {
    // Name
    const nameQ = query.name.trim().toLowerCase();
    let nameMatchKind: SearchResult['nameMatchKind'] = 'none';
    let nameContribution = 0;
    if (nameQ) {
        const base = basename(record.relPath).toLowerCase();
        if (base === nameQ) { nameMatchKind = 'exact'; nameContribution = WEIGHTS.nameExact; }
        else if (base.startsWith(nameQ)) { nameMatchKind = 'prefix'; nameContribution = WEIGHTS.namePrefix; }
        else if (base.includes(nameQ)) { nameMatchKind = 'substr'; nameContribution = WEIGHTS.nameSubstr; }
        else if (record.relPath.toLowerCase().includes(nameQ)) { nameMatchKind = 'substr'; nameContribution = WEIGHTS.nameSubstr; }
    }

    // Classes (multi-select OR)
    const matchedClasses: string[] = [];
    let classInstanceCount = 0;
    for (const c of query.classes) {
        const count = record.labels.get(c);
        if (count && count > 0) { matchedClasses.push(c); classInstanceCount += count; }
    }
    const classContribution = matchedClasses.length * WEIGHTS.classPresent + classInstanceCount * WEIGHTS.classInstance;

    // Description (substring)
    const descQ = query.description.trim().toLowerCase();
    let descMatchCount = 0;
    let descPrefixCount = 0;
    if (descQ) {
        for (const d of record.descriptions) {
            const dl = d.toLowerCase();
            if (dl.includes(descQ)) {
                descMatchCount++;
                if (dl === descQ || dl.startsWith(descQ)) descPrefixCount++;
            }
        }
    }
    const descContribution = descMatchCount * WEIGHTS.descHit + descPrefixCount * WEIGHTS.descPrefixBonus;

    return {
        result: {
            relPath: record.relPath,
            score: 0,
            nameMatchKind,
            matchedClasses,
            classInstanceCount,
            descMatchCount,
        },
        nameContribution,
        classContribution,
        descContribution,
        nameSatisfied: nameMatchKind !== 'none',
        classSatisfied: matchedClasses.length > 0,
        descSatisfied: descMatchCount > 0,
    };
}

export function runAdvancedSearch(index: AnnotationIndex, query: SearchQuery): SearchResult[] {
    const nameActive = query.name.trim() !== '';
    const classActive = query.classes.length > 0;
    const descActive = query.description.trim() !== '';
    if (!nameActive && !classActive && !descActive) return [];

    const out: SearchResult[] = [];
    for (const record of index) {
        const s = evaluate(record, query);

        const activeFlags: boolean[] = [];
        const satisfiedFlags: boolean[] = [];
        if (nameActive) { activeFlags.push(true); satisfiedFlags.push(s.nameSatisfied); }
        if (classActive) { activeFlags.push(true); satisfiedFlags.push(s.classSatisfied); }
        if (descActive) { activeFlags.push(true); satisfiedFlags.push(s.descSatisfied); }

        const qualifies = query.combinator === 'all'
            ? satisfiedFlags.every(Boolean)
            : satisfiedFlags.some(Boolean);
        if (!qualifies) continue;

        // Score = sum of contributions from satisfied active criteria.
        let score = 0;
        if (nameActive && s.nameSatisfied) score += s.nameContribution;
        if (classActive && s.classSatisfied) score += s.classContribution;
        if (descActive && s.descSatisfied) score += s.descContribution;

        out.push({ ...s.result, score });
    }

    out.sort((a, b) => (b.score - a.score) || comparePathsNaturally(a.relPath, b.relPath));
    return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all `searchEngine` describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/searchEngine.ts test/searchEngine.test.ts
git commit -m "feat: add pure advanced-search scoring engine"
```

---

## Task 3: Annotation index + message handlers in LabelMePanel

**Files:**
- Modify: `src/LabelMePanel.ts` (imports near top; new fields after `_scanGeneration`; new methods; two `case` handlers in `onDidReceiveMessage`; one line in `_refreshWorkspaceImages`; one call in `saveAnnotation`).

- [ ] **Step 1: Add the import**

In `src/LabelMePanel.ts`, after the `import { buildLabelMeAnnotation, ... } from './labelMeUtils';` block add:

```ts
import { AnnotationRecord, SearchQuery, runAdvancedSearch } from './searchEngine';
```

- [ ] **Step 2: Add cache fields**

After the line `private _scanGeneration = 0;` add:

```ts
    private _annotationIndex: AnnotationRecord[] | null = null;
    private _annotationIndexGeneration = -1; // matches _scanGeneration when the index is valid
```

- [ ] **Step 3: Add the index + handler methods**

Add these methods to the class (e.g. just before `private async saveAnnotation`):

```ts
    private async _readAnnotationRecord(rel: string): Promise<AnnotationRecord> {
        const labels = new Map<string, number>();
        const descriptions: string[] = [];
        const absImg = path.join(this._rootPath, rel);
        const jsonPath = absImg.replace(/\.[^/.]+$/, '') + '.json';
        if (existsSync(jsonPath)) {
            try {
                const json = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
                for (const s of (json.shapes || [])) {
                    if (s && typeof s.label === 'string' && s.label) {
                        labels.set(s.label, (labels.get(s.label) || 0) + 1);
                    }
                    if (s && typeof s.description === 'string' && s.description.trim()) {
                        descriptions.push(s.description);
                    }
                }
            } catch {
                // Treat unreadable/invalid JSON as an empty record.
            }
        }
        return { relPath: rel, labels, descriptions };
    }

    private async _buildAnnotationIndex(): Promise<AnnotationRecord[]> {
        if (this._workspaceImages.length === 0) {
            await this._scanWorkspaceImages();
        }
        const rels = this._workspaceImages.slice();
        const records: AnnotationRecord[] = [];
        const BATCH = 32;
        for (let i = 0; i < rels.length; i += BATCH) {
            const batch = rels.slice(i, i + BATCH);
            const recs = await Promise.all(batch.map(rel => this._readAnnotationRecord(rel)));
            records.push(...recs);
        }
        return records;
    }

    private async _getAnnotationIndex(): Promise<AnnotationRecord[]> {
        if (this._annotationIndex && this._annotationIndexGeneration === this._scanGeneration) {
            return this._annotationIndex;
        }
        const idx = await this._buildAnnotationIndex();
        this._annotationIndex = idx;
        this._annotationIndexGeneration = this._scanGeneration;
        return idx;
    }

    private _updateIndexForCurrentImage(shapes: any[]): void {
        if (!this._annotationIndex) return;
        const rel = path.relative(this._rootPath, this._imageUri.fsPath);
        const labels = new Map<string, number>();
        const descriptions: string[] = [];
        for (const s of (shapes || [])) {
            if (s && typeof s.label === 'string' && s.label) {
                labels.set(s.label, (labels.get(s.label) || 0) + 1);
            }
            if (s && typeof s.description === 'string' && s.description.trim()) {
                descriptions.push(s.description);
            }
        }
        const existing = this._annotationIndex.find(r => r.relPath === rel);
        if (existing) { existing.labels = labels; existing.descriptions = descriptions; }
        else { this._annotationIndex.push({ relPath: rel, labels, descriptions }); }
    }

    private async _handleAdvancedSearchPrepare(): Promise<void> {
        const index = await this._getAnnotationIndex();
        const classCounts = new Map<string, number>();
        for (const rec of index) {
            for (const [label, count] of rec.labels) {
                classCounts.set(label, (classCounts.get(label) || 0) + count);
            }
        }
        const classes = Array.from(classCounts.entries())
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
        this._safePost({
            command: 'advancedSearchPrepareResult',
            classes,
            imageCount: index.length
        });
    }

    private async _handleAdvancedSearchRun(query: SearchQuery): Promise<void> {
        const index = await this._getAnnotationIndex();
        const results = runAdvancedSearch(index, query);
        this._safePost({
            command: 'advancedSearchRunResult',
            results,
            total: results.length
        });
    }
```

- [ ] **Step 4: Wire the two messages**

In the `onDidReceiveMessage` switch, after the `case 'exportDatasetRun':` block add:

```ts
                    case 'advancedSearchPrepare':
                        await this._handleAdvancedSearchPrepare();
                        return;
                    case 'advancedSearchRun':
                        await this._handleAdvancedSearchRun(message.query);
                        return;
```

- [ ] **Step 5: Invalidate on refresh**

In `_refreshWorkspaceImages`, right after `this._workspaceImages = [];` add:

```ts
        this._annotationIndex = null; // force a rebuild on next search
```

- [ ] **Step 6: Keep the index fresh after save**

In `saveAnnotation`, inside the `try` block right after the `await fs.writeFile(...)` succeeds (before/after the success `_notify`), add:

```ts
            this._updateIndexForCurrentImage(data.shapes || []);
```

- [ ] **Step 7: Compile**

Run: `npm run compile`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/LabelMePanel.ts
git commit -m "feat: annotation index + advanced-search message handlers"
```

---

## Task 4: Webview pure helpers (`media/advancedSearchHelpers.js`) — TDD

**Files:**
- Create: `media/advancedSearchHelpers.js`
- Test: `test/advancedSearchHelpers.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/advancedSearchHelpers.test.ts`:

```ts
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';

const helpers = require(path.resolve(__dirname, '..', '..', 'media', 'advancedSearchHelpers.js'));
const { normalizeQuery, hasActiveCriteria, filterClassNames, formatBanner } = helpers;

describe('normalizeQuery', () => {
    it('trims name/description and defaults combinator to all', () => {
        const q = normalizeQuery({ name: '  cat ', description: ' edge ', classes: ['car'] });
        assert.deepEqual(q, { combinator: 'all', name: 'cat', classes: ['car'], description: 'edge' });
    });
    it('passes through combinator any and empty arrays', () => {
        const q = normalizeQuery({ combinator: 'any' });
        assert.deepEqual(q, { combinator: 'any', name: '', classes: [], description: '' });
    });
});

describe('hasActiveCriteria', () => {
    it('is false when nothing is set', () => {
        assert.equal(hasActiveCriteria({ combinator: 'all', name: '', classes: [], description: '' }), false);
    });
    it('is true when any one criterion is set', () => {
        assert.equal(hasActiveCriteria({ combinator: 'all', name: 'a', classes: [], description: '' }), true);
        assert.equal(hasActiveCriteria({ combinator: 'all', name: '', classes: ['x'], description: '' }), true);
        assert.equal(hasActiveCriteria({ combinator: 'all', name: '', classes: [], description: 'd' }), true);
    });
});

describe('filterClassNames', () => {
    const classes = [{ name: 'car', count: 3 }, { name: 'cat', count: 1 }, { name: 'dog', count: 2 }];
    it('returns all when the filter is empty', () => {
        assert.equal(filterClassNames(classes, '').length, 3);
    });
    it('filters case-insensitively by substring', () => {
        assert.deepEqual(filterClassNames(classes, 'ca').map((c: any) => c.name), ['car', 'cat']);
        assert.deepEqual(filterClassNames(classes, 'O').map((c: any) => c.name), ['dog']);
    });
});

describe('formatBanner', () => {
    it('substitutes the count into the template', () => {
        assert.equal(formatBanner(7, 'Advanced filter active ({count})'), 'Advanced filter active (7)');
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../media/advancedSearchHelpers.js'`.

- [ ] **Step 3: Implement `media/advancedSearchHelpers.js`**

Create `media/advancedSearchHelpers.js`:

```js
// Pure, DOM-free helpers for the advanced-search modal. Loaded as a <script>
// in the webview AND required from Node tests. No DOM access here.
(function (root) {
    // Normalize a raw query object (trims strings, fills defaults).
    function normalizeQuery(raw) {
        raw = raw || {};
        return {
            combinator: raw.combinator === 'any' ? 'any' : 'all',
            name: (raw.name || '').trim(),
            classes: Array.isArray(raw.classes) ? raw.classes.slice() : [],
            description: (raw.description || '').trim(),
        };
    }

    function hasActiveCriteria(query) {
        return !!(query && (query.name || query.description || (query.classes && query.classes.length)));
    }

    // Filter [{name,count}] by a case-insensitive substring of the name.
    function filterClassNames(classes, filterText) {
        const f = (filterText || '').trim().toLowerCase();
        if (!f) return classes.slice();
        return classes.filter(c => c.name.toLowerCase().includes(f));
    }

    // Replace {count} in a banner template.
    function formatBanner(total, template) {
        return String(template).replace(/\{count\}/g, String(total));
    }

    const api = { normalizeQuery, hasActiveCriteria, filterClassNames, formatBanner };
    if (root) root.AdvancedSearchHelpers = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add media/advancedSearchHelpers.js test/advancedSearchHelpers.test.ts
git commit -m "feat: pure helpers for advanced-search webview"
```

---

## Task 5: Icon, search-field button, modal, and banner markup

**Files:**
- Modify: `src/LabelMePanel.ts` (`_getIconSprite`; search-field block; modal list near `exportDatasetModal`; new script tag; banner in the sidebar).

- [ ] **Step 1: Add the `icon-sliders` symbol**

In `_getIconSprite()`, add this symbol next to `icon-search` (inside the `<defs>`):

```ts
            <symbol id="icon-sliders" viewBox="0 0 24 24" ${SW}><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></symbol>
```

- [ ] **Step 2: Add the sliders button inside the search field**

Replace the `.search-field` block:

```ts
                            <div class="search-field">
                                <svg class="icon icon-sm search-field__icon" aria-hidden="true"><use href="#icon-search"/></svg>
                                <input type="search" id="searchInput" placeholder="Search images…" data-i18n-placeholder="placeholder.searchImages" />
                                <button id="searchCloseBtn" class="search-field__clear" data-tip-id="browser.searchClose" aria-label="Clear search"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-x"/></svg></button>
                            </div>
```

with (adds `advancedSearchBtn` between the input and the clear button):

```ts
                            <div class="search-field">
                                <svg class="icon icon-sm search-field__icon" aria-hidden="true"><use href="#icon-search"/></svg>
                                <input type="search" id="searchInput" placeholder="Search images…" data-i18n-placeholder="placeholder.searchImages" />
                                <button id="advancedSearchBtn" class="search-field__advanced" data-tip-id="browser.advancedSearch" aria-label="Advanced search"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-sliders"/></svg></button>
                                <button id="searchCloseBtn" class="search-field__clear" data-tip-id="browser.searchClose" aria-label="Clear search"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-x"/></svg></button>
                            </div>
```

- [ ] **Step 3: Add the result banner above the image list**

Immediately after the closing `</div>` of `searchInputContainer` and before `<ul id="imageBrowserList" ...>`, add:

```ts
                        <div id="advSearchBanner" class="adv-search-banner" style="display: none;">
                            <span id="advSearchBannerText" class="adv-search-banner__text"></span>
                            <button id="advSearchBannerClear" class="adv-search-banner__clear" aria-label="Clear advanced filter"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-x"/></svg></button>
                        </div>
```

- [ ] **Step 4: Add the advanced-search modal**

Immediately after the entire `<!-- Modal for Export Dataset -->` `<div id="exportDatasetModal" ...>...</div>` block, add:

```ts
                <!-- Modal for Advanced Search -->
                <div id="advancedSearchModal" class="modal">
                    <div class="modal-content advanced-search-content">
                        <button class="modal-close" data-modal-close="advancedSearchModal" aria-label="Close"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-x"/></svg></button>
                        <h3><svg class="icon" aria-hidden="true"><use href="#icon-sliders"/></svg> <span data-i18n="modal.advancedSearch">Advanced Search</span></h3>
                        <div class="onnx-form-group">
                            <label data-i18n="advSearch.combinator">Match</label>
                            <div class="onnx-radio-group segmented-group">
                                <label class="onnx-radio"><input type="radio" name="advSearchCombinator" value="all" checked /> <span data-i18n="advSearch.all">All (AND)</span></label>
                                <label class="onnx-radio"><input type="radio" name="advSearchCombinator" value="any" /> <span data-i18n="advSearch.any">Any (OR)</span></label>
                            </div>
                        </div>
                        <div class="onnx-form-group">
                            <label data-i18n="advSearch.imageName">Image name</label>
                            <input type="text" id="advSearchName" placeholder="Filename contains…" data-i18n-placeholder="advSearch.imageNamePlaceholder" />
                        </div>
                        <div class="onnx-form-group">
                            <label data-i18n="advSearch.classes">Class names</label>
                            <input type="text" id="advSearchClassFilter" class="adv-search-class-filter" placeholder="Filter classes…" data-i18n-placeholder="advSearch.classFilterPlaceholder" />
                            <div class="adv-search-class-actions">
                                <button id="advSearchClassAll" class="btn" data-i18n="advSearch.selectAll">Select all</button>
                                <button id="advSearchClassNone" class="btn" data-i18n="advSearch.clearClasses">Clear</button>
                            </div>
                            <ul id="advSearchClassList" class="adv-search-class-list"></ul>
                        </div>
                        <div class="onnx-form-group">
                            <label data-i18n="advSearch.description">Description</label>
                            <input type="text" id="advSearchDescription" placeholder="Description contains…" data-i18n-placeholder="advSearch.descriptionPlaceholder" />
                        </div>
                        <div class="modal-buttons">
                            <button id="advSearchRunBtn" class="btn btn-primary" data-i18n="advSearch.search">Search</button>
                            <button id="advSearchResetBtn" class="btn" data-i18n="advSearch.reset">Reset</button>
                            <button id="advSearchCancelBtn" class="btn" data-i18n="button.cancel">Cancel</button>
                        </div>
                    </div>
                </div>
```

- [ ] **Step 5: Load the helper script before main.js**

In the `<script src=...>` list at the end of the HTML, add this line immediately before `<script src="${scriptUri}"></script>`:

```ts
                <script src="${advancedSearchHelpersUri}"></script>
```

Then define `advancedSearchHelpersUri` next to the other `...Uri` declarations near the top of `_getHtmlForWebview` (e.g. after `popoverDismissUri`):

```ts
        const advancedSearchHelpersUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'advancedSearchHelpers.js')
        );
```

- [ ] **Step 6: Compile**

Run: `npm run compile`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/LabelMePanel.ts
git commit -m "feat: advanced-search icon, button, modal, and banner markup"
```

---

## Task 6: Styles

**Files:**
- Modify: `media/style.css` (append a new block).

- [ ] **Step 1: Append styles**

Add to the end of `media/style.css`:

```css
/* ===== Advanced search ===== */
.search-field__advanced {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    padding: 2px;
    cursor: pointer;
    color: var(--text-secondary, #888);
    border-radius: 4px;
}
.search-field__advanced:hover {
    color: var(--text-primary, #fff);
    background: var(--hover-bg, rgba(127, 127, 127, 0.15));
}

.adv-search-banner {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    margin: 4px 6px;
    font-size: 12px;
    border-radius: 4px;
    background: var(--accent-soft-bg, rgba(64, 128, 255, 0.15));
    border: 1px solid var(--accent-color, #4080ff);
}
.adv-search-banner__text { flex: 1 1 auto; }
.adv-search-banner__clear {
    display: flex;
    align-items: center;
    background: none;
    border: none;
    padding: 2px;
    cursor: pointer;
    color: inherit;
    border-radius: 4px;
}
.adv-search-banner__clear:hover { background: var(--hover-bg, rgba(127, 127, 127, 0.2)); }

.adv-search-class-filter { width: 100%; box-sizing: border-box; margin-bottom: 4px; }
.adv-search-class-actions { display: flex; gap: 6px; margin-bottom: 4px; }
.adv-search-class-actions .btn { padding: 2px 8px; font-size: 12px; }
.adv-search-class-list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 180px;
    overflow-y: auto;
    border: 1px solid var(--border-color, rgba(127, 127, 127, 0.3));
    border-radius: 4px;
}
.adv-search-class-list li {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    cursor: pointer;
}
.adv-search-class-list li:hover { background: var(--hover-bg, rgba(127, 127, 127, 0.12)); }
.adv-search-class-list .adv-search-class-count { margin-left: auto; opacity: 0.6; font-size: 11px; }

.image-browser-item .adv-search-badge {
    margin-left: 6px;
    font-size: 10px;
    opacity: 0.7;
}
```

- [ ] **Step 2: Commit**

```bash
git add media/style.css
git commit -m "feat: advanced-search styles"
```

---

## Task 7: i18n strings + tooltip

**Files:**
- Modify: `media/i18n.js` (add keys to BOTH the `en` and `zh-CN` dictionaries).
- Modify: `media/tipsData.js` (add `browser.advancedSearch`).

- [ ] **Step 1: Add English keys**

In `media/i18n.js`, inside the `en` dictionary object, add:

```js
            'browser.advancedSearch': 'Advanced search',
            'modal.advancedSearch': 'Advanced Search',
            'advSearch.combinator': 'Match',
            'advSearch.all': 'All (AND)',
            'advSearch.any': 'Any (OR)',
            'advSearch.imageName': 'Image name',
            'advSearch.imageNamePlaceholder': 'Filename contains…',
            'advSearch.classes': 'Class names',
            'advSearch.classFilterPlaceholder': 'Filter classes…',
            'advSearch.selectAll': 'Select all',
            'advSearch.clearClasses': 'Clear',
            'advSearch.description': 'Description',
            'advSearch.descriptionPlaceholder': 'Description contains…',
            'advSearch.search': 'Search',
            'advSearch.reset': 'Reset',
            'advSearch.bannerActive': 'Advanced filter active ({count})',
            'advSearch.noResults': 'No images match the advanced filter',
```

- [ ] **Step 2: Add Chinese keys**

In `media/i18n.js`, inside the `zh-CN` dictionary object, add:

```js
            'browser.advancedSearch': '高级搜索',
            'modal.advancedSearch': '高级搜索',
            'advSearch.combinator': '匹配',
            'advSearch.all': '全部满足 (AND)',
            'advSearch.any': '任一满足 (OR)',
            'advSearch.imageName': '图像名',
            'advSearch.imageNamePlaceholder': '文件名包含…',
            'advSearch.classes': '标注类名',
            'advSearch.classFilterPlaceholder': '过滤类名…',
            'advSearch.selectAll': '全选',
            'advSearch.clearClasses': '清空',
            'advSearch.description': '描述',
            'advSearch.descriptionPlaceholder': '描述包含…',
            'advSearch.search': '搜索',
            'advSearch.reset': '重置',
            'advSearch.bannerActive': '高级筛选生效 ({count})',
            'advSearch.noResults': '没有匹配高级筛选的图像',
```

- [ ] **Step 3: Add the tooltip entry**

In `media/tipsData.js`, after the `'browser.search': ...` line add:

```js
    'browser.advancedSearch': { title: 'Advanced Search', desc: 'Filter images by name, annotation class, and description with AND/OR.' },
```

- [ ] **Step 4: Commit**

```bash
git add media/i18n.js media/tipsData.js
git commit -m "feat: i18n strings and tooltip for advanced search"
```

---

## Task 8: Webview wiring in `media/main.js`

**Files:**
- Modify: `media/main.js` (DOM refs near other `getElementById` consts; two message cases ~line 1186; new state + functions near the existing search state ~line 6949; modify `getEffectiveImageList`, `updateImageCount`, `handleUpdateImageList`).

- [ ] **Step 1: Add DOM references**

Near the other search element refs (`const searchCloseBtn = document.getElementById('searchCloseBtn');`), add:

```js
const advancedSearchBtn = document.getElementById('advancedSearchBtn');
const advancedSearchModal = document.getElementById('advancedSearchModal');
const advSearchName = document.getElementById('advSearchName');
const advSearchDescription = document.getElementById('advSearchDescription');
const advSearchClassFilter = document.getElementById('advSearchClassFilter');
const advSearchClassList = document.getElementById('advSearchClassList');
const advSearchClassAll = document.getElementById('advSearchClassAll');
const advSearchClassNone = document.getElementById('advSearchClassNone');
const advSearchRunBtn = document.getElementById('advSearchRunBtn');
const advSearchResetBtn = document.getElementById('advSearchResetBtn');
const advSearchCancelBtn = document.getElementById('advSearchCancelBtn');
const advSearchBanner = document.getElementById('advSearchBanner');
const advSearchBannerText = document.getElementById('advSearchBannerText');
const advSearchBannerClear = document.getElementById('advSearchBannerClear');
```

- [ ] **Step 2: Add advanced-filter state + helpers**

Right after the existing search state block (the lines `let searchQuery = '';` and `let filteredImages = [];`), add:

```js
// Advanced search state
let advancedFilterActive = false;
let advancedResults = [];          // ranked relative paths
let advSearchClassData = [];       // [{name, count}] from the extension
const advSelectedClasses = new Set();

function tt(key, params) {
    return (window.i18n && window.i18n.t) ? window.i18n.t(key, params) : key;
}
```

- [ ] **Step 3: Make the filtered list advanced-aware**

Replace the existing `getEffectiveImageList`:

```js
function getEffectiveImageList() {
    if (searchQuery && filteredImages.length >= 0) {
        return filteredImages;
    }
    return typeof workspaceImages !== 'undefined' ? workspaceImages : [];
}
```

with:

```js
function getEffectiveImageList() {
    if (advancedFilterActive) {
        return advancedResults;
    }
    if (searchQuery && filteredImages.length >= 0) {
        return filteredImages;
    }
    return typeof workspaceImages !== 'undefined' ? workspaceImages : [];
}
```

- [ ] **Step 4: Make the count advanced-aware**

In `updateImageCount`, replace the two `searchQuery ? ... : ...` ternaries so advanced mode shows `(filtered/total)` like search does. Replace the function body's final `if (currentIndex === -1) { ... } else { ... }` with:

```js
    const filteredMode = advancedFilterActive || !!searchQuery;
    if (currentIndex === -1) {
        imageCountEl.textContent = filteredMode
            ? `(${effectiveImages.length}/${total})`
            : `(${total})`;
    } else {
        const currentPos = currentIndex + 1;
        imageCountEl.textContent = filteredMode
            ? `(${currentPos}/${effectiveImages.length}/${total})`
            : `(${currentPos}/${total})`;
    }
```

- [ ] **Step 5: Add the modal + apply/clear functions**

Add this block near the other search functions (e.g. after `filterImages`):

```js
function openAdvancedSearchModal() {
    if (!advancedSearchModal) return;
    advancedSearchModal.style.display = 'flex';
    if (advancedSearchBtn) advancedSearchBtn.disabled = true;
    // Request the class universe / image count from the extension.
    vscode.postMessage({ command: 'advancedSearchPrepare' });
}

function hideAdvancedSearchModal() {
    if (advancedSearchModal) advancedSearchModal.style.display = 'none';
    if (advancedSearchBtn) advancedSearchBtn.disabled = false;
}

function renderAdvancedClassList() {
    if (!advSearchClassList) return;
    const filterText = advSearchClassFilter ? advSearchClassFilter.value : '';
    const visible = window.AdvancedSearchHelpers.filterClassNames(advSearchClassData, filterText);
    advSearchClassList.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const cls of visible) {
        const li = document.createElement('li');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = cls.name;
        cb.checked = advSelectedClasses.has(cls.name);
        cb.onchange = () => {
            if (cb.checked) advSelectedClasses.add(cls.name);
            else advSelectedClasses.delete(cls.name);
        };
        const name = document.createElement('span');
        name.textContent = cls.name;
        const count = document.createElement('span');
        count.className = 'adv-search-class-count';
        count.textContent = cls.count;
        li.appendChild(cb);
        li.appendChild(name);
        li.appendChild(count);
        // Clicking the row (not the checkbox) toggles too.
        li.onclick = (e) => {
            if (e.target === cb) return;
            cb.checked = !cb.checked;
            cb.onchange();
        };
        frag.appendChild(li);
    }
    advSearchClassList.appendChild(frag);
}

function applyAdvancedPrepareResult(message) {
    advSearchClassData = message.classes || [];
    // Drop selections that no longer exist in the universe.
    for (const c of Array.from(advSelectedClasses)) {
        if (!advSearchClassData.some(x => x.name === c)) advSelectedClasses.delete(c);
    }
    renderAdvancedClassList();
    if (advancedSearchBtn) advancedSearchBtn.disabled = false;
}

function runAdvancedSearch() {
    const raw = {
        combinator: (document.querySelector('input[name="advSearchCombinator"]:checked') || {}).value || 'all',
        name: advSearchName ? advSearchName.value : '',
        classes: Array.from(advSelectedClasses),
        description: advSearchDescription ? advSearchDescription.value : '',
    };
    const query = window.AdvancedSearchHelpers.normalizeQuery(raw);
    if (!window.AdvancedSearchHelpers.hasActiveCriteria(query)) {
        clearAdvancedFilter();
        hideAdvancedSearchModal();
        return;
    }
    vscode.postMessage({ command: 'advancedSearchRun', query });
}

function applyAdvancedRunResult(message) {
    advancedResults = (message.results || []).map(r => r.relPath);
    advancedFilterActive = true;
    // Advanced filter takes over: clear/suppress the quick text search.
    searchQuery = '';
    filteredImages = [];
    if (searchInput) searchInput.value = '';
    if (searchInputContainer) searchInputContainer.style.display = 'none';
    if (searchCloseBtn) searchCloseBtn.classList.remove('visible');
    if (advSearchBanner) {
        advSearchBanner.style.display = 'flex';
        if (advSearchBannerText) {
            advSearchBannerText.textContent = window.AdvancedSearchHelpers.formatBanner(
                message.total, tt('advSearch.bannerActive', { count: message.total })
            );
        }
    }
    hideAdvancedSearchModal();
    virtualScrollState = { startIndex: -1, endIndex: -1, scrollTop: 0 };
    updateImageCount();
    renderImageBrowserList();
}

function clearAdvancedFilter() {
    advancedFilterActive = false;
    advancedResults = [];
    if (advSearchBanner) advSearchBanner.style.display = 'none';
    virtualScrollState = { startIndex: -1, endIndex: -1, scrollTop: 0 };
    updateImageCount();
    renderImageBrowserList();
}

function resetAdvancedSearchForm() {
    if (advSearchName) advSearchName.value = '';
    if (advSearchDescription) advSearchDescription.value = '';
    if (advSearchClassFilter) advSearchClassFilter.value = '';
    advSelectedClasses.clear();
    const allRadio = document.querySelector('input[name="advSearchCombinator"][value="all"]');
    if (allRadio) allRadio.checked = true;
    renderAdvancedClassList();
}
```

> Verified: modals in this codebase toggle via `style.display = 'flex'/'none'` (see `showExportDatasetModal`/`hideExportDatasetModal`), and the modal `×` is handled generically via `data-modal-close` (no manual wiring needed). The `advancedSearchModal` markup already includes `data-modal-close="advancedSearchModal"`.

- [ ] **Step 6: Wire the buttons**

Add near the other button wiring (e.g. after the `searchImagesBtn.onclick` block):

```js
if (advancedSearchBtn) advancedSearchBtn.onclick = openAdvancedSearchModal;
if (advSearchRunBtn) advSearchRunBtn.onclick = runAdvancedSearch;
if (advSearchResetBtn) advSearchResetBtn.onclick = resetAdvancedSearchForm;
if (advSearchCancelBtn) advSearchCancelBtn.onclick = hideAdvancedSearchModal;
if (advSearchBannerClear) advSearchBannerClear.onclick = clearAdvancedFilter;
if (advSearchClassFilter) advSearchClassFilter.oninput = renderAdvancedClassList;
if (advSearchClassAll) advSearchClassAll.onclick = () => {
    const filterText = advSearchClassFilter ? advSearchClassFilter.value : '';
    for (const c of window.AdvancedSearchHelpers.filterClassNames(advSearchClassData, filterText)) {
        advSelectedClasses.add(c.name);
    }
    renderAdvancedClassList();
};
if (advSearchClassNone) advSearchClassNone.onclick = () => {
    advSelectedClasses.clear();
    renderAdvancedClassList();
};
```

- [ ] **Step 7: Handle the two messages**

In the `switch (message.command)` block (after `case 'exportDatasetRunResult': { ... }`), add:

```js
        case 'advancedSearchPrepareResult': {
            applyAdvancedPrepareResult(message);
            break;
        }
        case 'advancedSearchRunResult': {
            applyAdvancedRunResult(message);
            break;
        }
```

- [ ] **Step 8: Clear the advanced filter when the list is rebuilt**

In `handleUpdateImageList` (called on `updateImageList`), at the very top of the function body add:

```js
    // A refreshed/rescanned list invalidates the advanced results (the index changed).
    if (advancedFilterActive) {
        clearAdvancedFilter();
    }
```

- [ ] **Step 9: Compile + run all tests**

Run: `npm run compile && npm test`
Expected: compile clean; all tests pass.

- [ ] **Step 10: Commit**

```bash
git add media/main.js
git commit -m "feat: wire advanced-search modal, results, and banner in webview"
```

---

## Task 9: Verification

- [ ] **Step 1: Full build + test**

Run: `npm run compile && npm test`
Expected: no compile errors; all `node --test` suites pass.

- [ ] **Step 2: Manual smoke test (notify the user to drive this)**

Launch the extension (F5 / Extension Development Host), open a folder with several annotated images, then verify:

1. The sliders button appears inside the search field; clicking it opens the Advanced Search modal.
2. The class list is populated with class names + instance counts; the "Filter classes…" box narrows it; Select all / Clear work.
3. **Name only:** type a partial filename → Search → sidebar shows only matching images, exact/prefix names ranked first; banner shows "Advanced filter active (N)".
4. **Class only (multi-select):** pick 2 classes → Search → images containing *either* class appear, those with more matches/instances ranked higher.
5. **Description only:** type a description substring → Search → only images whose shapes' descriptions contain it.
6. **ALL vs ANY:** set name + class; toggle ALL → intersection; ANY → union.
7. The banner ✕ clears the filter and restores the normal list + quick search field.
8. Refresh (rescan) while a filter is active clears the banner.
9. Edit + save annotations on the current image, reopen Advanced Search → the class list / results reflect the saved change.
10. Switch language to 中文 → modal labels, buttons, and banner are translated.

- [ ] **Step 3: Final commit (if any smoke fixes were made)**

```bash
git add -A
git commit -m "fix: advanced-search smoke-test adjustments"
```

---

## Self-review notes

- **Spec coverage:** name/class/description criteria (Tasks 2,8); ALL/ANY combinator (Task 2 scoring + Task 8 form); composite weighted ranking + tie-break (Task 2); index build/cache/invalidate + save-freshness (Task 3); modal in the search box + banner takeover (Tasks 5,8); message protocol (Tasks 3,8); i18n en+zh (Task 7); pure-function tests (Tasks 2,4). All spec sections map to a task.
- **Type consistency:** `SearchQuery`/`AnnotationRecord`/`SearchResult` defined in Task 2 are the exact shapes imported in Task 3; webview `normalizeQuery` output matches the `SearchQuery` fields; message commands (`advancedSearchPrepare/Run` + `...Result`) match on both sides.
- **Known assumption to verify during execution:** modal show/hide mechanism (`.show` class vs `style.display`) — Task 8 Step 5 flags this; match the codebase's existing modal pattern (inspect `showExportDatasetModal`/`hideExportDatasetModal`).
