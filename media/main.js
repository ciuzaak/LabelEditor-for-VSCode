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
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const resizer = document.getElementById('resizer');
const sidebar = document.getElementById('sidebar');

let img = new Image();
let shapes = [];
let currentPoints = [];
let isDrawing = false;
let scale = 1;
let selectedShapeIndex = -1;
let recentLabels = ["object", "person", "car", "background"];

// Zoom & Pan variables
let zoomLevel = 1;
let panX = 0;
let panY = 0;
let isPanning = false;
let startPanX = 0;
let startPanY = 0;

// Load initial data if available
if (existingData) {
    shapes = existingData.shapes || [];
}

img.onload = () => {
    resizeCanvas();
    fitImageToScreen();
    renderShapeList();
    draw();
};

img.onerror = () => {
    statusSpan.textContent = "Error loading image";
    statusSpan.style.color = "red";
};

img.src = imageUrl;

function resizeCanvas() {
    const container = document.querySelector('.canvas-container');
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    draw();
}

function fitImageToScreen() {
    const container = document.querySelector('.canvas-container');
    const w = container.clientWidth;
    const h = container.clientHeight;

    if (w === 0 || h === 0 || img.width === 0 || img.height === 0) return;

    const scaleX = w / img.width;
    const scaleY = h / img.height;

    zoomLevel = Math.min(scaleX, scaleY) * 0.9; // 90% fit

    // Center it
    const scaledW = img.width * zoomLevel;
    const scaledH = img.height * zoomLevel;

    panX = (w - scaledW) / 2;
    panY = (h - scaledH) / 2;
}

window.addEventListener('resize', resizeCanvas);

// Navigation
prevBtn.addEventListener('click', () => {
    vscode.postMessage({ command: 'prev' });
});

nextBtn.addEventListener('click', () => {
    vscode.postMessage({ command: 'next' });
});

// Color Generation
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
    // Convert hex to rgba
    const r = parseInt(baseColor.slice(1, 3), 16);
    const g = parseInt(baseColor.slice(3, 5), 16);
    const b = parseInt(baseColor.slice(5, 7), 16);

    return {
        stroke: `rgba(${r}, ${g}, ${b}, 1)`,
        fill: `rgba(${r}, ${g}, ${b}, 0.3)`
    };
}

// Canvas Interaction
canvas.addEventListener('mousedown', (e) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) { // Middle click or Alt+Left click for Pan
        isPanning = true;
        startPanX = e.clientX - panX;
        startPanY = e.clientY - panY;
        canvas.style.cursor = 'grabbing';
        return;
    }

    if (e.button === 0) { // Left click
        const rect = canvas.getBoundingClientRect();
        // Transform mouse coordinates to image coordinates
        const x = (e.clientX - rect.left - panX) / zoomLevel;
        const y = (e.clientY - rect.top - panY) / zoomLevel;

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
    if (isPanning) {
        panX = e.clientX - startPanX;
        panY = e.clientY - startPanY;
        draw();
        return;
    }

    if (isDrawing) {
        draw(e);
    } else {
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left - panX) / zoomLevel;
        const y = (e.clientY - rect.top - panY) / zoomLevel;

        const hoveredIndex = findShapeIndexAt(x, y);
        if (hoveredIndex !== -1) {
            canvas.style.cursor = 'pointer';
        } else {
            canvas.style.cursor = e.altKey ? 'grab' : 'crosshair';
        }
    }
});

canvas.addEventListener('mouseup', () => {
    if (isPanning) {
        isPanning = false;
        canvas.style.cursor = 'grab';
    }
});

canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomIntensity = 0.1;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Get mouse pos in image coords before zoom
    const imageX = (mouseX - panX) / zoomLevel;
    const imageY = (mouseY - panY) / zoomLevel;

    if (e.deltaY < 0) {
        zoomLevel += zoomIntensity;
    } else {
        zoomLevel -= zoomIntensity;
        if (zoomLevel < 0.1) zoomLevel = 0.1;
    }

    // Adjust pan so mouse stays on same image point
    panX = mouseX - imageX * zoomLevel;
    panY = mouseY - imageY * zoomLevel;

    draw();
});

// Resizer Logic
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
        resizeCanvas();
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

// Modal Logic
function showLabelModal() {
    labelModal.style.display = 'flex';
    labelInput.value = '';
    labelInput.focus();
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

    shapes.push({
        label: label,
        points: currentPoints,
        group_id: null,
        shape_type: "polygon",
        flags: {}
    });

    currentPoints = [];
    hideLabelModal();
    renderShapeList();
    draw();
    save();
}

modalOkBtn.onclick = confirmLabel;
modalCancelBtn.onclick = () => {
    hideLabelModal();
    currentPoints = [];
    draw();
};

labelInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmLabel();
    if (e.key === 'Escape') {
        hideLabelModal();
        currentPoints = [];
        draw();
    }
});

// Sidebar Logic
function renderShapeList() {
    shapeList.innerHTML = '';
    shapes.forEach((shape, index) => {
        const li = document.createElement('li');
        li.textContent = shape.label;

        // Color indicator
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

        const delBtn = document.createElement('span');
        delBtn.className = 'delete-btn';
        delBtn.textContent = '×';
        delBtn.onclick = (e) => {
            e.stopPropagation();
            deleteShape(index);
        };

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
    renderShapeList();
    draw();
    save();
}

// Drawing Logic
function draw(mouseEvent) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoomLevel, zoomLevel);

    // Draw image
    ctx.drawImage(img, 0, 0);

    // Draw existing shapes
    shapes.forEach((shape, index) => {
        const isSelected = index === selectedShapeIndex;
        const colors = getColorsForLabel(shape.label);

        let strokeColor = colors.stroke;
        let fillColor = colors.fill;

        if (isSelected) {
            strokeColor = 'rgba(255, 255, 0, 1)';
            fillColor = 'rgba(255, 255, 0, 0.4)';
        }

        drawPolygon(shape.points, strokeColor, fillColor);
    });

    // Draw current polygon
    if (isDrawing) {
        drawPolygon(currentPoints, 'rgba(255, 0, 0, 0.8)', 'rgba(255, 0, 0, 0.1)');

        // Draw line to mouse cursor
        if (mouseEvent) {
            const rect = canvas.getBoundingClientRect();
            // Need to inverse transform mouse coords
            const mx = (mouseEvent.clientX - rect.left - panX) / zoomLevel;
            const my = (mouseEvent.clientY - rect.top - panY) / zoomLevel;
            const lastPoint = currentPoints[currentPoints.length - 1];

            ctx.beginPath();
            ctx.moveTo(lastPoint[0], lastPoint[1]);
            ctx.lineTo(mx, my);
            ctx.strokeStyle = 'red';
            ctx.lineWidth = 2 / zoomLevel; // Keep line width constant on screen
            ctx.stroke();
        }
    }

    ctx.restore();
}

function drawPolygon(points, strokeColor, fillColor) {
    if (points.length === 0) return;

    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i][0], points[i][1]);
    }
    if (!isDrawing || points !== currentPoints) {
        ctx.closePath();
    }

    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2 / zoomLevel; // Keep line width constant on screen
    ctx.stroke();

    if (!isDrawing || points !== currentPoints) {
        ctx.fillStyle = fillColor;
        ctx.fill();
    }

    // Draw vertices
    ctx.fillStyle = strokeColor;
    const pointRadius = 3 / zoomLevel; // Keep point size constant
    points.forEach(p => {
        ctx.beginPath();
        ctx.arc(p[0], p[1], pointRadius, 0, 2 * Math.PI);
        ctx.fill();
    });
}

function save() {
    vscode.postMessage({
        command: 'save',
        data: {
            shapes: shapes,
            imageHeight: img.height,
            imageWidth: img.width
        }
    });
}

if (saveBtn) {
    saveBtn.addEventListener('click', save);
}
