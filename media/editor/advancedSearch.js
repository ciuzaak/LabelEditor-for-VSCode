// LabelEditor webview — Advanced search dialog and class combobox.
// Part of the editor bundle: build/bundle-webview.js concatenates media/editor/*.js,
// in the order listed there, into one classic script (shared scope, hoisting).

// ===== Advanced search =====
function openAdvancedSearchModal() {
    if (!advancedSearchModal) return;
    advancedSearchModal.style.display = 'flex';
    renderAdvConditions(); // opens with whatever conditions exist (none on first open)
    // Reopening with existing class conditions: re-fetch the universe if a prior
    // load was cancelled (e.g. the modal closed before indexing finished), so the
    // combobox always has data to offer instead of being stuck empty.
    if (advConditions.some(c => c.type === 'class')) ensureClassUniverse();
}

function hideAdvancedSearchModal() {
    if (advancedSearchModal) advancedSearchModal.style.display = 'none';
    closeClassCombo();
    // Leaving the filter UI stops any in-flight class indexing.
    if (advIndexing) cancelIndexing();
}

function setIndexStatus(text) {
    if (!advSearchIndexStatus) return;
    advSearchIndexStatus.textContent = text || '';
    advSearchIndexStatus.style.display = text ? 'inline' : 'none';
}

function updateAddClassButtonState() {
    if (advSearchAddClass) advSearchAddClass.disabled = advIndexing;
}

// The class universe (for autocomplete) requires reading every sidecar JSON, so
// it is fetched only the first time a class condition is added.
function ensureClassUniverse() {
    if (advClassUniverseLoaded || advIndexing) return;
    advIndexing = true;
    updateAddClassButtonState();
    setIndexStatus(tt('advSearch.indexingStart'));
    const requestId = ++advPrepareSeq;
    vscode.postMessage({ command: 'advancedSearchPrepare', requestId });
}

function cancelIndexing() {
    if (!advIndexing) return;
    advIndexing = false;
    advPrepareSeq++; // invalidate any in-flight prepare response so it can't repopulate the datalist
    vscode.postMessage({ command: 'advancedSearchCancelIndex' });
    setIndexStatus('');
    updateAddClassButtonState();
}

function addAdvCondition(type) {
    advConditions.push({ id: ++advCondSeq, type, value: '', classes: [] });
    if (type === 'class') ensureClassUniverse();
    renderAdvConditions();
}

function removeAdvCondition(id) {
    advConditions = advConditions.filter(c => c.id !== id);
    renderAdvConditions();
    // If the class condition that triggered indexing is gone, stop indexing.
    if (advIndexing && !advConditions.some(c => c.type === 'class')) cancelIndexing();
}

function renderAdvConditions() {
    if (!advSearchConditions) return;
    // Re-rendering recreates every condition input, detaching whatever the shared
    // combobox was bound to; close it first so it can't linger over a stale node
    // (e.g. after removing the very class condition whose popup is open).
    closeClassCombo();
    advSearchConditions.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const cond of advConditions) frag.appendChild(buildAdvConditionRow(cond));
    advSearchConditions.appendChild(frag);
}

function renderAdvChips(chipsEl, cond) {
    chipsEl.innerHTML = '';
    cond.classes.forEach((cls, i) => {
        const chip = document.createElement('span');
        chip.className = 'adv-cond__chip';
        const text = document.createElement('span');
        text.textContent = cls;
        const x = document.createElement('button');
        x.className = 'adv-cond__chip-remove';
        x.type = 'button';
        x.textContent = '×';
        x.onclick = () => { cond.classes.splice(i, 1); renderAdvChips(chipsEl, cond); };
        chip.appendChild(text);
        chip.appendChild(x);
        chipsEl.appendChild(chip);
    });
}

function buildAdvConditionRow(cond) {
    const row = document.createElement('div');
    row.className = 'adv-cond';
    row.dataset.type = cond.type;

    const label = document.createElement('span');
    label.className = 'adv-cond__label';
    label.textContent = cond.type === 'name' ? tt('advSearch.typeName')
        : cond.type === 'nameRegex' ? tt('advSearch.typeNameRegex')
        : cond.type === 'class' ? tt('advSearch.typeClass')
        : tt('advSearch.typeName');
    row.appendChild(label);

    if (cond.type === 'class') {
        const body = document.createElement('div');
        body.className = 'adv-cond__body adv-cond__class-body';
        const chips = document.createElement('div');
        chips.className = 'adv-cond__chips';

        // Custom combobox: a text input plus an always-visible caret toggle. We
        // intentionally avoid the native <datalist> here (its dropdown arrow only
        // renders when the list is non-empty, and its popup can't be aligned or
        // made to scroll inside the blurred modal).
        const wrap = document.createElement('div');
        wrap.className = 'adv-cond__class-input-wrap';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'adv-cond__value adv-cond__class-input';
        input.placeholder = tt('advSearch.classInputPlaceholder');
        input.setAttribute('autocomplete', 'off');
        // ARIA combobox wiring (parity with the native control we replaced).
        input.setAttribute('role', 'combobox');
        input.setAttribute('aria-autocomplete', 'list');
        input.setAttribute('aria-haspopup', 'listbox');
        input.setAttribute('aria-controls', 'advClassCombo');
        input.setAttribute('aria-expanded', 'false');
        // Give the input an accessible name via the visible "Class" label.
        label.id = 'advCondLabel' + cond.id;
        input.setAttribute('aria-labelledby', label.id);
        const caret = document.createElement('button');
        caret.type = 'button';
        caret.className = 'adv-cond__class-caret';
        caret.setAttribute('aria-label', tt('advSearch.classInputPlaceholder'));
        caret.innerHTML = '<svg class="icon icon-sm" aria-hidden="true"><use href="#icon-chevron-down"/></svg>';

        const addChip = (val) => {
            const v = (val || '').trim();
            if (!v) return;
            if (!cond.classes.includes(v)) cond.classes.push(v);
            input.value = '';
            renderAdvChips(chips, cond);
        };
        // Let the shared combobox commit a picked/highlighted option to this input.
        input._advAddChip = addChip;

        input.addEventListener('keydown', (e) => {
            // Give the open combobox first crack at arrow/enter/escape navigation.
            if (advClassComboInput === input && handleClassComboKeydown(e)) return;
            if (e.key === 'Enter') {
                e.preventDefault();
                addChip(input.value);
                // Refresh the open popup so the just-added class drops out and the
                // (now-empty) filter shows fresh suggestions — matching option-pick.
                if (advClassComboInput === input) renderClassCombo();
            }
            else if (e.key === 'Backspace' && !input.value && cond.classes.length) {
                cond.classes.pop();
                renderAdvChips(chips, cond);
            }
        });
        input.addEventListener('input', () => openClassCombo(input, cond));
        input.addEventListener('focus', () => openClassCombo(input, cond));
        // change still captures a typed-but-not-Entered value on blur, so it is not
        // silently lost; picking an option keeps focus (no blur) so this won't fire.
        input.addEventListener('change', () => { if (input.value) addChip(input.value); });
        // Close the popup when focus genuinely leaves the input (e.g. Tab away).
        // Option/caret clicks use mousedown+preventDefault, so they never blur here.
        input.addEventListener('blur', () => { if (advClassComboInput === input) closeClassCombo(); });
        caret.addEventListener('mousedown', (e) => {
            // mousedown (not click) so it runs before the input's blur/dismiss path.
            e.preventDefault();
            const open = advClassComboInput === input && advClassComboEl && advClassComboEl.style.display !== 'none';
            if (open) { closeClassCombo(); }
            else { input.focus(); openClassCombo(input, cond); }
        });

        renderAdvChips(chips, cond);
        wrap.appendChild(input);
        wrap.appendChild(caret);
        body.appendChild(chips);
        body.appendChild(wrap);
        row.appendChild(body);
    } else {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'adv-cond__value';
        input.value = cond.value || '';
        input.placeholder = cond.type === 'nameRegex'
            ? tt('advSearch.nameRegexPlaceholder')
            : tt('advSearch.nameInputPlaceholder');
        const validateRegex = () => {
            if (cond.type !== 'nameRegex') return;
            const v = input.value;
            if (!v) { input.classList.remove('invalid'); return; }
            try { new RegExp(v); input.classList.remove('invalid'); }
            catch { input.classList.add('invalid'); }
        };
        input.addEventListener('input', () => { cond.value = input.value; validateRegex(); });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); runAdvancedSearchQuery(); }
        });
        validateRegex();
        row.appendChild(input);
    }

    const remove = document.createElement('button');
    remove.className = 'adv-cond__remove';
    remove.type = 'button';
    remove.setAttribute('aria-label', tt('aria.removeCondition'));
    remove.innerHTML = '<svg class="icon icon-sm" aria-hidden="true"><use href="#icon-x"/></svg>';
    remove.onclick = () => removeAdvCondition(cond.id);
    row.appendChild(remove);

    return row;
}

// ---- Custom class combobox (shared listbox anchored to the active input) ----
function ensureClassComboEl() {
    if (advClassComboEl) return advClassComboEl;
    const el = document.createElement('div');
    el.id = 'advClassCombo';
    el.className = 'adv-combobox-dropdown';
    el.setAttribute('role', 'listbox');
    el.style.display = 'none';
    // Swallow mousedown on the dropdown's own chrome (padding / scrollbar) so it
    // never blurs the input; option rows handle their own mousedown below.
    el.addEventListener('mousedown', (e) => { if (e.target === el) e.preventDefault(); });
    document.body.appendChild(el);
    advClassComboEl = el;
    return el;
}

function openClassCombo(input, cond) {
    ensureClassComboEl();
    advClassComboInput = input;
    advClassComboCond = cond;
    advClassComboActiveIndex = -1;
    input.setAttribute('aria-expanded', 'true');
    // The universe loads lazily; (re)trigger it in case a prior load was cancelled.
    ensureClassUniverse();
    renderClassCombo();
}

function positionClassCombo() {
    const el = advClassComboEl;
    const input = advClassComboInput;
    if (!el || !input || el.style.display === 'none') return;
    const anchor = input.closest('.adv-cond__class-input-wrap') || input;
    const r = anchor.getBoundingClientRect();
    const GAP = 4, MARGIN = 12, MIN_H = 120, MAX_H = 280;
    const roomBelow = window.innerHeight - r.bottom - MARGIN;
    const roomAbove = r.top - MARGIN;
    // Prefer opening below; flip above only when below is too cramped to be usable
    // and above genuinely has more room (e.g. the input sits low in a tall modal).
    const placeAbove = roomBelow < MIN_H && roomAbove > roomBelow;
    const maxH = Math.max(0, Math.min(MAX_H, placeAbove ? roomAbove : roomBelow));
    el.style.left = r.left + 'px';
    el.style.width = r.width + 'px';
    el.style.maxHeight = maxH + 'px';
    if (placeAbove) {
        // scrollHeight is the natural content height (ignores maxHeight); sit the
        // box just above the input, capped to the room available.
        const h = Math.min(maxH, el.scrollHeight);
        el.style.top = (r.top - GAP - h) + 'px';
    } else {
        el.style.top = (r.bottom + GAP) + 'px';
    }
}

function renderClassCombo() {
    const el = advClassComboEl;
    const input = advClassComboInput;
    const cond = advClassComboCond;
    if (!el || !input) return;
    el.innerHTML = '';
    // Rebuilding invalidates the option set: drop any stale highlight/active id.
    advClassComboActiveIndex = -1;
    input.removeAttribute('aria-activedescendant');
    if (advIndexing && !advClassUniverseLoaded) {
        const loading = document.createElement('div');
        loading.className = 'adv-combobox-empty';
        loading.textContent = tt('advSearch.indexingStart');
        el.appendChild(loading);
        el.style.display = 'block';
        positionClassCombo();
        return;
    }
    const matches = window.AdvancedSearchHelpers.filterClassNames(advSearchClassData, input.value)
        .filter(c => !cond || !cond.classes.includes(c.name)); // hide already-picked classes
    if (!matches.length) {
        const empty = document.createElement('div');
        empty.className = 'adv-combobox-empty';
        empty.textContent = tt('advSearch.noClassMatches');
        el.appendChild(empty);
    } else {
        const frag = document.createDocumentFragment();
        for (let i = 0; i < matches.length; i++) {
            const c = matches[i];
            const opt = document.createElement('div');
            opt.className = 'adv-combobox-option';
            opt.id = 'advClassOpt' + i;
            opt.setAttribute('role', 'option');
            opt.setAttribute('aria-selected', 'false');
            opt.dataset.index = String(i);
            const name = document.createElement('span');
            name.className = 'adv-combobox-option__name';
            name.textContent = c.name;
            const count = document.createElement('span');
            count.className = 'adv-combobox-option__count';
            count.textContent = String(c.count);
            opt.appendChild(name);
            opt.appendChild(count);
            // mousedown (not click): keeps the input focused (no blur → no stray
            // `change` committing the typed text instead of the picked class).
            opt.addEventListener('mousedown', (e) => { e.preventDefault(); commitClassPick(c.name); });
            frag.appendChild(opt);
        }
        el.appendChild(frag);
    }
    el.style.display = 'block';
    positionClassCombo();
}

function commitClassPick(name) {
    const input = advClassComboInput;
    if (!input || typeof input._advAddChip !== 'function') return;
    input._advAddChip(name);
    advClassComboActiveIndex = -1;
    // Re-filter: the picked class drops out and the list stays open for more picks.
    renderClassCombo();
}

function highlightClassComboOption(delta) {
    const el = advClassComboEl;
    if (!el) return;
    const opts = el.querySelectorAll('.adv-combobox-option');
    if (!opts.length) {
        advClassComboActiveIndex = -1;
        if (advClassComboInput) advClassComboInput.removeAttribute('aria-activedescendant');
        return;
    }
    let i = advClassComboActiveIndex + delta;
    if (i < 0) i = opts.length - 1;
    if (i >= opts.length) i = 0;
    advClassComboActiveIndex = i;
    opts.forEach((o, idx) => {
        const on = idx === i;
        o.classList.toggle('active', on);
        o.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    opts[i].scrollIntoView({ block: 'nearest' });
    if (advClassComboInput) advClassComboInput.setAttribute('aria-activedescendant', opts[i].id);
}

// Returns true when the keydown was consumed by the open combobox.
function handleClassComboKeydown(e) {
    const el = advClassComboEl;
    if (!el || el.style.display === 'none') return false;
    if (e.key === 'ArrowDown') { e.preventDefault(); highlightClassComboOption(1); return true; }
    if (e.key === 'ArrowUp') { e.preventDefault(); highlightClassComboOption(-1); return true; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeClassCombo(); return true; }
    if (e.key === 'Enter' && advClassComboActiveIndex >= 0) {
        const active = el.querySelector('.adv-combobox-option.active');
        if (active) {
            e.preventDefault();
            commitClassPick(active.querySelector('.adv-combobox-option__name').textContent);
            return true;
        }
    }
    return false;
}

function closeClassCombo() {
    if (advClassComboEl) advClassComboEl.style.display = 'none';
    if (advClassComboInput) {
        advClassComboInput.setAttribute('aria-expanded', 'false');
        advClassComboInput.removeAttribute('aria-activedescendant');
    }
    advClassComboInput = null;
    advClassComboCond = null;
    advClassComboActiveIndex = -1;
}

function applyAdvancedPrepareResult(message) {
    // Drop stale prepare responses (cancelled, reset, or superseded by a newer request).
    if (message.requestId !== advPrepareSeq) return;
    advSearchClassData = message.classes || [];
    advClassUniverseLoaded = true;
    advIndexing = false;
    setIndexStatus('');
    updateAddClassButtonState();
    // If the class combobox is open, refresh it now that the universe has arrived.
    if (advClassComboInput) renderClassCombo();
}

function runAdvancedSearchQuery() {
    const query = window.AdvancedSearchHelpers.buildQuery(advConditions);
    if (!window.AdvancedSearchHelpers.hasActiveConditions(query)) {
        clearAdvancedFilter();
        hideAdvancedSearchModal();
        return;
    }
    const requestId = ++advSearchRunSeq;
    vscode.postMessage({ command: 'advancedSearchRun', query, requestId });
}

function applyAdvancedRunResult(message) {
    // Drop stale/out-of-order responses (and any that arrive after a clear).
    if (message.requestId !== advSearchRunSeq) return;
    advancedResults = message.results || []; // already an array of relative paths, in gallery order
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
    persistAdvancedState();
}

function clearAdvancedFilter() {
    advancedFilterActive = false;
    advancedResults = [];
    advSearchRunSeq++; // invalidate any in-flight search response so it can't re-activate the filter
    if (advSearchBanner) advSearchBanner.style.display = 'none';
    virtualScrollState = { startIndex: -1, endIndex: -1, scrollTop: 0 };
    updateImageCount();
    renderImageBrowserList();
    persistAdvancedState();
}

// Persist the advanced-filter state so it survives a webview re-init, exactly
// like the quick-search query is persisted/restored. Without this, a webview
// reload kept the quick search (restored from state) but silently dropped the
// advanced filter — the "advanced search fails but normal works" bug.
const ADV_RESULT_PERSIST_CAP = 5000; // snapshot up to this many results; beyond it, re-run on restore
function persistAdvancedState() {
    const state = vscode.getState() || {};
    // Keep quick-search persistence in sync: advanced search suppresses the quick
    // filter, so a stale persisted searchQuery must not resurrect it on reload.
    state.searchQuery = searchQuery;
    state.advancedFilterActive = advancedFilterActive;
    state.advConditions = advConditions.map(c => ({
        type: c.type,
        value: c.value || '',
        classes: Array.isArray(c.classes) ? c.classes.slice() : []
    }));
    // Snapshot results for instant restore, but cap webview-state size for huge
    // result sets; beyond the cap, restore re-derives from the persisted conditions.
    if (advancedFilterActive && advancedResults.length <= ADV_RESULT_PERSIST_CAP) {
        state.advancedResults = advancedResults;
        state.advancedNeedsRerun = false;
    } else {
        state.advancedResults = [];
        state.advancedNeedsRerun = advancedFilterActive;
    }
    vscode.setState(state);
}

function resetAdvancedSearchForm() {
    advConditions = [];
    renderAdvConditions();
}

if (advancedSearchBtn) advancedSearchBtn.onclick = openAdvancedSearchModal;
if (advSearchAddName) advSearchAddName.onclick = () => addAdvCondition('name');
if (advSearchAddNameRegex) advSearchAddNameRegex.onclick = () => addAdvCondition('nameRegex');
if (advSearchAddClass) advSearchAddClass.onclick = () => addAdvCondition('class');
if (advSearchRunBtn) advSearchRunBtn.onclick = runAdvancedSearchQuery;
if (advSearchResetBtn) advSearchResetBtn.onclick = resetAdvancedSearchForm;
if (advSearchCancelBtn) advSearchCancelBtn.onclick = hideAdvancedSearchModal;
if (advSearchBannerClear) advSearchBannerClear.onclick = clearAdvancedFilter;

// Navigate prev/next within the current effective (filtered) list, in its order,
// wrapping around. Falls back to host-side full-list nav when no list is loaded.
function navigateRelative(direction) {
    const list = getEffectiveImageList();
    if (!list || list.length === 0) {
        // An active filter that matched nothing: stay put rather than escaping to the
        // full image set. Only fall back to host nav when no filter is in effect.
        if (advancedFilterActive || searchQuery) return;
        vscode.postMessage({ command: direction > 0 ? 'next' : 'prev' });
        return;
    }
    let idx = list.indexOf(currentImageRelativePathMutable);
    if (idx === -1) idx = direction > 0 ? -1 : 0; // current not in set: step to first/last
    let n = idx + direction;
    if (n < 0) n = list.length - 1;
    if (n >= list.length) n = 0;
    const target = list[n];
    if (!target) return;
    // Preserve scroll position like a list click does.
    const state = vscode.getState() || {};
    state.savedScrollTop = imageBrowserList ? imageBrowserList.scrollTop : 0;
    state.skipNextScroll = true;
    vscode.setState(state);
    vscode.postMessage({ command: 'navigateToImage', imagePath: target });
}

// Restore search state if available
if (vscodeState && vscodeState.searchQuery) {
    const savedQuery = vscodeState.searchQuery;
    if (searchInput && searchInputContainer) {
        searchInput.value = savedQuery;
        searchInputContainer.style.display = 'flex';
        // Show inline clear (×) since the restored value is non-empty
        if (searchCloseBtn && savedQuery.length > 0) {
            searchCloseBtn.classList.add('visible');
        }
        // Apply filter immediately (without saving state again initially)
        searchQuery = savedQuery.toLowerCase().trim();
        filteredImages = workspaceImages.filter(img =>
            img.toLowerCase().includes(searchQuery)
        );

        // Update count immediately
        updateImageCount();
    }
} else {
    // If no search query, ensure UI is reset (though it should be hidden by default in HTML)
    if (searchInput) searchInput.value = '';
    if (searchInputContainer) searchInputContainer.style.display = 'none';
}

// Restore advanced-filter state if available (mirrors the quick-search restore
// above). This is what keeps the advanced filter alive across a webview re-init.
if (vscodeState && vscodeState.advancedFilterActive) {
    if (Array.isArray(vscodeState.advConditions)) {
        advConditions = vscodeState.advConditions.map(c => ({
            id: ++advCondSeq,
            type: c.type,
            value: c.value || '',
            classes: Array.isArray(c.classes) ? c.classes.slice() : []
        }));
    }
    advancedFilterActive = true;
    advancedResults = Array.isArray(vscodeState.advancedResults) ? vscodeState.advancedResults.slice() : [];
    // Advanced filter takes over the list — suppress the quick search.
    searchQuery = '';
    filteredImages = [];
    if (searchInput) searchInput.value = '';
    if (searchInputContainer) searchInputContainer.style.display = 'none';
    if (searchCloseBtn) searchCloseBtn.classList.remove('visible');
    // Snapshot was too large to persist — re-derive from the saved conditions.
    if (vscodeState.advancedNeedsRerun) {
        const query = window.AdvancedSearchHelpers.buildQuery(advConditions);
        if (window.AdvancedSearchHelpers.hasActiveConditions(query)) {
            const requestId = ++advSearchRunSeq;
            vscode.postMessage({ command: 'advancedSearchRun', query, requestId });
        } else {
            advancedFilterActive = false; // nothing valid to re-run — drop the stale filter
        }
    }
    if (advancedFilterActive && advSearchBanner) {
        advSearchBanner.style.display = 'flex';
        if (advSearchBannerText) {
            advSearchBannerText.textContent = window.AdvancedSearchHelpers.formatBanner(
                advancedResults.length, tt('advSearch.bannerActive', { count: advancedResults.length })
            );
        }
    }
    updateImageCount();
}

function renderImageBrowserList() {
    if (!imageBrowserList || typeof workspaceImages === 'undefined') return;

    // Cancel pending hover timer before discarding rows (same rationale as
    // renderShapeList / renderLabelsList / updateVirtualScroll).
    if (window.tooltip) window.tooltip.hide();

    // Clear existing content
    imageBrowserList.innerHTML = '';

    // Use effective image list (filtered or full)
    const effectiveImages = getEffectiveImageList();

    // Show scanning state if list is empty, no search is active, and scan hasn't completed yet
    if (effectiveImages.length === 0 && !searchQuery && !scanComplete) {
        // Just update the count area — no extra UI elements needed
        const imageCountEl = document.getElementById('imageCount');
        if (imageCountEl) {
            imageCountEl.textContent = `(${tt('status.scanning')})`;
        }
        return;
    }

    // Create virtual scroll container structure
    // We need a container that maintains the full scroll height
    const totalHeight = effectiveImages.length * VIRTUAL_ITEM_HEIGHT;

    // Create a spacer element to maintain scroll height
    const spacer = document.createElement('div');
    spacer.className = 'virtual-scroll-spacer';
    spacer.style.height = `${totalHeight}px`;
    spacer.style.position = 'relative';
    imageBrowserList.appendChild(spacer);

    // Initial render
    updateVirtualScroll();

    // Scroll to active item on first render
    const currentState = vscode.getState() || {};
    if (currentState.skipNextScroll && currentState.savedScrollTop !== undefined) {
        imageBrowserList.scrollTop = currentState.savedScrollTop;
        currentState.skipNextScroll = false;
        currentState.savedScrollTop = undefined;
        vscode.setState(currentState);
    } else if (imageBrowserExpanded) {
        scrollToActiveItem();
    }
}

function updateVirtualScroll() {
    if (!imageBrowserList || typeof workspaceImages === 'undefined') return;

    const spacer = imageBrowserList.querySelector('.virtual-scroll-spacer');
    if (!spacer) return;

    // Use effective image list (filtered or full)
    const effectiveImages = getEffectiveImageList();

    const scrollTop = imageBrowserList.scrollTop;
    const viewportHeight = imageBrowserList.clientHeight;

    // Calculate visible range
    const startIndex = Math.max(0, Math.floor(scrollTop / VIRTUAL_ITEM_HEIGHT) - VIRTUAL_BUFFER_SIZE);
    const visibleCount = Math.ceil(viewportHeight / VIRTUAL_ITEM_HEIGHT);
    const endIndex = Math.min(effectiveImages.length, startIndex + visibleCount + VIRTUAL_BUFFER_SIZE * 2);

    // Check if we need to re-render (only if range changed significantly)
    if (startIndex === virtualScrollState.startIndex &&
        endIndex === virtualScrollState.endIndex) {
        return; // No need to update
    }

    virtualScrollState.startIndex = startIndex;
    virtualScrollState.endIndex = endIndex;
    virtualScrollState.scrollTop = scrollTop;

    // Hide any pending tooltip first: we're about to detach the row that
    // owns the queued hover timer, and show() on a detached node measures
    // a zero-rect and lands the tip at viewport (0, 0).
    if (window.tooltip) window.tooltip.hide();

    // Clear existing items (but keep spacer)
    const existingItems = spacer.querySelectorAll('.image-browser-item');
    existingItems.forEach(item => item.remove());

    // Create fragment for new items
    const fragment = document.createDocumentFragment();

    for (let i = startIndex; i < endIndex; i++) {
        const imagePath = effectiveImages[i];
        const li = document.createElement('li');
        li.className = 'image-browser-item';
        li.style.position = 'absolute';
        li.style.top = `${i * VIRTUAL_ITEM_HEIGHT}px`;
        li.style.left = '0';
        li.style.right = '0';
        li.style.height = `${VIRTUAL_ITEM_HEIGHT}px`;
        li.style.boxSizing = 'border-box';

        // Highlight current image (use mutable path for updates)
        if (imagePath === currentImageRelativePathMutable) {
            li.classList.add('active');
        }

        // Use relative path as display name. Path itself is the most useful
        // hover content when the row truncates, so route through the rich
        // tooltip via data-tip-text rather than a native title bubble.
        li.textContent = imagePath;
        li.setAttribute('data-tip-text', imagePath);

        // Store data attribute for click handling
        li.dataset.imagePath = imagePath;
        li.dataset.index = i;

        li.onclick = () => {
            // Save scroll position
            const state = vscode.getState() || {};
            state.savedScrollTop = imageBrowserList.scrollTop;
            state.skipNextScroll = true;
            vscode.setState(state);

            vscode.postMessage({
                command: 'navigateToImage',
                imagePath: imagePath
            });
        };

        fragment.appendChild(li);
    }

    spacer.appendChild(fragment);

    // Bind rich tooltips to the freshly-rendered virtual rows. attach() is
    // idempotent so it tolerates being called every scroll tick.
    if (window.tooltip && window.TIPS) window.tooltip.attach(spacer, window.TIPS);
}

// Scroll handler for virtual scrolling (throttled)
let virtualScrollRAF = null;
if (imageBrowserList) {
    imageBrowserList.addEventListener('scroll', () => {
        if (virtualScrollRAF) return;
        virtualScrollRAF = requestAnimationFrame(() => {
            updateVirtualScroll();
            virtualScrollRAF = null;
        });
    });
}

// Scroll to active item helper
function scrollToActiveItem() {
    if (!imageBrowserList || typeof workspaceImages === 'undefined') return;

    // Index within the EFFECTIVE (filtered) list — that is what the virtual list lays out.
    const currentIndex = getEffectiveImageList().indexOf(currentImageRelativePathMutable);
    if (currentIndex !== -1) {
        const targetScrollTop = currentIndex * VIRTUAL_ITEM_HEIGHT - imageBrowserList.clientHeight / 2 + VIRTUAL_ITEM_HEIGHT / 2;
        imageBrowserList.scrollTop = Math.max(0, targetScrollTop);
    }
}

// Image browser resizer logic
let isResizingImageBrowser = false;

if (imageBrowserResizer && imageBrowserSidebar) {
    imageBrowserResizer.addEventListener('mousedown', (e) => {
        isResizingImageBrowser = true;
        imageBrowserResizer.classList.add('resizing');
        imageBrowserSidebar.classList.add('resizing');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });
}

document.addEventListener('mousemove', (e) => {
    if (!isResizingImageBrowser) return;
    const newWidth = e.clientX;
    if (newWidth > 150 && newWidth < 500 && imageBrowserSidebar) {
        imageBrowserSidebar.style.width = newWidth + 'px';
    }
});

document.addEventListener('mouseup', () => {
    if (isResizingImageBrowser) {
        isResizingImageBrowser = false;
        if (imageBrowserResizer) {
            imageBrowserResizer.classList.remove('resizing');
        }
        if (imageBrowserSidebar) {
            imageBrowserSidebar.classList.remove('resizing');
            // Save left sidebar width
            const state = vscode.getState() || {};
            state.leftSidebarWidth = imageBrowserSidebar.offsetWidth;
            vscode.setState(state);
        }
        document.body.style.cursor = 'default';
        document.body.style.userSelect = '';
    }
});

// Initialize image browser list
renderImageBrowserList();

// Signal the extension that the webview is fully initialized and ready to receive messages.
// This is critical: postMessage from the extension can be lost if sent before
// the webview's JavaScript has finished loading and set up its message listener.
vscode.postMessage({ command: 'webviewReady' });

// Restore saved sidebar widths
(function restoreSidebarWidths() {
    const state = vscode.getState() || {};
    if (state.rightSidebarWidth && sidebar) {
        sidebar.style.width = state.rightSidebarWidth + 'px';
    }
    if (state.leftSidebarWidth && imageBrowserSidebar && !imageBrowserSidebar.classList.contains('collapsed')) {
        imageBrowserSidebar.style.width = state.leftSidebarWidth + 'px';
    }
})();
