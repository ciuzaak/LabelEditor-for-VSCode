// LabelEditor webview — Image browser sidebar: list, virtual scrolling, filename search.
// Part of the editor bundle: build/bundle-webview.js concatenates media/editor/*.js,
// in the order listed there, into one classic script (shared scope, hoisting).

// --- Image Browser Sidebar ---

// Sidebar state variable
let imageBrowserExpanded = false;

// Restore sidebar state from vscode state
if (vscodeState && vscodeState.imageBrowserExpanded !== undefined) {
    imageBrowserExpanded = vscodeState.imageBrowserExpanded;
    if (imageBrowserExpanded && imageBrowserSidebar) {
        imageBrowserSidebar.classList.remove('collapsed');
    }
}

// Toggle image browser sidebar
if (imageBrowserToggleBtn && imageBrowserSidebar) {
    imageBrowserToggleBtn.onclick = () => {
        imageBrowserExpanded = !imageBrowserExpanded;
        const state = vscode.getState() || {};
        if (imageBrowserExpanded) {
            imageBrowserSidebar.classList.remove('collapsed');
            // Restore saved width if available
            if (state.leftSidebarWidth) {
                imageBrowserSidebar.style.width = state.leftSidebarWidth + 'px';
            }
        } else {
            imageBrowserSidebar.classList.add('collapsed');
            // Clear inline width to ensure CSS collapsed class takes effect
            imageBrowserSidebar.style.width = '';
        }
        // Save state
        state.imageBrowserExpanded = imageBrowserExpanded;
        vscode.setState(state);
    };
}

// Refresh Images button
if (refreshImagesBtn) {
    refreshImagesBtn.onclick = () => {
        vscode.postMessage({ command: 'refreshImages' });
    };
}

// Search Images button - toggle search input visibility
if (searchImagesBtn && searchInputContainer && searchInput) {
    searchImagesBtn.onclick = () => {
        if (searchInputContainer.style.display === 'none') {
            searchInputContainer.style.display = 'flex';
            searchInput.focus();
        } else {
            // Hide and clear search
            searchInputContainer.style.display = 'none';
            searchInput.value = '';
            if (searchCloseBtn) searchCloseBtn.classList.remove('visible');
            filterImages('');
        }
    };
}

// Search input - filter images on input
let searchDebounceTimer = null;
if (searchInput) {
    searchInput.oninput = () => {
        // Toggle inline clear button visibility
        if (searchCloseBtn) {
            searchCloseBtn.classList.toggle('visible', searchInput.value.length > 0);
        }
        // Debounce input to avoid excessive filtering
        if (searchDebounceTimer) {
            clearTimeout(searchDebounceTimer);
        }
        searchDebounceTimer = setTimeout(() => {
            filterImages(searchInput.value);
        }, 150);
    };

    // Also handle Enter key to immediately apply filter
    searchInput.onkeydown = (e) => {
        if (e.key === 'Escape') {
            // Hide search on Escape
            searchInputContainer.style.display = 'none';
            searchInput.value = '';
            if (searchCloseBtn) searchCloseBtn.classList.remove('visible');
            filterImages('');
        }
    };
}

// Inline clear button — clears text but keeps the search field open (macOS pattern)
if (searchCloseBtn && searchInputContainer && searchInput) {
    searchCloseBtn.onclick = () => {
        searchInput.value = '';
        searchCloseBtn.classList.remove('visible');
        filterImages('');
        searchInput.focus();
    };
}

// Render image browser list with virtual scrolling
// Virtual scrolling constants
const VIRTUAL_ITEM_HEIGHT = 24; // Approximate height of each item in pixels
const VIRTUAL_BUFFER_SIZE = 10; // Extra items to render above/below viewport

// Virtual scrolling state
let virtualScrollState = {
    startIndex: 0,
    endIndex: 0,
    scrollTop: 0
};

// Search state
let searchQuery = '';
let filteredImages = []; // Filtered image list when search is active

// Advanced search state
let advancedFilterActive = false;
let advancedResults = [];          // ranked relative paths
let advSearchClassData = [];       // [{name, count}] from the extension (lazy)
let advClassUniverseLoaded = false;
let advIndexing = false;           // true while the class index is being built
let advConditions = [];            // [{ id, type, value, classes:[] }]
let advCondSeq = 0;
let advSearchRunSeq = 0;           // monotonic id to drop stale/out-of-order run responses
let advPrepareSeq = 0;             // monotonic id to drop stale class-universe (prepare) responses

// Custom class combobox (one shared body-anchored listbox, bound to the active input)
let advClassComboEl = null;        // the <div> listbox, created lazily, appended to <body>
let advClassComboInput = null;     // the class <input> the listbox is currently bound to
let advClassComboCond = null;      // the condition object backing the active input
let advClassComboActiveIndex = -1; // keyboard-highlighted option (-1 = none)

function tt(key, params) {
    return (window.i18n && window.i18n.t) ? window.i18n.t(key, params) : key;
}

// Get the effective image list (filtered or full)
function getEffectiveImageList() {
    if (advancedFilterActive) {
        return advancedResults;
    }
    if (searchQuery && filteredImages.length >= 0) {
        return filteredImages;
    }
    return typeof workspaceImages !== 'undefined' ? workspaceImages : [];
}

// Update image count display with current position: (current/total) or (current/filtered/total)
function updateImageCount() {
    const imageCountEl = document.getElementById('imageCount');
    if (!imageCountEl) return;

    const effectiveImages = getEffectiveImageList();
    const total = typeof workspaceImages !== 'undefined' ? workspaceImages.length : 0;
    const currentIndex = effectiveImages.indexOf(currentImageRelativePathMutable);

    const filteredMode = advancedFilterActive || !!searchQuery;
    if (currentIndex === -1) {
        // Position unknown — show count only
        imageCountEl.textContent = filteredMode
            ? `(${effectiveImages.length}/${total})`
            : `(${total})`;
    } else {
        const currentPos = currentIndex + 1;
        imageCountEl.textContent = filteredMode
            ? `(${currentPos}/${effectiveImages.length}/${total})`
            : `(${currentPos}/${total})`;
    }
}

// Filter images based on search query
function filterImages(query) {
    searchQuery = query.toLowerCase().trim();
    if (!searchQuery) {
        filteredImages = [];
    } else {
        filteredImages = workspaceImages.filter(img =>
            img.toLowerCase().includes(searchQuery)
        );
    }

    // Save search state
    const state = vscode.getState() || {};
    state.searchQuery = searchQuery;
    vscode.setState(state);

    // Update image count display
    updateImageCount();
    // Reset virtual scroll state and re-render
    virtualScrollState = {
        startIndex: -1,
        endIndex: -1,
        scrollTop: 0
    };
    renderImageBrowserList();
}
