const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const saveBtn = document.getElementById('saveBtn');
const statusSpan = document.getElementById('status');
const shapeList = document.getElementById('shapeList');
const labelModal = document.getElementById('labelModal');
const labelInput = document.getElementById('labelInput');
const modalOkBtn = document.getElementById('modalOkBtn');
const modalCancelBtn = document.getElementById('modalCancelBtn');
const recentLabelsDiv = document.getElementById('recentLabels');
const resizer = document.getElementById('resizer');
const sidebar = document.getElementById('sidebar');

let img = new Image();
let shapes = [];
let currentPoints = [];
let isDrawing = false;
let scale = 1;
let selectedShapeIndex = -1;
let editingShapeIndex = -1;
let recentLabels = ["object", "person", "car", "background"];

// Dirty State
let isDirty = false;

// Zoom & Pan variables
let zoomLevel = 1;

// Load initial data if available
if (existingData) {
    shapes = existingData.shapes || [];
    markClean();
}

img.onload = () => {
    fitImageToScreen();
    draw();
    renderShapeList();
};

img.onerror = () => {
    statusSpan.textContent = "Error loading image";
    statusSpan.style.color = "red";
};

img.src = imageUrl;

// --- Dirty State Management ---

function markDirty() {
    if (!isDirty) {
        isDirty = true;
        vscode.postMessage({ command: 'dirty', value: true });
    }
    if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.classList.add('dirty');
        saveBtn.textContent = 'Save (Ctrl+S) *';
    }
}

function markClean() {
    if (isDirty) {
        isDirty = false;
        vscode.postMessage({ command: 'dirty', value: false });
    }
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.classList.remove('dirty');
        saveBtn.textContent = 'Save (Ctrl+S)';
    }
}

// --- Zoom & Scroll ---

function fitImageToScreen() {
    const container = document.querySelector('.canvas-container');
    const w = container.clientWidth;
    const h = container.clientHeight;

    if (w === 0 || h === 0 || img.width === 0 || img.height === 0) return;

    const scaleX = w / img.width;
    const scaleY = h / img.height;

    zoomLevel = Math.min(scaleX, scaleY) * 0.9; // 90% fit

    updateCanvasSize();
}

function updateCanvasSize() {
    canvas.width = img.width * zoomLevel;
    canvas.height = img.height * zoomLevel;
    draw();
}

window.addEventListener('resize', () => {
    // Optional: re-fit on resize? Or just keep zoom?
});

window.addEventListener('message', event => {
    const message = event.data;
    switch (message.command) {
        case 'requestSave':
            save();
            break;
    }
});

// --- Shortcuts ---

document.addEventListener('keydown', (e) => {
    // Ignore shortcuts if modal is open (except Enter/Esc handled in input)
    if (labelModal.style.display === 'flex') return;

    // Ctrl+S: Save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        save();
    }

    // A: Prev Image
    if (e.key === 'a' || e.key === 'A') {
        vscode.postMessage({ command: 'prev' });
    }

    // D: Next Image
    if (e.key === 'd' || e.key === 'D') {
        vscode.postMessage({ command: 'next' });
    }

    // Delete/Backspace: Delete selected shape
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedShapeIndex !== -1) {
        deleteShape(selectedShapeIndex);
    }

    // ESC: Cancel drawing
    if (e.key === 'Escape') {
        if (isDrawing) {
            isDrawing = false;
            currentPoints = [];
            draw();
        }
    }
});


// --- Color Generation ---
function stringToColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
    return '#' + "00000".substring(0, 6 - c.length) + c;
}

function getColorsForLabel(label) {
    const baseColor = stringToColor(label);
    const r = parseInt(baseColor.slice(1, 3), 16);
    const g = parseInt(baseColor.slice(3, 5), 16);
    const b = parseInt(baseColor.slice(5, 7), 16);
    return {
        stroke: `rgba(${r}, ${g}, ${b}, 1)`,
        fill: `rgba(${r}, ${g}, ${b}, 0.3)`
    };
}

// --- Canvas Interaction ---

canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) { // Left click
        const rect = canvas.getBoundingClientRect();
        // Mouse pos relative to canvas
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        // Convert to image coordinates
        const x = mx / zoomLevel;
        const y = my / zoomLevel;

        if (!isDrawing) {
            const clickedShapeIndex = findShapeIndexAt(x, y);
            if (clickedShapeIndex !== -1) {
                selectedShapeIndex = clickedShapeIndex;
                renderShapeList();
                draw();
                return;
            } else {
                selectedShapeIndex = -1;
                renderShapeList();
            }

            isDrawing = true;
            currentPoints = [[x, y]];
        } else {
            const firstPoint = currentPoints[0];
            const dx = x - firstPoint[0];
            const dy = y - firstPoint[1];

            // Check close distance (scaled)
            if (currentPoints.length > 2 && (dx * dx + dy * dy) < (100 / (zoomLevel * zoomLevel))) {
                finishPolygon();
            } else {
                currentPoints.push([x, y]);
            }
        }
        draw();
    } else if (e.button === 2) { // Right click
        if (isDrawing) {
            if (currentPoints.length > 0) {
                currentPoints.pop();
                if (currentPoints.length === 0) {
                    isDrawing = false;
                }
                draw();
            }
        }
    }
});

canvas.addEventListener('mousemove', (e) => {
    if (isDrawing) {
        draw(e);
    } else {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const x = mx / zoomLevel;
        const y = my / zoomLevel;

        const hoveredIndex = findShapeIndexAt(x, y);
        if (hoveredIndex !== -1) {
            canvas.style.cursor = 'pointer';
        } else {
            canvas.style.cursor = 'crosshair';
        }
    }
});

canvas.addEventListener('wheel', (e) => {
    if (e.ctrlKey) { // Zoom on Ctrl+Wheel
        e.preventDefault();
        const container = document.querySelector('.canvas-container');
        const zoomIntensity = 0.1;

        // Get mouse position relative to container
        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Get scroll position
        const scrollLeft = container.scrollLeft;
        const scrollTop = container.scrollTop;

        // Calculate mouse position in image coordinates before zoom
        const imageX = (scrollLeft + mouseX) / zoomLevel;
        const imageY = (scrollTop + mouseY) / zoomLevel;

        // Apply zoom
        if (e.deltaY < 0) {
            zoomLevel += zoomIntensity;
        } else {
            zoomLevel -= zoomIntensity;
            if (zoomLevel < 0.1) zoomLevel = 0.1;
        }

        // Update canvas size
        updateCanvasSize();

        // Calculate new scroll position to keep the same image point under the mouse
        const newScrollLeft = imageX * zoomLevel - mouseX;
        const newScrollTop = imageY * zoomLevel - mouseY;

        // Apply new scroll position
        container.scrollLeft = newScrollLeft;
        container.scrollTop = newScrollTop;
    }
});

// --- Resizer Logic ---
let isResizing = false;

if (resizer) {
    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        resizer.classList.add('resizing');
        document.body.style.cursor = 'col-resize';
    });
}

document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const containerWidth = document.body.clientWidth;
    const newSidebarWidth = containerWidth - e.clientX;
    if (newSidebarWidth > 150 && newSidebarWidth < 600) {
        sidebar.style.width = newSidebarWidth + 'px';
    }
});

document.addEventListener('mouseup', () => {
    if (isResizing) {
        isResizing = false;
        resizer.classList.remove('resizing');
        document.body.style.cursor = 'default';
    }
});


function findShapeIndexAt(x, y) {
    for (let i = shapes.length - 1; i >= 0; i--) {
        if (isPointInPolygon([x, y], shapes[i].points)) {
            return i;
        }
    }
    return -1;
}

function isPointInPolygon(point, vs) {
    var x = point[0], y = point[1];
    var inside = false;
    for (var i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        var xi = vs[i][0], yi = vs[i][1];
        var xj = vs[j][0], yj = vs[j][1];

        var intersect = ((yi > y) != (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function finishPolygon() {
    isDrawing = false;
    showLabelModal();
}

// --- Modal Logic ---

function showLabelModal(editIndex = -1) {
    editingShapeIndex = editIndex;
    labelModal.style.display = 'flex';

    if (editIndex !== -1) {
        labelInput.value = shapes[editIndex].label;
    } else {
        labelInput.value = '';
    }

    labelInput.focus();
    labelInput.select();
    renderRecentLabels();
}

function hideLabelModal() {
    labelModal.style.display = 'none';
}

function renderRecentLabels() {
    recentLabelsDiv.innerHTML = '';
    recentLabels.forEach(label => {
        const chip = document.createElement('div');
        chip.className = 'label-chip';
        chip.textContent = label;
        chip.onclick = () => {
            labelInput.value = label;
            confirmLabel();
        };
        recentLabelsDiv.appendChild(chip);
    });
}

function confirmLabel() {
    const label = labelInput.value.trim();
    if (!label) return;

    if (!recentLabels.includes(label)) {
        recentLabels.unshift(label);
        if (recentLabels.length > 10) recentLabels.pop();
    }

    if (editingShapeIndex !== -1) {
        // Editing existing shape
        shapes[editingShapeIndex].label = label;
        editingShapeIndex = -1;
    } else {
        // Creating new shape
        shapes.push({
            label: label,
            points: currentPoints,
            group_id: null,
            shape_type: "polygon",
            flags: {},
            visible: true
        });
        currentPoints = [];
    }

    hideLabelModal();
    markDirty();
    renderShapeList();
    draw();
}

modalOkBtn.onclick = confirmLabel;
modalCancelBtn.onclick = () => {
    hideLabelModal();
    editingShapeIndex = -1;
    currentPoints = [];
    draw();
};

labelInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmLabel();
    if (e.key === 'Escape') {
        hideLabelModal();
        editingShapeIndex = -1;
        currentPoints = [];
        draw();
    }
});

// --- Sidebar Logic ---
function renderShapeList() {
    shapeList.innerHTML = '';
    shapes.forEach((shape, index) => {
        const li = document.createElement('li');
        li.textContent = shape.label;

        const colors = getColorsForLabel(shape.label);
        li.style.borderLeftColor = colors.stroke;

        if (index === selectedShapeIndex) {
            li.classList.add('active');
        }

        li.onclick = () => {
            selectedShapeIndex = index;
            renderShapeList();
            draw();
        };

        const visibleBtn = document.createElement('span');
        visibleBtn.className = 'visible-btn';
        visibleBtn.innerHTML = shape.visible === false ? '&#128065;' : '&#128065;'; // Eye icon
        if (shape.visible === false) {
            visibleBtn.classList.add('hidden-shape');
            visibleBtn.style.opacity = '0.5';
        }
        visibleBtn.onclick = (e) => {
            e.stopPropagation();
            shape.visible = shape.visible === undefined ? false : !shape.visible;
            renderShapeList();
            draw();
        };

        const editBtn = document.createElement('span');
        editBtn.className = 'edit-btn';
        editBtn.innerHTML = '&#9998;'; // Pencil icon
        editBtn.onclick = (e) => {
            e.stopPropagation();
            showLabelModal(index);
        };

        const delBtn = document.createElement('span');
        delBtn.className = 'delete-btn';
        delBtn.textContent = '×';
        delBtn.onclick = (e) => {
            e.stopPropagation();
            deleteShape(index);
        };

        li.appendChild(visibleBtn);
        li.appendChild(editBtn);
        li.appendChild(delBtn);
        shapeList.appendChild(li);
    });
}

function deleteShape(index) {
    shapes.splice(index, 1);
    if (selectedShapeIndex === index) {
        selectedShapeIndex = -1;
    } else if (selectedShapeIndex > index) {
        selectedShapeIndex--;
    }
    markDirty();
    renderShapeList();
    draw();
}

// --- Drawing Logic ---
function draw(mouseEvent) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw image scaled
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // Draw existing shapes
    shapes.forEach((shape, index) => {
        if (shape.visible === false) return; // Skip hidden shapes

        const isSelected = index === selectedShapeIndex;
        const colors = getColorsForLabel(shape.label);

        let strokeColor = colors.stroke;
        let fillColor = colors.fill;

        if (isSelected) {
            strokeColor = 'rgba(255, 255, 0, 1)';
            fillColor = 'rgba(255, 255, 0, 0.4)';
        }

        drawPolygon(shape.points, strokeColor, fillColor, false);
    });

    // Draw current polygon
    if (isDrawing) {
        drawPolygon(currentPoints, 'rgba(255, 0, 0, 0.8)', 'rgba(255, 0, 0, 0.1)', true);

        // Draw line to mouse cursor
        if (mouseEvent) {
            const rect = canvas.getBoundingClientRect();
            const mx = (mouseEvent.clientX - rect.left);
            const my = (mouseEvent.clientY - rect.top);
            const lastPoint = currentPoints[currentPoints.length - 1];

            ctx.beginPath();
            ctx.moveTo(lastPoint[0] * zoomLevel, lastPoint[1] * zoomLevel);
            ctx.lineTo(mx, my);
            ctx.strokeStyle = 'red';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }
}

function drawPolygon(points, strokeColor, fillColor, showVertices = false) {
    if (points.length === 0) return;

    ctx.beginPath();
    ctx.moveTo(points[0][0] * zoomLevel, points[0][1] * zoomLevel);
    for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i][0] * zoomLevel, points[i][1] * zoomLevel);
    }
    if (!isDrawing || points !== currentPoints) {
        ctx.closePath();
    }

    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    if (!isDrawing || points !== currentPoints) {
        ctx.fillStyle = fillColor;
        ctx.fill();
    }

    // Draw vertices only if requested (for current drawing)
    if (showVertices) {
        ctx.fillStyle = strokeColor;
        const pointRadius = 3;
        points.forEach(p => {
            ctx.beginPath();
            ctx.arc(p[0] * zoomLevel, p[1] * zoomLevel, pointRadius, 0, 2 * Math.PI);
            ctx.fill();
        });
    }
}

function save() {
    if (!isDirty) return;

    vscode.postMessage({
        command: 'save',
        data: {
            shapes: shapes,
            imageHeight: img.height,
            imageWidth: img.width
        }
    });
    markClean();
}

if (saveBtn) {
    saveBtn.addEventListener('click', save);
}
