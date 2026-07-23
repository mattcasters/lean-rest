const API_BASE = '/lean/api/';
let canvas;
let gc;
let rect;
let image;
let lookupResults = [];
let scale;
let zoom = 1.0;
let numberOfPages;
let offset = {
    "x": 0,
    "y": 0
}

/**
 * Copy-friendly error UI (browser alert() truncates and cannot select/copy easily).
 * @param {string} title short heading
 * @param {string|*} detail full message / stack / response body
 */
function showErrorDialog(title, detail) {
    let text = "";
    if (detail === null || detail === undefined) {
        text = "";
    } else if (typeof detail === "string") {
        text = detail;
    } else if (detail instanceof Error) {
        text = detail.stack || detail.message || String(detail);
    } else {
        try {
            text = JSON.stringify(detail, null, 2);
        } catch (e) {
            text = String(detail);
        }
    }
    let existing = document.getElementById("leanErrorDialog");
    if (existing) {
        existing.remove();
    }
    let overlay = document.createElement("div");
    overlay.id = "leanErrorDialog";
    overlay.className = "lean-error-overlay";
    overlay.innerHTML =
        '<div class="lean-error-dialog" role="dialog" aria-modal="true">'
        + '<div class="lean-error-title"></div>'
        + '<textarea class="lean-error-body" readonly rows="14" spellcheck="false"></textarea>'
        + '<div class="lean-error-actions">'
        + '<button type="button" class="lean-error-copy">Copy</button>'
        + '<button type="button" class="lean-error-close">Close</button>'
        + "</div></div>";
    overlay.querySelector(".lean-error-title").textContent = title || "Error";
    let ta = overlay.querySelector(".lean-error-body");
    ta.value = text;
    function close() {
        overlay.remove();
        document.removeEventListener("keydown", onKey);
    }
    function onKey(e) {
        if (e.key === "Escape") {
            close();
        }
    }
    overlay.querySelector(".lean-error-close").onclick = close;
    overlay.querySelector(".lean-error-copy").onclick = function () {
        ta.select();
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(ta.value);
            } else {
                document.execCommand("copy");
            }
            this.textContent = "Copied";
            let btn = this;
            setTimeout(function () {
                btn.textContent = "Copy";
            }, 1500);
        } catch (e) {
            // leave selection so user can Ctrl+C
        }
    };
    overlay.addEventListener("click", function (e) {
        if (e.target === overlay) {
            close();
        }
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    setTimeout(function () {
        ta.focus();
        ta.select();
    }, 0);
}

/** Prefer showErrorDialog; fall back to alert. */
function showAjaxError(title, xhr, status, error) {
    let body = "";
    if (xhr) {
        if (xhr.responseText) {
            body = xhr.responseText;
        } else if (xhr.status) {
            body = "HTTP " + xhr.status + (xhr.statusText ? " " + xhr.statusText : "");
        }
    }
    if (status) {
        body = (body ? body + "\n\n" : "") + "status: " + status;
    }
    if (error) {
        body = (body ? body + "\n" : "") + "error: " + error;
    }
    if (!body) {
        body = "(no details)";
    }
    showErrorDialog(title || "Request failed", body);
}
/** jQuery side panel (present in edit mode; empty collection in view). */
const sidePanel = $('#editSidePanel');
/** 'view' | 'edit' — set by page template before this script loads. */
function isEditMode() {
    return typeof leanMode !== "undefined" && leanMode === "edit";
}
function isViewMode() {
    return !isEditMode();
}

/**
 * Open/close the property (or connector) side panel.
 * In edit mode, collapses the left component rail so it cannot cover Apply/Close or form fields.
 */
function setSidePanelOpen(open, options) {
    options = options || {};
    if (!sidePanel || !sidePanel.length) {
        return;
    }
    if (open) {
        if (isEditMode()) {
            document.body.classList.add("property-panel-open");
            // Form (wide) + optional preview column on the far right
            let withPreview = options.withPreview === true;
            let connectorStudio = options.connectorStudio === true;
            let max = withPreview ? 1200 : (connectorStudio ? 1000 : 640);
            let frac = withPreview ? 0.96 : (connectorStudio ? 0.75 : 0.58);
            let w = Math.min(max, Math.floor(window.innerWidth * frac));
            sidePanel.width(w);
            setPropertyPreviewVisible(!!options.withPreview && !!options.componentName);
            if (options.withPreview && options.componentName) {
                loadComponentPreview(options.componentName, options.geometry || null);
            }
        } else {
            sidePanel.width("95%");
            setPropertyPreviewVisible(false);
        }
    } else {
        document.body.classList.remove("property-panel-open");
        sidePanel.width(0);
        setPropertyPreviewVisible(false);
        clearComponentPreview();
    }
}

function setPropertyPreviewVisible(visible) {
    let col = document.getElementById("propertyPreviewColumn");
    if (!col) {
        return;
    }
    if (visible) {
        col.removeAttribute("hidden");
    } else {
        col.setAttribute("hidden", "hidden");
    }
}

function clearComponentPreview() {
    let img = document.getElementById("componentPreviewImg");
    let empty = document.getElementById("componentPreviewEmpty");
    let meta = document.getElementById("componentPreviewMeta");
    if (img) {
        img.removeAttribute("src");
        img.classList.remove("is-visible");
    }
    if (empty) {
        empty.style.display = "";
        empty.textContent = "No preview";
    }
    if (meta) {
        meta.textContent = "";
    }
    if (typeof clearComponentErrorPanel === "function") {
        clearComponentErrorPanel();
    }
}

/**
 * Load an isolated SVG preview of a component into the property panel.
 * Uses geometry from the page when available so proportions match the presentation.
 */
function loadComponentPreview(componentName, geometry) {
    let img = document.getElementById("componentPreviewImg");
    let empty = document.getElementById("componentPreviewEmpty");
    let meta = document.getElementById("componentPreviewMeta");
    if (!img || typeof presentationName === "undefined") {
        return;
    }
    setPropertyPreviewVisible(true);
    if (empty) {
        empty.style.display = "";
        empty.textContent = "Rendering preview...";
    }
    img.classList.remove("is-visible");

    let w = 0;
    let h = 0;
    if (geometry && geometry.width > 0 && geometry.height > 0) {
        w = Math.round(geometry.width);
        h = Math.round(geometry.height);
    } else if (typeof window.leanEdit !== "undefined"
        && typeof window.leanEdit.getGeometries === "function") {
        let geos = window.leanEdit.getGeometries() || [];
        for (let i = 0; i < geos.length; i++) {
            if (geos[i].componentName === componentName && geos[i].geometry) {
                w = Math.round(geos[i].geometry.width);
                h = Math.round(geos[i].geometry.height);
                break;
            }
        }
    }
    if (w <= 0) {
        w = 320;
    }
    if (h <= 0) {
        h = 200;
    }

    let url = API_BASE + "edit/presentation/" + encodeURIComponent(presentationName)
        + "/components/" + encodeURIComponent(componentName)
        + "/preview.svg?width=" + encodeURIComponent(w)
        + "&height=" + encodeURIComponent(h)
        + "&_=" + Date.now();

    img.onload = function () {
        img.classList.add("is-visible");
        if (empty) {
            empty.style.display = "none";
        }
        if (meta) {
            meta.textContent = componentName + " | " + w + "x" + h + " px (page size)";
        }
    };
    img.onerror = function () {
        img.classList.remove("is-visible");
        if (empty) {
            empty.style.display = "";
            empty.textContent = "Preview failed to render.";
        }
        if (meta) {
            meta.textContent = componentName;
        }
    };
    img.src = url;
}

let componentJson = {};
let presentationJson = {};
/** Active connector metadata while editing in the side panel. */
let connectorJson = null;
let connectorPluginId = null;
let oldConnectorName = null;
/**
 * 0-based index into LeanPresentation.pages for the component being edited.
 * Set when opening the editor from getComponent (or fallback from render page).
 */
let editLogicalPageNumber = 0;
/** "page" | "header" | "footer" — where the component lives on the presentation. */
let editPageRole = "page";

let componentNames = null;
let connectorNames = null;
let themeNames = null;
// Content cell alignment (LeanHorizontalAlignment / LeanVerticalAlignment)
const HORIZONTAL_ALIGNMENTS = ["LEFT", "RIGHT", "CENTER"];
const VERTICAL_ALIGNMENTS = ["TOP", "BOTTOM", "MIDDLE"];
// Layout attachment alignment (LeanAttachment.Alignment) — uses CENTER, not MIDDLE
const LAYOUT_HORIZONTAL_ALIGNMENTS = ["DEFAULT", "LEFT", "RIGHT", "CENTER"];
const LAYOUT_VERTICAL_ALIGNMENTS = ["DEFAULT", "TOP", "BOTTOM", "CENTER"];
const AGGREGATION_METHODS = ["SUM", "COUNT", "AVERAGE"]
let oldComponentName = null;
let componentPluginId = null;
let rowIdNumber = 1;
const ICON_SIZE = 32;

/** Shared navigation / zoom icons for view and edit. */
function buildBaseToolbarIcons() {
    return [
        {
            "file": "/lean/api/static/images/home.svg",
            "action": () => openUrl("/lean/api/render/main/"),
            "enabled": () => true
        },
        {
            "file": "/lean/api/static/images/zoom-in.svg",
            "action": () => zoomIn(),
            "enabled": () => true
        },
        {
            "file": "/lean/api/static/images/zoom-out.svg",
            "action": () => zoomOut(),
            "enabled": () => true
        },
        {
            "file": "/lean/api/static/images/zoom-100.svg",
            "action": () => zoom100(),
            "enabled": () => true
        },
        {
            "file": "/lean/api/static/images/arrow-left.svg",
            "action": () => previousPage(),
            "enabled": () => renderPageNumber0 > 0
        },
        {
            "file": "/lean/api/static/images/arrow-right.svg",
            "action": () => nextPage(),
            "enabled": () => renderPageNumber0 < renderPageCount - 1
        },
        {
            "file": "/lean/api/static/images/arrow-up.svg",
            "action": () => viewUp(),
            "enabled": () => true
        },
        {
            "file": "/lean/api/static/images/arrow-down.svg",
            "action": () => viewDown(),
            "enabled": () => true
        }
    ];
}

/** View-only: open editor for this presentation. */
function openEditorForCurrentPresentation() {
    if (typeof presentationName === "undefined" || !presentationName) {
        return;
    }
    window.open(API_BASE + "edit/presentation/" + encodeURIComponent(presentationName) + "/", "_self");
}

/**
 * Toolbar depends on leanMode:
 * - view: navigation + optional "open editor"
 * - edit: navigation + connectors + database admin (+ future edit tools)
 */
function buildToolbarIcons() {
    let icons = buildBaseToolbarIcons();
    if (isViewMode()) {
        icons.push({
            "file": "/lean/api/static/images/edit.svg",
            "action": () => openEditorForCurrentPresentation(),
            "enabled": () => true
        });
    } else {
        icons.push({
            "file": "/lean/api/static/images/connector.svg",
            "action": () => editConnectorsList(),
            "enabled": () => true
        });
        icons.push({
            "file": "/lean/api/static/images/database.svg",
            "action": () => editDatabaseConnectionsList(),
            "enabled": () => true
        });
    }
    return icons;
}

let toolbarIcons = buildToolbarIcons();

$(document).ready(installHandlers());

function installHandlers() {
    canvas = document.getElementById("svgCanvas");
    canvas.width = document.body.clientWidth;
    canvas.height = document.body.clientHeight;
    gc = canvas.getContext("2d");
    rect = canvas.getBoundingClientRect();

    initialize();
    loadIcons();
    checkPages();
    loadDrawSvgPage();
    installPresentationTitleBar();

    // Track the mouse movements and clicks
    //
    let element = $("#svgCanvas");

    element.mousemove((e) => {
        handleMouseMoveActions(e);
    });
    element.mousedown((e) => {
        if (e.button === 0) {
            if (handleMouseLeftClickActions(e)) {
                return;
            } else {
                // Move the page view around
                //

            }
        }
    });
    // mouseup may land outside the canvas while dragging a component
    $(document).mouseup((e) => {
        if (isEditMode()
            && typeof window.leanEdit !== "undefined"
            && typeof window.leanEdit.handleCanvasMouseUp === "function") {
            window.leanEdit.handleCanvasMouseUp(e);
        }
    });
}

function zoomIn() {
    zoom *= 1.1;
    drawSvg();
}

function zoomOut() {
    zoom /= 1.1;
    drawSvg();
}

function zoom100() {
    zoom = 1.0;
    drawSvg();
}

function openUrl(url) {
    window.open(url, "_self");
}

function newPresentation() {
    openUrl("/lean/api/render/main/");
}


/**
 * Load the toolbar icons
 */
function loadIcons() {
    for (let i = 0; i < toolbarIcons.length; i++) {
        let toolbarIcon = toolbarIcons[i];
        let icon = new Image();
        icon.onload = () => {
            console.log("Icon loaded: " + icon.src
                + " (" + icon.naturalWidth + "x" + icon.naturalHeight + ")");
            toolbarIcon.icon = icon;
            toolbarIcon.index = i;
            // Redraw toolbar once async SVG/PNG finishes loading
            if (typeof drawSvg === "function" && typeof image !== "undefined" && image) {
                drawSvg();
            } else if (typeof gc !== "undefined" && gc && canvas) {
                drawIcons(gc, canvas.width);
            }
        };
        icon.onerror = () => {
            console.warn("Toolbar icon failed to load: " + toolbarIcon["file"]);
        };
        icon.src = toolbarIcon["file"];
    }
}

function drawIcons(gc, width) {
    for (let i = 0; i < toolbarIcons.length; i++) {
        let toolbarIcon = toolbarIcons[i];
        let icon = toolbarIcon.icon;
        // Icons load async; skip until available to avoid drawImage throwing and breaking the UI
        if (!icon || !icon.complete) {
            continue;
        }
        // Some SVGs have no intrinsic width/height until attributes are set — fall back to ICON_SIZE
        let srcW = icon.naturalWidth || icon.width || ICON_SIZE;
        let srcH = icon.naturalHeight || icon.height || ICON_SIZE;
        if (srcW <= 0 || srcH <= 0) {
            continue;
        }
        let isEnabled = toolbarIcon.enabled.call(null);
        if (!isEnabled) {
            gc.globalAlpha = .3;
        }
        gc.drawImage(icon, 0, 0, srcW, srcH, 1 + i * ICON_SIZE, 0, ICON_SIZE - 2, ICON_SIZE - 2);
        if (!isEnabled) {
            gc.globalAlpha = 1.0;
        }
    }
    gc.strokeStyle = '#555555';
    gc.lineWidth = '1px';
    gc.beginPath();
    gc.moveTo(0, ICON_SIZE - 1);
    gc.lineTo(width, ICON_SIZE - 1);
    gc.stroke();
}

function getToolbarIcon(event) {
    let x = event.offsetX;
    let y = event.offsetY;
    if (y > ICON_SIZE || invalidMouseLocation(x, y)) {
        return null;
    }
    let iconIndex = Math.floor(x / ICON_SIZE);
    if (iconIndex >= toolbarIcons.length || iconIndex < 0) {
        return null;
    }
    return toolbarIcons[iconIndex];
}

function handleToolbarIconClick(event) {
    let icon = getToolbarIcon(event);
    if (icon !== null && icon !== undefined) {
        let isEnabled = icon.enabled.call(null);
        if (isEnabled) {
            icon.action.call(event);
            return true;
        }
    }
    return false;
}

// Initialize the lean canvas, make sure it's set up for full resolution
//
function initialize() {
    // Reduce the size of the canvas to always fit on screen and never scroll
    //
    let w = window.innerHeight;
    let y = canvas.getBoundingClientRect().y;
    rect.height = w - y;

    // Scale to full resolution, not the 72dpi stuff
    //
    canvas.width = rect.width * devicePixelRatio;
    canvas.height = rect.height * devicePixelRatio;
    gc.scale(devicePixelRatio, devicePixelRatio);
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";
    console.log("canvas size: " + canvas.width + "x" + canvas.height + ", DP-Ratio=" + devicePixelRatio);
}

function checkPages() {
    // Look up number of pages...
    //
    $.get(API_BASE + "render/info/pages/" + renderId + "/", function (result, status) {
        if (status === "success") {
            numberOfPages = parseInt(result);
            console.log("Number of available pages: " + numberOfPages);
        } else {
            numberOfPages = 1;
        }

        $("#nextPage").prop("disabled", renderPageNumber < numberOfPages - 1);
        $("#previousPage").prop("disabled", renderPageNumber <= 1);
    });
}


function loadDrawSvgPage() {
    image = new Image();
    image.onload = function () {
        drawSvg();
    }
    image.src = API_BASE + "render/page/" + renderId + "/SVG/" + renderPageNumber0 + "/";
}

function drawSvg() {
    // Let's see how much room we have available on screen.
    //
    let canvasHeight = canvas.height - ICON_SIZE;
    let canvasWidth = canvas.width;
    let scaleX = zoom * canvasWidth / (image.width * devicePixelRatio);
    let scaleY = zoom * canvasHeight / (image.height * devicePixelRatio);
    scale = Math.min(scaleX, scaleY, zoom);

    gc.strokeStyle = '#000';
    gc.fillStyle = '#fff';

    // Clear the canvas
    //
    gc.fillRect(0, 0, canvas.width, canvas.height);

    // Draw toolbar icons at the top
    //
    drawIcons(gc, canvasWidth);

    gc.translate(0, ICON_SIZE);

    // Draw the image, zoomed, scaled, translated
    //
    gc.drawImage(image,
        offset.x,
        offset.y,
        image.width,
        image.height,
        0,
        0,
        image.width * scale,
        image.height * scale);

    // Page / header / footer contours (+ active drop-target highlight from lean-edit)
    drawPageRegions(gc, scale, offset, image.width, image.height);

    // Edit-mode hover/selection overlays (page coordinates → canvas)
    if (typeof window.leanEdit !== "undefined" && typeof window.leanEdit.drawOverlays === "function") {
        window.leanEdit.drawOverlays(gc, scale, offset);
    }

    gc.translate(0, -ICON_SIZE);
}

/**
 * Light gray outlines for the full page and (when present) header / content / footer bands.
 * Active drop/drag target region is drawn with a thicker border.
 */
function drawPageRegions(gcCtx, sc, off, pageW, pageH) {
    if (!gcCtx || !pageW || !pageH || !sc) {
        return;
    }
    let regions = null;
    let active = null;
    if (typeof window.leanEdit !== "undefined") {
        if (typeof window.leanEdit.getPageRegions === "function") {
            regions = window.leanEdit.getPageRegions();
        }
        if (typeof window.leanEdit.getActiveDropRegion === "function") {
            active = window.leanEdit.getActiveDropRegion();
        }
    }

    // Fallback: full page only
    if (!regions || !regions.page) {
        regions = {
            page: {x: 0, y: 0, width: pageW, height: pageH},
            content: null,
            header: null,
            footer: null
        };
    }

    function strokeRegion(rect, isActive) {
        if (!rect || rect.width <= 0 || rect.height <= 0) {
            return;
        }
        let x = (rect.x - off.x) * sc;
        let y = (rect.y - off.y) * sc;
        let w = rect.width * sc;
        let h = rect.height * sc;
        let lineW = isActive ? 2 : 1;
        gcCtx.save();
        gcCtx.setLineDash([]);
        gcCtx.lineWidth = lineW;
        if (isActive) {
            gcCtx.strokeStyle = "rgba(120, 150, 190, 0.95)";
            gcCtx.fillStyle = "rgba(160, 190, 230, 0.08)";
            gcCtx.fillRect(x, y, w, h);
        } else {
            gcCtx.strokeStyle = "rgba(190, 190, 190, 0.75)";
        }
        gcCtx.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
        gcCtx.restore();
    }

    // Outer page contour, then header / content / footer bands
    strokeRegion(regions.page, false);
    if (regions.header) {
        strokeRegion(regions.header, active === "header");
    }
    if (regions.content) {
        strokeRegion(regions.content, active === "content");
    }
    if (regions.footer) {
        strokeRegion(regions.footer, active === "footer");
    }
}

function indicateClickPossibility(event, result) {
    // Clear the canvas first
    //
    gc.fillStyle = '#ffffff';
    gc.strokeStyle = '#ff0000';
    gc.lineWidth = 2;
    gc.fillRect(0, 0, canvas.width, canvas.height);

    // Redraw the image
    //
    drawSvg();

    if (result
        && result["found"]
        && result["drawnItem"] != null
        && result["drawnItem"]["geometry"] != null) {

        let geo = result["drawnItem"]["geometry"];
        // Draw a blue outline + light fill over the interactive subject
        // (component envelope, cell, series label, …)
        setClickableRegion((geo.x - offset.x) * scale,
            (geo.y - offset.y) * scale,
            Math.max(2, geo.width * scale),
            Math.max(2, geo.height * scale),
            ICON_SIZE);
        return true;
    }

    // Show the default cursor
    $("#svgCanvas").css("cursor", "default");

    return false;
}

function setClickableRegion(x, y, width, height, yTranslation) {
    if (yTranslation > 0) {
        gc.translate(0, yTranslation);
    }
    gc.save();
    // Light fill so the region is obvious without hiding the chart
    gc.fillStyle = "rgba(30, 90, 200, 0.18)";
    gc.strokeStyle = "rgba(20, 70, 180, 0.95)";
    gc.lineWidth = 2;
    gc.setLineDash([6, 4]);
    gc.fillRect(x, y, width, height);
    gc.strokeRect(x + 0.5, y + 0.5, Math.max(0, width - 1), Math.max(0, height - 1));
    gc.setLineDash([]);
    gc.restore();
    if (yTranslation > 0) {
        gc.translate(0, -yTranslation);
    }
    // Show a hand cursor
    $("#svgCanvas").css("cursor", "pointer");
}

function checkPreviousLookup(x, y) {
    for (let i = 0; i < lookupResults.length; i++) {
        let result = lookupResults[i];
        // See if x,y falls in a geometry
        //
        let geo = result["drawnItem"]["geometry"];
        if (x >= geo.x && y >= geo.y && x <= geo.x + geo.width && y <= geo.y + geo.height) {
            return result;
        }
    }
    return null;
}

function invalidMouseLocation(x, y) {
    // Do we need to look up anything?
    //
    return x < 0 || y < 0 || x > image.width || y > image.height;
}

function handleMouseMoveActions(event) {
    let x = correctX(event.offsetX);
    let y = correctY(event.offsetY);

    // Edit drag may continue outside the page plane; still forward moves while dragging
    if (isEditMode()
        && typeof window.leanEdit !== "undefined"
        && typeof window.leanEdit.onCanvasMouseMove === "function"
        && window.leanEdit.onCanvasMouseMove(event, x, y)) {
        return true;
    }

    if (invalidMouseLocation(x, y)) {
        if (isEditMode()
            && typeof window.leanEdit !== "undefined"
            && typeof window.leanEdit.onPageMouseMove === "function") {
            window.leanEdit.onPageMouseMove(null);
        }
        return false;
    }

    // Edit mode: client-side hit-test against component geometries (no per-move server calls)
    if (isEditMode()
        && typeof window.leanEdit !== "undefined"
        && typeof window.leanEdit.onPageMouseMove === "function") {
        window.leanEdit.onPageMouseMove(x, y);
        return true;
    }

    // View mode: interaction hover via server lookup (cached)
    let result = checkPreviousLookup(x, y);
    if (result != null) {
        return indicateClickPossibility(event, result);
    }

    $.ajax({
            url: API_BASE + "render/lookupActions/",
            type: "POST",
            data: JSON.stringify({
                "renderId": renderId,
                "pageNumber": renderPageNumber0,
                "x": x,
                "y": y
            }),
            contentType: "application/json; charset=utf-8",
            dataType: "json",
            success: function (result) {
                indicateClickPossibility(event, result);
                if (result["found"] && result["drawnItem"] != null && result["drawnItem"]["geometry"] != null) {
                    lookupResults.push(result);
                    return true;
                }
            }
        }
    );
    return false;
}


function onLeftClick(requestData) {
    $.ajax({
        url: API_BASE + "render/lookupActions/",
        type: "POST",
        data: JSON.stringify(requestData),
        contentType: "application/json; charset=utf-8",
        dataType: "json",
        success: function (result) {
            if (!result || !result.found) {
                return;
            }
            const method = result.method;
            // Default to single-click if method is missing (older payloads)
            const isClick = !method || method.mouseClick || (!method.mouseDoubleClick);
            if (!isClick) {
                return;
            }
            $("#svgCanvas").css("cursor", "default");

            const actions = result.actions || [];
            for (let i = 0; i < actions.length; i++) {
                let action = actions[i];
                if (!action) {
                    continue;
                }
                if (action.actionType === "OPEN_PRESENTATION") {
                    let targetName = action.objectName;
                    let parameterName = action.valueParameter || null;
                    let parameterValue = null;
                    if (result.drawnItem && result.drawnItem.context) {
                        parameterValue = result.drawnItem.context.value;
                    }
                    // Empty target => presentation name is the clicked cell value
                    if (targetName === null || targetName === undefined || targetName === "") {
                        targetName = parameterValue;
                    }
                    if (targetName) {
                        console.log("Open presentation: " + targetName
                            + (parameterName ? (", with " + parameterName + "=" + parameterValue) : ""));
                        openPresentation(targetName, parameterName, parameterValue);
                    }
                } else if (action.actionType === "OPEN_LINK_SAME_TAB" && action.objectName) {
                    window.open(action.objectName, "_self");
                } else if (action.actionType === "OPEN_LINK_NEW_TAB" && action.objectName) {
                    window.open(action.objectName, "_blank");
                }
            }
        },
        error: function (request, status, error) {
            console.warn("lookupActions failed:", request && request.responseText, status, error);
        }
    });
}

/**
 * Run initScript + loadScript after the form HTML is injected.
 * Deferred so synchronous XHR inside those scripts is not nested inside an async AJAX
 * success callback (which can freeze the browser UI thread).
 */
function runFormScripts(contextLabel) {
    let label = contextLabel || "form";
    try {
        let initScript = document.getElementById("initScript");
        if (initScript) {
            eval(initScript.innerHTML);
        }
    } catch (e) {
        alert("Error initializing the " + label + " form: " + e);
        throw e;
    }
    try {
        let loadScript = document.getElementById("loadScript");
        if (loadScript) {
            eval(loadScript.innerHTML);
        }
    } catch (e) {
        alert("Error loading the " + label + " values: " + e);
        throw e;
    }
}

/**
 * Ensure a layout/render error panel exists at the top of the property form.
 * @returns {HTMLElement|null}
 */
function ensureComponentErrorPanel() {
    let editArea = document.getElementById("editArea");
    if (!editArea) {
        return null;
    }
    let panel = document.getElementById("componentErrorPanel");
    if (panel) {
        return panel;
    }
    panel = document.createElement("div");
    panel.id = "componentErrorPanel";
    panel.className = "component-error-panel";
    panel.setAttribute("hidden", "hidden");
    panel.innerHTML =
        '<div class="component-error-header">'
        + '<span class="component-error-title">Component error</span>'
        + '<span class="component-error-actions">'
        + '<button type="button" class="component-error-toggle-detail" title="Show or hide full details">Details</button>'
        + '<button type="button" class="component-error-copy" title="Copy full error">Copy</button>'
        + '</span></div>'
        + '<p class="component-error-summary" id="componentErrorSummary"></p>'
        + '<textarea class="component-error-detail" id="componentErrorDetail" readonly rows="8"'
        + ' spellcheck="false" hidden></textarea>';
    editArea.insertBefore(panel, editArea.firstChild);

    let toggle = panel.querySelector(".component-error-toggle-detail");
    let copyBtn = panel.querySelector(".component-error-copy");
    let detail = panel.querySelector("#componentErrorDetail");
    if (toggle && detail) {
        toggle.onclick = function () {
            if (detail.hasAttribute("hidden")) {
                detail.removeAttribute("hidden");
                toggle.textContent = "Hide details";
            } else {
                detail.setAttribute("hidden", "hidden");
                toggle.textContent = "Details";
            }
        };
    }
    if (copyBtn) {
        copyBtn.onclick = function () {
            let summaryEl = document.getElementById("componentErrorSummary");
            let detailEl = document.getElementById("componentErrorDetail");
            let text = "";
            if (summaryEl && summaryEl.textContent) {
                text += summaryEl.textContent;
            }
            if (detailEl && detailEl.value) {
                text += (text ? "\n\n" : "") + detailEl.value;
            }
            if (!text) {
                return;
            }
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).catch(function () {
                    // fallback below
                    detailEl.removeAttribute("hidden");
                    detailEl.focus();
                    detailEl.select();
                    try {
                        document.execCommand("copy");
                    } catch (e) { /* ignore */ }
                });
            } else if (detailEl) {
                detailEl.removeAttribute("hidden");
                detailEl.focus();
                detailEl.select();
                try {
                    document.execCommand("copy");
                } catch (e) { /* ignore */ }
            }
        };
    }
    return panel;
}

/** Hide the component error panel (no error or form closed). */
function clearComponentErrorPanel() {
    let panel = document.getElementById("componentErrorPanel");
    if (!panel) {
        return;
    }
    panel.classList.remove("is-visible");
    panel.setAttribute("hidden", "hidden");
    let summary = document.getElementById("componentErrorSummary");
    let detail = document.getElementById("componentErrorDetail");
    if (summary) {
        summary.textContent = "";
    }
    if (detail) {
        detail.value = "";
        detail.setAttribute("hidden", "hidden");
    }
    let toggle = panel.querySelector(".component-error-toggle-detail");
    if (toggle) {
        toggle.textContent = "Details";
    }
}

/**
 * Show layout/render failure details in the property form.
 * @param {string} summary short message (root cause preferred)
 * @param {string} [detail] full cause chain / stack
 */
function showComponentErrorPanel(summary, detail) {
    if (!summary && !detail) {
        clearComponentErrorPanel();
        return;
    }
    let panel = ensureComponentErrorPanel();
    if (!panel) {
        return;
    }
    let summaryEl = document.getElementById("componentErrorSummary");
    let detailEl = document.getElementById("componentErrorDetail");
    let textSummary = summary || "Component layout or render failed";
    let textDetail = detail || summary || "";
    if (summaryEl) {
        summaryEl.textContent = textSummary;
    }
    if (detailEl) {
        detailEl.value = textDetail;
        // Auto-expand details when chain is longer than the summary
        if (textDetail && textDetail !== textSummary && textDetail.indexOf("\n") >= 0) {
            detailEl.removeAttribute("hidden");
            let toggle = panel.querySelector(".component-error-toggle-detail");
            if (toggle) {
                toggle.textContent = "Hide details";
            }
        }
    }
    panel.classList.add("is-visible");
    panel.removeAttribute("hidden");
}

/**
 * Load diagnostics for the open component and update the error panel.
 * Uses cached layout error when provided, then refreshes from the server.
 */
function loadComponentDiagnostics(componentName, cachedSummary, cachedDetail) {
    if (!componentName || typeof presentationName === "undefined") {
        return;
    }
    if (cachedSummary) {
        showComponentErrorPanel(cachedSummary, cachedDetail || cachedSummary);
    }
    $.ajax({
        url: API_BASE + "edit/presentation/" + encodeURIComponent(presentationName)
            + "/components/" + encodeURIComponent(componentName) + "/diagnostics",
        type: "GET",
        dataType: "json",
        success: function (data) {
            if (!data || data.ok === true || !data.summary) {
                // Clear only if we did not have a cached error; otherwise keep until ok
                if (!cachedSummary) {
                    clearComponentErrorPanel();
                } else if (data && data.ok === true) {
                    clearComponentErrorPanel();
                }
                return;
            }
            showComponentErrorPanel(data.summary, data.detail || data.summary);
        },
        error: function (xhr) {
            // Fall back to cached or a generic note
            if (!cachedSummary) {
                let body = (xhr && xhr.responseText) ? xhr.responseText : "Diagnostics request failed";
                showComponentErrorPanel("Could not load component diagnostics", body);
            }
        }
    });
}

/**
 * Layout feedback: human attachment lines + resolved geometry/pages from the server.
 * Also wires live per-side hints while editing LAYOUT_SIDE fields.
 */
function installLayoutFeedbackPanel(componentName) {
    let editArea = document.getElementById("editArea");
    if (!editArea || !componentName) {
        return;
    }
    // Only when the form has layout attachment fields
    if (!document.getElementById("leftEnabled")
        && !document.getElementById("topEnabled")
        && !document.getElementById("rightEnabled")
        && !document.getElementById("bottomEnabled")) {
        return;
    }
    let panel = document.getElementById("layoutResultPanel");
    if (!panel) {
        panel = document.createElement("div");
        panel.id = "layoutResultPanel";
        panel.className = "layout-result-panel";
        // Insert after action bar or at top of form
        let actionBar = editArea.querySelector(".form-action-bar");
        if (actionBar && actionBar.nextSibling) {
            editArea.insertBefore(panel, actionBar.nextSibling);
        } else {
            editArea.insertBefore(panel, editArea.firstChild);
        }
    }
    panel.innerHTML = "<h4>Layout result</h4>"
        + "<p class=\"editor-hint\" id=\"layoutResultStatus\">Loading layout info...</p>"
        + "<ul id=\"layoutResultAttachments\" class=\"layout-result-list\"></ul>"
        + "<p id=\"layoutResultGeometry\" class=\"layout-result-geo\"></p>"
        + "<p id=\"layoutResultPages\" class=\"layout-result-pages\"></p>"
        + "<ul id=\"layoutResultWarnings\" class=\"layout-result-warnings\"></ul>";

    wireLayoutSideLiveHints();
    refreshLayoutSideLiveHints();
    loadComponentLayoutInfo(componentName);
}

function summarizeLayoutSideFromForm(side) {
    let en = document.getElementById(side + "Enabled");
    if (!en || !en.checked) {
        return "";
    }
    let relEl = document.getElementById(side + "ObjectName");
    let offEl = document.getElementById(side + "Offset");
    let pctEl = document.getElementById(side + "Percentage");
    let alEl = document.getElementById(side + "Alignment");
    let rel = relEl && relEl.value ? relEl.value : "";
    let edge = alEl && alEl.value ? alEl.value : "DEFAULT";
    let off = offEl ? parseInt(offEl.value, 10) || 0 : 0;
    let pct = pctEl ? parseInt(pctEl.value, 10) || 0 : 0;
    let target = rel ? ("\"" + rel + "\"") : "page";
    let s = capitalizeFirst(side) + ": " + String(edge).toLowerCase() + " edge of " + target;
    if (off) {
        s += (off > 0 ? " + " : " - ") + Math.abs(off) + " px";
    }
    if (pct) {
        s += " + " + pct + "%";
    }
    return s;
}

function capitalizeFirst(s) {
    if (!s) {
        return s;
    }
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function refreshLayoutSideLiveHints() {
    ["left", "right", "top", "bottom"].forEach(function (side) {
        let hint = document.getElementById(side + "LayoutHint");
        if (!hint) {
            return;
        }
        hint.textContent = summarizeLayoutSideFromForm(side);
    });
}

function wireLayoutSideLiveHints() {
    ["left", "right", "top", "bottom"].forEach(function (side) {
        ["Enabled", "ObjectName", "Offset", "Percentage", "Alignment"].forEach(function (suffix) {
            let el = document.getElementById(side + suffix);
            if (el && !el._layoutHintWired) {
                el._layoutHintWired = true;
                el.addEventListener("change", refreshLayoutSideLiveHints);
                el.addEventListener("input", refreshLayoutSideLiveHints);
            }
        });
    });
}

function loadComponentLayoutInfo(componentName) {
    if (!componentName || typeof presentationName === "undefined") {
        return;
    }
    $.ajax({
        url: API_BASE + "edit/presentation/" + encodeURIComponent(presentationName)
            + "/components/" + encodeURIComponent(componentName) + "/layout-info",
        type: "GET",
        dataType: "json",
        success: function (data) {
            renderLayoutResultPanel(data);
        },
        error: function (xhr) {
            let st = document.getElementById("layoutResultStatus");
            if (st) {
                st.textContent = "Could not load layout info: "
                    + ((xhr && xhr.responseText) ? xhr.responseText : xhr.status);
            }
        }
    });
}

function renderLayoutResultPanel(data) {
    let st = document.getElementById("layoutResultStatus");
    let attUl = document.getElementById("layoutResultAttachments");
    let geoP = document.getElementById("layoutResultGeometry");
    let pagesP = document.getElementById("layoutResultPages");
    let warnUl = document.getElementById("layoutResultWarnings");
    if (!st) {
        return;
    }
    if (!data || data.ok === false) {
        st.textContent = (data && data.warnings && data.warnings[0])
            ? data.warnings[0]
            : "Layout info unavailable";
        return;
    }
    st.textContent = "After layout (saved attachments):";
    if (attUl) {
        attUl.innerHTML = "";
        let atts = data.attachments || {};
        ["left", "right", "top", "bottom"].forEach(function (side) {
            if (!atts[side]) {
                return;
            }
            let li = document.createElement("li");
            li.textContent = atts[side].summary || side;
            attUl.appendChild(li);
        });
        if (!attUl.children.length) {
            let li = document.createElement("li");
            li.className = "editor-hint";
            li.textContent = "(no attachments enabled)";
            attUl.appendChild(li);
        }
    }
    if (geoP) {
        let g = data.resolved;
        if (g) {
            geoP.textContent = "Resolved box: x=" + g.x + ", y=" + g.y
                + ", width=" + g.width + ", height=" + g.height + " px";
        } else {
            geoP.textContent = "Resolved box: (none)";
        }
    }
    if (pagesP) {
        let pages = data.pages || [];
        let pc = data.pageCount != null ? data.pageCount : "?";
        if (!pages.length) {
            pagesP.textContent = "Present on pages: none of " + pc;
        } else if (pages.length === 1) {
            pagesP.textContent = "Present on page " + (pages[0] + 1) + " of " + pc;
        } else {
            pagesP.textContent = "Present on "
                + pages.length + " pages (first page " + (pages[0] + 1)
                + ", last page " + (pages[pages.length - 1] + 1) + ") of " + pc;
        }
    }
    if (warnUl) {
        warnUl.innerHTML = "";
        let warns = data.warnings || [];
        for (let i = 0; i < warns.length; i++) {
            let li = document.createElement("li");
            li.textContent = warns[i];
            warnUl.appendChild(li);
        }
    }
}

/**
 * @param url form HTML URL
 * @param panelOptions optional { withPreview, componentName, geometry, layoutError, layoutErrorDetail }
 */
function openEditArea(url, panelOptions) {
    panelOptions = panelOptions || {};
    // Component property forms show preview; connector/admin forms do not
    if (panelOptions.withPreview === undefined) {
        panelOptions.withPreview = false;
    }
    setSidePanelOpen(true, panelOptions);
    // Reset combo dependency registries for the new form
    connectorColumnListTables = [];
    connectorColumnSelects = [];
    connectorNames = null;
    themeNames = null;
    componentNames = null;
    $.ajax({
        url: url,
        type: "GET",
        contentType: "application/json; charset=utf-8",
        dataType: "html",
        success: function (snippet) {
            let editArea = document.getElementById("editArea");
            editArea.innerHTML = snippet;
            // Defer past the AJAX completion stack
            setTimeout(function () {
                runFormScripts(componentPluginId || "component");
                // Layout/render error panel (above form fields)
                if (panelOptions.withPreview && panelOptions.componentName) {
                    loadComponentDiagnostics(
                        panelOptions.componentName,
                        panelOptions.layoutError || null,
                        panelOptions.layoutErrorDetail || null
                    );
                    installLayoutFeedbackPanel(panelOptions.componentName);
                } else {
                    clearComponentErrorPanel();
                }
                if (panelOptions.withPreview && panelOptions.componentName) {
                    loadComponentPreview(panelOptions.componentName, panelOptions.geometry || null);
                }
            }, 0);
        },
        error: function (request, status, error) {
            alert(request.responseText);
        }
    });
}

/**
 * Edit the component JSON given in the specified panel (div).
 * After editing we need to set the width of this panel back to 0.
 * The render ID and presentation name are known for the whole page.
 *
 * @param payload either a LeanComponent JSON object, or
 *   { component, logicalPageNumber, pageRole } from getComponent
 * @param requestData click context (renderId, pageNumber, x, y)
 */
function editComponent(payload, requestData) {
    // Prefer wrapped { component, logicalPageNumber, pageRole } from getComponent
    let component;
    let layoutError = null;
    let layoutErrorDetail = null;
    if (payload && (payload.logicalPageNumber !== undefined || payload.pageRole !== undefined
        || payload.layoutError !== undefined || payload.component)) {
        component = payload.component;
        editLogicalPageNumber = parseInt(payload.logicalPageNumber);
        if (isNaN(editLogicalPageNumber) || editLogicalPageNumber < 0) {
            editLogicalPageNumber =
                requestData && requestData.pageNumber !== undefined
                    ? parseInt(requestData.pageNumber) : 0;
        }
        editPageRole = payload.pageRole || "page";
        layoutError = payload.layoutError || null;
        layoutErrorDetail = payload.layoutErrorDetail || null;
    } else {
        // Legacy bare component JSON
        component = payload;
        editLogicalPageNumber =
            requestData && requestData.pageNumber !== undefined
                ? parseInt(requestData.pageNumber) : 0;
        if (isNaN(editLogicalPageNumber) || editLogicalPageNumber < 0) {
            editLogicalPageNumber = 0;
        }
        editPageRole = "page";
    }

    if (!component) {
        alert("No component data returned from server");
        return;
    }

    oldComponentName = component["name"];

    // Plugin map under component.component.{pluginId}
    let iComponent = component["component"];
    if (!iComponent) {
        alert("Component payload has no plugin data: " + JSON.stringify(component).slice(0, 200));
        return;
    }

    componentPluginId = Object.keys(iComponent)[0];
    componentJson = component;

    if (connectorNames === null) {
        connectorNames = getConnectorNames();
    }
    if (componentNames === null) {
        componentNames = getComponentNames();
    }
    if (themeNames === null) {
        themeNames = getThemeNames();
    }

    let geo = null;
    if (typeof window.leanEdit !== "undefined"
        && typeof window.leanEdit.getGeometries === "function") {
        let geos = window.leanEdit.getGeometries() || [];
        for (let i = 0; i < geos.length; i++) {
            if (geos[i].componentName === oldComponentName && geos[i].geometry) {
                geo = geos[i].geometry;
                // Geometries may carry layout error from the last full-page render
                if (!layoutError && geos[i].layoutError) {
                    layoutError = geos[i].layoutError;
                    layoutErrorDetail = geos[i].layoutErrorDetail || geos[i].layoutError;
                }
                break;
            }
        }
    }

    openEditArea(API_BASE + "edit/component/" + componentPluginId, {
        withPreview: true,
        componentName: oldComponentName,
        geometry: geo,
        layoutError: layoutError,
        layoutErrorDetail: layoutErrorDetail
    });
}

function onCtrlLeftClick(requestData) {
    // In edit mode, skip the server round-trip when local hit-test already knows it's empty
    if (isEditMode()
        && typeof window.leanEdit !== "undefined"
        && typeof window.leanEdit.hitTest === "function") {
        let localHit = window.leanEdit.hitTest(requestData.x, requestData.y);
        if (!localHit) {
            if (typeof window.leanEdit.clearSelection === "function") {
                window.leanEdit.clearSelection();
            }
            return;
        }
    }
    $.ajax({
        url: API_BASE + "render/getComponent/",
        type: "POST",
        data: JSON.stringify(requestData),
        contentType: "application/json; charset=utf-8",
        dataType: "json",
        success: function (payload) {
            // Empty canvas click — no component under cursor (not an error)
            if (!payload || payload.empty === true || !payload.component) {
                if (isEditMode()
                    && typeof window.leanEdit !== "undefined"
                    && typeof window.leanEdit.clearSelection === "function") {
                    window.leanEdit.clearSelection();
                }
                return;
            }
            editComponent(payload, requestData);
        },
        error: function (request, status, error) {
            showAjaxError("Could not open component", request, status, error);
        }
    });
}


function handleMouseLeftClickActions(e) {
    // See if it's a toolbar icon
    //
    if (handleToolbarIconClick(e)) {
        return;
    }

    let x = correctX(e.offsetX);
    let y = correctY(e.offsetY);

    if (invalidMouseLocation(x, y)) {
        return false;
    }

    let requestData = {
        "renderId": renderId,
        "pageNumber": renderPageNumber0,
        "x": x,
        "y": y
    };

    if (isEditMode()) {
        // Authoring: lean-edit owns mousedown→drag→mouseup (select / move / open properties)
        if (typeof window.leanEdit !== "undefined"
            && typeof window.leanEdit.handleCanvasMouseDown === "function") {
            window.leanEdit.handleCanvasMouseDown(e, x, y, requestData);
            return true;
        }
        onCtrlLeftClick(requestData);
    } else {
        // View: interaction navigation only (no structural edit)
        onLeftClick(requestData);
    }
}

// Open the presentation with the given name
//
function openPresentation(presentationName,
                          parameterName,
                          parameterValue
) {
    let postData = {};
    postData.presentationName = presentationName;
    postData.parameters = [];
    if (parameterName !== null && parameterValue !== null) {
        postData.parameters.push({
            "parameterName": parameterName,
            "parameterValue": parameterValue
        });
    }
    let stringData = JSON.stringify(postData);
    console.log("Posting presentation postData: " + stringData);

    $.ajax({
        type: "POST",
        url: API_BASE + "render/presentation/",
        data: stringData,
        dataType: "text", // Returning ID
        contentType: "application/json; charset=utf-8",
        success: (renderId) => {
            // Open the first page.
            window.open(API_BASE + "render/page/" + renderId + "/HTML/0/", "_self");
        },
        error: function (request, status, error) {
            alert("Error rendering presentation, status: " + status + " : " +
                request.responseText + ", error: " + error);
        }
    });
}

function nextPage() {
    let next = parseInt(renderPageNumber0) + 1;
    let max = typeof numberOfPages !== "undefined" && numberOfPages
        ? numberOfPages : parseInt(renderPageCount);
    if (next >= max) {
        return;
    }
    if (isEditMode()) {
        window.open(
            API_BASE + "edit/presentation/" + encodeURIComponent(presentationName)
                + "/page/" + next + "/?reload=false",
            "_self"
        );
        return;
    }
    window.open(API_BASE + "render/page/" + renderId + "/HTML/" + next + "/", "_self");
}

function previousPage() {
    let prev = parseInt(renderPageNumber0) - 1;
    if (prev < 0) {
        return;
    }
    if (isEditMode()) {
        window.open(
            API_BASE + "edit/presentation/" + encodeURIComponent(presentationName)
                + "/page/" + prev + "/?reload=false",
            "_self"
        );
        return;
    }
    window.open(API_BASE + "render/page/" + renderId + "/HTML/" + prev + "/", "_self");
}

function viewDown() {
    offset.y += 25;
    drawSvg();
}

function viewUp() {
    offset.y -= 25;
    if (offset.y < 0) {
        offset.y = 0;
    }
    drawSvg();
}

function correctX(value) {
    return offset.x + value / scale;
}

function correctY(value) {
    return -ICON_SIZE + offset.y + value / scale;
}

/** Tables that need column-name options refreshed when the source connector changes. */
let connectorColumnListTables = [];
/** Select fields bound to connectorColumns that should refresh on dependsOn change. */
let connectorColumnSelects = [];

function ensureFormMetadataCaches() {
    if (typeof renderId !== "undefined" && renderId) {
        componentNames = getComponentNames();
        connectorNames = getPresentationConnectorNames();
    } else {
        // Connector-only edit (no presentation render context)
        if (connectorNames === null) {
            connectorNames = getConnectorNames();
        }
        if (componentNames === null) {
            componentNames = [""];
        }
    }
    if (themeNames === null) {
        themeNames = getThemeNames();
    }
}

function getComponentNames() {
    let names = [];
    if (typeof renderId === "undefined" || !renderId) {
        return [""];
    }
    $.ajax({
            url: API_BASE + "render/info/components/" + renderId + "/" + renderPageNumber0 + "/",
            type: "GET",
            contentType: "application/json; charset=utf-8",
            dataType: "json",
            success: function (list) {
                // Empty value means: relative to page
                names.push("");
                for (let i = 0; i < list.length; i++) {
                    names.push(list[i]);
                }
            },
            async: false
        }
    );
    return names;
}

function getConnectorNames() {
    let names = [];
    $.ajax({
            url: API_BASE + "metadata/list/connector/",
            type: "GET",
            contentType: "application/json; charset=utf-8",
            dataType: "json",
            success: function (list) {
                // Empty value means: no connector
                names.push("");
                for (let i = 0; i < list.length; i++) {
                    names.push(list[i]);
                }
            },
            async: false
        }
    );
    return names;
}

/** Presentation-local + shared metadata connector names for the active render. */
function getPresentationConnectorNames() {
    let names = [""];
    if (typeof renderId === "undefined" || !renderId) {
        return getConnectorNames();
    }
    $.ajax({
        url: API_BASE + "render/info/connectors/" + encodeURIComponent(renderId),
        type: "GET",
        dataType: "json",
        async: false,
        success: function (list) {
            names = [""];
            for (let i = 0; i < list.length; i++) {
                names.push(list[i]);
            }
        },
        error: function () {
            names = getConnectorNames();
        }
    });
    return names;
}

function getThemeNames() {
    let names = [];
    $.ajax({
            url: API_BASE + "metadata/list/theme/",
            type: "GET",
            contentType: "application/json; charset=utf-8",
            dataType: "json",
            success: function (list) {
                // Empty value means: no theme
                names.push("");
                for (let i = 0; i < list.length; i++) {
                    names.push(list[i]);
                }
            },
            async: false
        }
    );
    return names;
}

function getMetadataNames(metadataKey) {
    let names = [""];
    if (!metadataKey) {
        return names;
    }
    $.ajax({
        url: API_BASE + "metadata/list/" + encodeURIComponent(metadataKey) + "/",
        type: "GET",
        dataType: "json",
        async: false,
        success: function (list) {
            names = [""];
            for (let i = 0; i < list.length; i++) {
                names.push(list[i]);
            }
        }
    });
    return names;
}

function describeConnectorOutput(connectorName) {
    if (!connectorName) {
        return [];
    }
    let request = {
        renderId: typeof renderId !== "undefined" ? renderId : null,
        connectorName: connectorName
    };
    let rowMeta = [];
    $.ajax({
            url: API_BASE + "render/connector/describe/",
            type: "POST",
            data: JSON.stringify(request),
            contentType: "application/json; charset=utf-8",
            dataType: "json",
            success: function (result) {
                rowMeta = result || [];
            },
            error: function (xhr) {
                // Non-fatal: empty column list; log for debugging
                console.warn("describeConnectorOutput failed for", connectorName, xhr && xhr.responseText);
                rowMeta = [];
            },
            async: false
        }
    );
    return rowMeta;
}

function getConnectorColumnNames(connectorName) {
    let connectorColumnNames = [];
    if (connectorName !== null && connectorName !== undefined && connectorName !== "") {
        let rowMeta = describeConnectorOutput(connectorName);
        for (let i = 0; i < rowMeta.length; i++) {
            let v = rowMeta[i];
            if (v && v['name']) {
                connectorColumnNames.push(v['name']);
            }
        }
    }
    return connectorColumnNames;
}

/**
 * Fill a &lt;select&gt; from a dynamic source (connectors, themes, components, columns, metadata).
 */
function bindSelectSource(selectId, source, options) {
    options = options || {};
    let values = resolveSelectSourceValues(source, options);
    setSelectOptions(selectId, values);
    if (source === "connectorColumns") {
        connectorColumnSelects.push({
            selectId: selectId,
            dependsOn: options.dependsOn || "sourceConnectorName"
        });
    }
}

function resolveSelectSourceValues(source, options) {
    options = options || {};
    ensureFormMetadataCaches();
    switch (source) {
        case "connectors":
            return connectorNames || getPresentationConnectorNames();
        case "themes":
            return themeNames || getThemeNames();
        case "components":
            return componentNames || getComponentNames();
        case "connectorColumns": {
            let dep = options.dependsOn || "sourceConnectorName";
            let el = document.getElementById(dep);
            let cname = el ? el.value : "";
            return getConnectorColumnNames(cname);
        }
        case "metadata":
            return getMetadataNames(options.metadataKey);
        case "none":
        default:
            return options.staticValues || [];
    }
}

function registerConnectorColumnListTable(tableId, dependsOn, itemKind) {
    connectorColumnListTables.push({
        tableId: tableId,
        dependsOn: dependsOn || "sourceConnectorName",
        itemKind: itemKind || "column"
    });
}

function wireConnectorDependentCombos() {
    // When source connector (or other dependsOn field) changes, refresh column options
    let deps = {};
    for (let i = 0; i < connectorColumnSelects.length; i++) {
        deps[connectorColumnSelects[i].dependsOn] = true;
    }
    for (let i = 0; i < connectorColumnListTables.length; i++) {
        deps[connectorColumnListTables[i].dependsOn] = true;
    }
    Object.keys(deps).forEach(function (depId) {
        let el = document.getElementById(depId);
        if (!el || el._leanComboWired) {
            return;
        }
        el._leanComboWired = true;
        el.addEventListener("change", function () {
            refreshConnectorColumnDependents(depId);
        });
    });
}

/**
 * True if value is present in options (string-coerced compare).
 */
function optionsIncludeValue(options, value) {
    if (value === null || value === undefined) {
        return false;
    }
    if (!options || !options.length) {
        return false;
    }
    let s = String(value);
    for (let i = 0; i < options.length; i++) {
        if (String(options[i]) === s) {
            return true;
        }
    }
    return false;
}

/**
 * Copy of options that always includes the current stored value.
 * Missing source fields keep their metadata (e.g. category when connector is down).
 * @param {Array} options live option list
 * @param {*} value current metadata value
 * @returns {{options: Array, missing: boolean}}
 */
function mergeValueIntoOptions(options, value) {
    let list = Array.isArray(options) ? options.slice() : [];
    if (value === null || value === undefined || value === "") {
        return { options: list, missing: false };
    }
    if (optionsIncludeValue(list, value)) {
        return { options: list, missing: false };
    }
    // Preserve metadata: keep the configured name even when not in live source
    list.unshift(value);
    return { options: list, missing: true };
}

/**
 * Display label for a select option; mark values not currently in the source.
 */
function optionDisplayText(value, missing) {
    if (value === "" || value === null || value === undefined) {
        return "(none)";
    }
    return missing ? (String(value) + " (not in source)") : String(value);
}

/**
 * Rebuild a &lt;select&gt;'s options from a live list while keeping the current value.
 * Never silently switches to the first live column when the old name is missing.
 */
function rebuildSelectOptions(select, liveValues, preferredValue) {
    if (!select) {
        return;
    }
    let prev = preferredValue;
    if (prev === undefined || prev === null) {
        prev = select.value;
    }
    // Also keep data-preserve-value if the control is empty (e.g. failed describe left 0 options)
    if ((prev === undefined || prev === null || prev === "")
        && select.getAttribute("data-preserve-value")) {
        prev = select.getAttribute("data-preserve-value");
    }
    let merged = mergeValueIntoOptions(liveValues || [], prev);
    while (select.options.length > 0) {
        select.remove(0);
    }
    for (let i = 0; i < merged.options.length; i++) {
        let v = merged.options[i];
        let isMissing = merged.missing && String(v) === String(prev);
        addOptionToSelect(select, v, optionDisplayText(v, isMissing));
        if (isMissing && select.options.length) {
            select.options[select.options.length - 1].setAttribute("data-missing-source", "true");
        }
    }
    if (prev !== undefined && prev !== null && prev !== "") {
        select.value = String(prev);
        select.setAttribute("data-preserve-value", String(prev));
        // If the browser still refused (should not with merge), force-add once more
        if (select.value !== String(prev)) {
            addOptionToSelect(select, prev, optionDisplayText(prev, true));
            select.value = String(prev);
        }
    }
}

function refreshConnectorColumnDependents(dependsOnId) {
    let depEl = document.getElementById(dependsOnId);
    let cname = depEl ? depEl.value : "";
    let cols = getConnectorColumnNames(cname);

    for (let i = 0; i < connectorColumnSelects.length; i++) {
        let item = connectorColumnSelects[i];
        if (item.dependsOn === dependsOnId) {
            let sel = document.getElementById(item.selectId);
            if (sel) {
                rebuildSelectOptions(sel, cols, sel.value || sel.getAttribute("data-preserve-value"));
            }
        }
    }

    // Refresh column-name selects inside registered list tables
    for (let t = 0; t < connectorColumnListTables.length; t++) {
        let reg = connectorColumnListTables[t];
        if (reg.dependsOn !== dependsOnId) {
            continue;
        }
        let table = document.getElementById(reg.tableId);
        if (!table) {
            continue;
        }
        for (let r = 1; r < table.rows.length; r++) {
            let cell = table.rows[r].cells[0];
            if (!cell) {
                continue;
            }
            let select = cell.querySelector("select");
            if (!select) {
                continue;
            }
            rebuildSelectOptions(
                select,
                cols,
                select.value || select.getAttribute("data-preserve-value")
            );
        }
    }
}

/**
 * Fill select options. Preserves the currently selected value when it is not in the new list
 * (metadata must not be replaced by the first live column after a connector/source glitch).
 */
function setSelectOptions(selectId, values) {
    try {
        let list = document.getElementById(selectId);
        if (list === null || list === undefined) {
            return;
        }
        rebuildSelectOptions(list, values || [], list.value || list.getAttribute("data-preserve-value"));
    } catch (e) {
        throw "Error adding select options for select ID '" + selectId + "' and values: " + JSON.stringify(values) + " : " + e;
    }
}

function addOptionToSelect(list, value, displayText) {
    let option = document.createElement("option");
    option.value = value === null || value === undefined ? "" : value;
    option.text = displayText != null ? displayText : optionDisplayText(value, false);
    list.appendChild(option);
}

function toHex(v) {
    let h = parseInt(v).toString(16);
    return h.length === 1 ? "0" + h : h;
}

function rgbToHex(r, g, b) {
    return '#' + toHex(r) + toHex(g) + toHex(b);
}

function hexToRgb(hex) {
    let result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

/**
 *
 * @param id the id of the selection widget to create.
 * @param value The value to set on the selection.
 * @param optionValues the options to add to the selection.
 * @param flags optional:
 *   - defaultEmptyToFirst: if true and value is empty, pick first option (enums only)
 *   - preserveMissing: if true (default), keep a non-empty value even when not in options
 * @returns HTML for a &lt;select&gt; widget
 */
function createSelection(id, value, optionValues, flags) {
    flags = flags || {};
    // Non-empty metadata values are always kept, even when the live source list is empty
    // or missing that name (connector offline / rename / describe failure).
    let preserveMissing = flags.preserveMissing !== false;
    let defaultEmptyToFirst = flags.defaultEmptyToFirst === true;

    let options = Array.isArray(optionValues) ? optionValues.slice() : [];
    let missing = false;
    if (value !== null && value !== undefined && value !== "") {
        if (preserveMissing) {
            let merged = mergeValueIntoOptions(options, value);
            options = merged.options;
            missing = merged.missing;
        }
    } else if (defaultEmptyToFirst && options.length) {
        // Closed enums only (alignment, aggregation) — never column names
        value = options[0];
    }

    let preserveAttr = "";
    if (value !== null && value !== undefined && value !== "") {
        preserveAttr = ' data-preserve-value="'
            + String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;") + '"';
    }
    let html = '<select id="' + id + '" name="' + id + '" style="width: 100%"' + preserveAttr + ">";
    let selectedAny = false;
    for (let i = 0; i < options.length; i++) {
        let optionValue = options[i];
        let selected = "";
        if (value !== null && value !== undefined && String(value) === String(optionValue)) {
            selected = ' selected="selected"';
            selectedAny = true;
        }
        let isMissing = missing && String(optionValue) === String(value);
        let label = optionDisplayText(optionValue, isMissing);
        let safeVal = String(optionValue === null || optionValue === undefined ? "" : optionValue)
            .replace(/&/g, "&amp;").replace(/"/g, "&quot;");
        let safeLabel = String(label).replace(/&/g, "&amp;").replace(/</g, "&lt;");
        html += '<option value="' + safeVal + '"' + selected
            + (isMissing ? ' data-missing-source="true"' : "")
            + ">" + safeLabel + "</option>";
    }
    // Stored value with empty live options: still show it so Apply does not wipe metadata
    if (!selectedAny && value !== null && value !== undefined && value !== "") {
        let safeVal = String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
        let safeLabel = optionDisplayText(value, true).replace(/&/g, "&amp;").replace(/</g, "&lt;");
        html += '<option value="' + safeVal + '" selected="selected" data-missing-source="true">'
            + safeLabel + "</option>";
        selectedAny = true;
    }
    html += "</select>";
    return html;
}

/**
 * @param id element id
 * @param value input value
 * @param style optional CSS for the input (e.g. "width: 4em")
 */
function createText(id, value, style) {
    let v = (value === null || value === undefined) ? "" : value;
    let styleAttr = style ? ' style="' + style + '"' : "";
    return '<input type="text" id="' + id + '" value="'
        + String(v).replace(/"/g, "&quot;") + '"' + styleAttr + ">";
}

function createCheckBox(id, value) {
    let checked = (value === true || value === "true") ? " checked" : "";
    return '<input type="checkbox" id="' + id + '"' + checked + '>';
}

function createButton(id, label) {
    return '<button type="button" id="' + id + '">' + label + '</button>';
}


function createIcon(id, iconFile, label) {
    return '<img src="' + API_BASE + iconFile + '" id="' + id + '" alt="' + label
        + '" style="width: 16px;height: 16px">';
}

/**
 * Small icon button used for list row actions (up/down) and toolbars.
 * @param id element id
 * @param iconName file name under static/images/ (e.g. "arrow-up.svg")
 * @param label accessible title/alt text
 */
function createIconButton(id, iconName, label) {
    return '<button type="button" class="list-row-btn" id="' + id + '" title="' + label + '">'
        + '<img src="' + API_BASE + 'static/images/' + iconName + '" alt="' + label
        + '" width="16" height="16">'
        + '</button>';
}

// ---------------------------------------------------------------------------
// List field tables: header Add/Delete, row Up/Down reorder
// ---------------------------------------------------------------------------

function listFieldKind(table) {
    return table.getAttribute("data-list-kind") || "column";
}

function listFieldColumnPrefix(table) {
    return table.getAttribute("data-column-prefix") || table.id;
}

function listFieldConnectorColumnNames(/* table */) {
    // Prefer live source-connector select when present (component editors)
    let sourceEl = document.getElementById("sourceConnectorName");
    let sourceName = sourceEl ? sourceEl.value : null;
    if (typeof getConnectorColumnNames === "function") {
        return getConnectorColumnNames(sourceName);
    }
    return [""];
}

/**
 * Header Add: append a new empty row for the list kind of this table.
 */
function listFieldAdd(tableId) {
    let table = document.getElementById(tableId);
    if (!table) {
        return;
    }
    // insert at end: create*Row uses insertRow(i+1), so i = rows.length - 1 appends
    let i = Math.max(0, table.rows.length - 1);
    let kind = listFieldKind(table);
    let prefix = listFieldColumnPrefix(table);
    let colNames = listFieldConnectorColumnNames(table);

    if (kind === "fact") {
        createFactsRow(table, {
            "columnName": "",
            "headerValue": "",
            "width": 0,
            "horizontalAlignment": "LEFT",
            "verticalAlignment": "MIDDLE",
            "formatMask": "",
            "horizontalAggregation": true,
            "verticalAggregation": true,
            "aggregationMethod": "SUM"
        }, i, prefix, colNames);
    } else if (kind === "string") {
        createStringListRow(table, "", i);
    } else if (kind === "sort") {
        createSortMethodRow(table, {"type": "NATIVE_VALUE", "ascending": true}, i);
    } else if (kind === "filter") {
        createFilterValueRow(table, {"fieldName": "", "filterValue": ""}, i, colNames);
    } else if (kind === "groupKey") {
        createGroupKeyMappingRow(table, {"groupColumn": "", "connectorColumn": ""}, i);
    } else if (kind === "jsonField") {
        createJsonFieldRow(table, {
            "tag": "",
            "name": "",
            "type": "String",
            "formatMask": "",
            "length": "",
            "precision": ""
        }, i);
    } else if (kind === "connector" || kind === "bean") {
        createJsonObjectRow(table, {}, i);
    } else {
        createColumnsRow(table, {
            "columnName": "",
            "headerValue": "",
            "width": 0,
            "horizontalAlignment": "LEFT",
            "verticalAlignment": "MIDDLE",
            "formatMask": ""
        }, i, prefix, colNames);
    }
}

function listRowMoveUp(table, row) {
    let idx = row.rowIndex;
    if (idx <= 1) {
        return; // already first data row (row 0 is header)
    }
    let prev = table.rows[idx - 1];
    row.parentNode.insertBefore(row, prev);
}

function listRowMoveDown(table, row) {
    let idx = row.rowIndex;
    if (idx >= table.rows.length - 1) {
        return; // already last
    }
    let next = table.rows[idx + 1];
    // Move next before row => swap
    row.parentNode.insertBefore(next, row);
}

/**
 * Append Up, Down, and Delete icon buttons as the last three cells of a list data row.
 * @returns next cell index after the three cells
 */
function appendListReorderCells(row, table, startIndex) {
    let upId = row.id + "-up";
    let downId = row.id + "-down";
    let delId = row.id + "-delete";
    row.insertCell(startIndex).innerHTML = createIconButton(upId, "arrow-up.svg", "Move up");
    document.getElementById(upId).onclick = function (e) {
        e.stopPropagation();
        listRowMoveUp(table, row);
    };
    row.insertCell(startIndex + 1).innerHTML = createIconButton(downId, "arrow-down.svg", "Move down");
    document.getElementById(downId).onclick = function (e) {
        e.stopPropagation();
        listRowMoveDown(table, row);
    };
    row.insertCell(startIndex + 2).innerHTML = createIconButton(delId, "delete.svg", "Delete row");
    document.getElementById(delId).onclick = function (e) {
        e.stopPropagation();
        columnDelete(table, row);
    };
    return startIndex + 3;
}

function openPage(newRenderId) {
    if (isEditMode()) {
        // Prefer soft re-render if available (keeps editor shell)
        if (typeof softReloadEditor === "function") {
            softReloadEditor();
            return;
        }
        let page = typeof renderPageNumber0 !== "undefined" ? renderPageNumber0 : 0;
        window.open(
            API_BASE + "edit/presentation/" + encodeURIComponent(presentationName)
                + "/page/" + page + "/?reload=true",
            "_self"
        );
        return;
    }
    // View mode: HTML page shell for the same render page index
    window.open(
        API_BASE + "render/page/" + newRenderId + "/HTML/" + renderPageNumber0 + "/",
        "_self"
    );
}

/**
 * Soft re-render for edit mode: new renderId + SVG + editor list/geometries, no full navigation.
 * Falls back to full editor navigation if the re-render API fails.
 */
function softReloadEditor(keepSelectionName) {
    if (!isEditMode() || typeof presentationName === "undefined") {
        return;
    }
    $.ajax({
        url: API_BASE + "edit/presentation/" + encodeURIComponent(presentationName) + "/render/",
        type: "POST",
        dataType: "json",
        async: false,
        success: function (data) {
            if (!data || !data.renderId) {
                alert("Re-render did not return a renderId");
                return;
            }
            renderId = data.renderId;
            if (typeof data.pageCount === "number" && data.pageCount > 0) {
                renderPageCount = String(data.pageCount);
                numberOfPages = data.pageCount;
                let page0 = parseInt(renderPageNumber0, 10) || 0;
                if (page0 >= data.pageCount) {
                    renderPageNumber0 = String(data.pageCount - 1);
                    renderPageNumber = String(data.pageCount);
                }
            }
            lookupResults = [];
            if (typeof loadDrawSvgPage === "function") {
                loadDrawSvgPage();
            }
            if (typeof window.leanEdit !== "undefined" && typeof window.leanEdit.refresh === "function") {
                window.leanEdit.refresh(keepSelectionName);
            }
            // Refresh isolated component preview + error diagnostics if property panel is open
            if (document.body.classList.contains("property-panel-open")
                && keepSelectionName) {
                if (typeof loadComponentPreview === "function") {
                    loadComponentPreview(keepSelectionName, null);
                }
                if (typeof loadComponentDiagnostics === "function") {
                    loadComponentDiagnostics(keepSelectionName, null, null);
                }
            }
        },
        error: function (xhr) {
            console.warn("softReloadEditor failed, full navigation:", xhr.responseText);
            let page = typeof renderPageNumber0 !== "undefined" ? renderPageNumber0 : 0;
            window.open(
                API_BASE + "edit/presentation/" + encodeURIComponent(presentationName)
                    + "/page/" + page + "/?reload=true",
                "_self"
            );
        }
    });
}

function reloadPresentation() {
    if (isEditMode()) {
        softReloadEditor(
            typeof window.leanEdit !== "undefined" && window.leanEdit.getSelectedName
                ? window.leanEdit.getSelectedName()
                : oldComponentName
        );
        return;
    }
    let request = {
        "presentationName": presentationName,
        "parameters": parameterValues,
        "reload": true
    };
    $.ajax({
        url: API_BASE + "render/presentation/",
        type: "POST",
        data: JSON.stringify(request),
        contentType: "application/json; charset=utf-8",
        dataType: "text",
        success: function (newRenderId) {
            openPage(newRenderId);
        },
        error: function (request, status, error) {
            showAjaxError("Reload of presentation failed", request, status, error);
        },
        async: false
    });
}

/**
 * The save button is clicked when editing a component.
 * We're now going to find and evaluate the "componentSaveScript".
 *
 */
function saveComponent() {
    try {
        let saveScript = document.getElementById("componentSaveScript");
        eval(saveScript.innerHTML);

        // Normalize blanks written by form controls before persistence
        normalizeOptionalEmptyStrings(componentJson);

        // The values in 'component' and iComponent will have been modified.
        // logicalPageNumber / pageRole were captured when the editor was opened.
        //
        let pageIndex = (typeof editLogicalPageNumber === "number" && !isNaN(editLogicalPageNumber))
            ? editLogicalPageNumber
            : 0;
        let role = editPageRole || "page";

        let modifyComponentRequest = {
            "presentationName": presentationName,
            "oldComponentName": oldComponentName,
            "logicalPageNumber": pageIndex,
            "pageRole": role,
            "leanComponentJson": JSON.stringify(componentJson)
        };
        $.ajax({
            url: API_BASE + "metadata/modify/component/",
            type: "POST",
            data: JSON.stringify(modifyComponentRequest),
            contentType: "application/json; charset=utf-8",
            dataType: "text",
            async: false,
            success: () => {
                // Update name if renamed so further applies still find the component
                if (componentJson && componentJson["name"]) {
                    oldComponentName = componentJson["name"];
                }
                if (isEditMode()) {
                    softReloadEditor(oldComponentName);
                } else {
                    reloadPresentation();
                }
            },
            error: function (request, status, error) {
                showAjaxError("Save component failed", request, status, error);
            }
        });
    } catch (e) {
        showErrorDialog("Error saving component", e);
    }
}

function closeComponent() {
    setSidePanelOpen(false);
    // Drop the blue selection border when leaving the property editor
    if (typeof window.leanEdit !== "undefined"
        && typeof window.leanEdit.clearSelection === "function") {
        window.leanEdit.clearSelection();
    }
    oldComponentName = null;
}

/**
 * Open component property form by name (edit mode list / API path).
 * Uses GET edit/presentation/{name}/components/{componentName}/ then existing form HTML.
 */
function openComponentPropertiesByName(componentName) {
    if (!componentName || typeof presentationName === "undefined") {
        return;
    }
    $.ajax({
        url: API_BASE + "edit/presentation/" + encodeURIComponent(presentationName)
            + "/components/" + encodeURIComponent(componentName) + "/",
        type: "GET",
        dataType: "json",
        success: function (payload) {
            editComponent(payload, {
                renderId: typeof renderId !== "undefined" ? renderId : null,
                pageNumber: typeof renderPageNumber0 !== "undefined" ? renderPageNumber0 : 0
            });
        },
        error: function (xhr, status, error) {
            showAjaxError("Failed to load component '" + componentName + "'", xhr, status, error);
        }
    });
}

/**
 * URL for a connector type icon declared on {@code @LeanConnectorPlugin(image=...)} in lean-engine
 * (or another plugin JAR). Served by {@code GET plugins/connectors/{id}/image}.
 */
function connectorPluginIconUrl(pluginId) {
    if (!pluginId) {
        return API_BASE + "plugins/connectors/default/image";
    }
    return API_BASE + "plugins/connectors/" + encodeURIComponent(pluginId) + "/image";
}

/** @deprecated use connectorPluginIconUrl — kept for any leftover callers */
function connectorPluginIconFile(pluginId) {
    // No longer a filename under static/images; return full URL for convenience
    return connectorPluginIconUrl(pluginId);
}

/**
 * @returns {Object.<string, {id:string, name:string, description:string}>} by plugin id
 */
function getConnectorPluginInfoMap() {
    let byId = {};
    $.ajax({
        url: API_BASE + "plugins/connectors",
        type: "GET",
        dataType: "json",
        async: false,
        success: function (list) {
            if (!list) {
                return;
            }
            for (let i = 0; i < list.length; i++) {
                let p = list[i];
                let id = p.id || p.pluginId;
                if (!id) {
                    continue;
                }
                byId[id] = {
                    id: id,
                    name: p.name || id,
                    description: p.description || ""
                };
            }
        },
        error: function () {
            // leave empty; tooltips fall back to plugin id
        }
    });
    return byId;
}

/**
 * @returns {Array.<{name:string, pluginId:string|null, shared:boolean}>}
 */
function getConnectorSummaries() {
    let rows = [];
    $.ajax({
        url: API_BASE + "metadata/connectors/summary/",
        type: "GET",
        dataType: "json",
        async: false,
        success: function (list) {
            rows = list || [];
        },
        error: function () {
            // Fallback: names only (no icons/types)
            let names = getConnectorNames();
            for (let i = 0; i < names.length; i++) {
                if (names[i]) {
                    rows.push({name: names[i], pluginId: null, shared: false});
                }
            }
        }
    });
    return rows;
}

/**
 * Tooltip text: type name + description (plugin catalog).
 */
function connectorTypeTooltip(pluginId, pluginInfoMap) {
    let info = (pluginId && pluginInfoMap) ? pluginInfoMap[pluginId] : null;
    let typeLabel = info ? info.name : (pluginId || "Unknown type");
    let desc = info && info.description ? String(info.description).trim() : "";
    if (pluginId && typeLabel !== pluginId) {
        typeLabel = typeLabel + " (" + pluginId + ")";
    }
    // Use newline for multi-line native tooltips where supported
    if (desc) {
        return typeLabel + "\n" + desc;
    }
    return typeLabel;
}

/**
 * Open the side panel with a table of connector metadata elements.
 * Create controls at the top; each row has type icon, edit button, and delete icon.
 */
function editConnectorsList() {
    abortConnectorStudioRequests();
    let summaries = getConnectorSummaries();
    let pluginInfoMap = getConnectorPluginInfoMap();
    // Keep name cache warm for forms
    connectorNames = [""];
    for (let s = 0; s < summaries.length; s++) {
        if (summaries[s] && summaries[s].name) {
            connectorNames.push(summaries[s].name);
        }
    }

    let html = "<h3>Connectors</h3>";
    html += "<p class=\"editor-hint\">Select a connector to edit, or create a new one.</p>";

    // New connector controls at the top
    html += "<div class=\"connector-list-create\" id=\"connectorListCreate\">";
    html += "<label for=\"newConnectorPluginId\">New connector type</label> ";
    html += "<select id=\"newConnectorPluginId\" class=\"connector-list-type-select\"></select> ";
    html += "<button type=\"button\" class=\"connector-list-action-btn\" id=\"createConnectorBtn\">Create</button>";
    html += "</div>";

    html += "<div class=\"connector-list-table-wrap\">";
    html += "<table class=\"connector-list-table\" id=\"connectorListTable\">";
    html += "<thead><tr>"
        + "<th class=\"connector-list-col-icon\"></th>"
        + "<th>Name</th>"
        + "<th class=\"connector-list-col-actions\"></th>"
        + "</tr></thead>";
    html += "<tbody id=\"connectorListBody\">";
    let rowCount = 0;
    for (let i = 0; i < summaries.length; i++) {
        let row = summaries[i];
        let name = row && row.name;
        if (name === null || name === undefined || name === "") {
            continue;
        }
        rowCount++;
        let pluginId = row.pluginId || "";
        let iconUrl = connectorPluginIconUrl(pluginId);
        let tip = connectorTypeTooltip(pluginId, pluginInfoMap);
        // data-connector-name avoids broken onclick for names with spaces/quotes
        html += "<tr>";
        html += "<td class=\"connector-list-col-icon\">"
            + "<img class=\"connector-list-type-icon\" "
            + "src=\"" + escapeHtmlAttribute(iconUrl) + "\" "
            + "width=\"20\" height=\"20\" "
            + "alt=\"" + escapeHtmlAttribute(pluginId || "connector") + "\" "
            + "title=\"" + escapeHtmlAttribute(tip).replace(/\n/g, "&#10;") + "\">"
            + "</td>";
        html += "<td><button type=\"button\" class=\"connector-list-btn\" data-connector-name=\""
            + escapeHtmlAttribute(name) + "\" title=\"Edit connector\">"
            + escapeHtmlText(name) + "</button></td>";
        html += "<td class=\"connector-list-col-actions\">"
            + "<button type=\"button\" class=\"list-row-btn connector-list-delete-btn\" "
            + "data-connector-name=\"" + escapeHtmlAttribute(name) + "\" "
            + "title=\"Delete connector\">"
            + "<img src=\"" + API_BASE + "static/images/delete.svg\" alt=\"Delete\" "
            + "width=\"16\" height=\"16\"></button></td>";
        html += "</tr>";
    }
    if (rowCount === 0) {
        html += "<tr><td colspan=\"3\" class=\"connector-list-empty\">No connectors yet</td></tr>";
    }
    html += "</tbody></table></div>";

    html += "<div class=\"admin-list-actions\">";
    html += "<button type=\"button\" class=\"connector-list-action-btn\" id=\"closeConnectorListBtn\">Close</button>";
    html += "</div>";

    setSidePanelOpen(true, {withPreview: false});
    document.getElementById("editArea").innerHTML = html;

    let table = document.getElementById("connectorListTable");
    if (table) {
        table.addEventListener("click", function (e) {
            let delBtn = e.target.closest("button.connector-list-delete-btn");
            if (delBtn) {
                e.preventDefault();
                e.stopPropagation();
                let delName = delBtn.getAttribute("data-connector-name");
                if (delName) {
                    deleteConnectorByName(delName);
                }
                return;
            }
            let editBtn = e.target.closest("button.connector-list-btn");
            if (editBtn) {
                e.preventDefault();
                let editName = editBtn.getAttribute("data-connector-name");
                if (editName) {
                    editConnectorByName(editName);
                }
            }
        });
    }
    let createBtn = document.getElementById("createConnectorBtn");
    if (createBtn) {
        createBtn.onclick = function () {
            createNewConnector();
        };
    }
    let closeBtn = document.getElementById("closeConnectorListBtn");
    if (closeBtn) {
        closeBtn.onclick = function () {
            closeConnector();
        };
    }

    // Populate plugin type dropdown from plugins/connectors API
    loadConnectorPluginTypes("#newConnectorPluginId");
}

/**
 * Delete a shared connector after confirmation, then refresh the list.
 */
function deleteConnectorByName(name) {
    if (!name) {
        return;
    }
    let ok = window.confirm(
        "Delete connector \"" + name + "\"?\n\n"
        + "This cannot be undone. Presentations that use this connector may fail until reconfigured."
    );
    if (!ok) {
        return;
    }
    $.ajax({
        url: API_BASE + "metadata/connector/" + encodeURIComponent(name),
        type: "DELETE",
        dataType: "text",
        success: function () {
            connectorNames = null;
            // If we were editing this connector, clear form state
            if (oldConnectorName === name || (connectorJson && connectorJson.name === name)) {
                connectorJson = null;
                connectorPluginId = null;
                oldConnectorName = null;
            }
            editConnectorsList();
            if (typeof presentationName !== "undefined" && presentationName
                && typeof reloadPresentation === "function") {
                try {
                    reloadPresentation();
                } catch (e) {
                    console.warn("reloadPresentation after connector delete failed:", e);
                }
            }
        },
        error: function (xhr) {
            alert("Failed to delete connector '" + name + "': "
                + ((xhr && xhr.responseText) ? xhr.responseText : xhr.status));
        }
    });
}

/** Escape text for use inside an HTML attribute delimited by double quotes. */
function escapeHtmlAttribute(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

/** Escape text for use as HTML element text content. */
function escapeHtmlText(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function loadConnectorPluginTypes(selectSelector) {
    $.ajax({
        url: API_BASE + "plugins/connectors",
        type: "GET",
        dataType: "json",
        async: false,
        success: function (list) {
            let sel = $(selectSelector);
            sel.empty();
            if (!list || list.length === 0) {
                // Fallback known types (keep in sync with lean-engine LeanConnectorPlugin ids)
                list = [
                    {"id": "SqlConnector", "name": "SQL"},
                    {"id": "SampleDataConnector", "name": "Sample data"},
                    {"id": "SortConnector", "name": "Sort"},
                    {"id": "SelectionConnector", "name": "Select fields"},
                    {"id": "SimpleFilterConnector", "name": "Simple filter"},
                    {"id": "LeanRestConnector", "name": "REST"},
                    {"id": "LeanListConnector", "name": "List"},
                    {"id": "DistinctConnector", "name": "Select distinct rows"},
                    {"id": "PassthroughConnector", "name": "Passthrough"},
                    {"id": "ChainConnector", "name": "Chain connectors"}
                ];
            }
            for (let i = 0; i < list.length; i++) {
                let p = list[i];
                let id = p.id || p.pluginId;
                let name = p.name || id;
                sel.append($("<option></option>").attr("value", id).text(name + " (" + id + ")"));
            }
        },
        error: function () {
            let sel = $(selectSelector);
            sel.empty();
            ["SqlConnector", "SampleDataConnector", "SortConnector", "SelectionConnector",
                "SimpleFilterConnector", "LeanRestConnector", "LeanListConnector",
                "DistinctConnector", "PassthroughConnector", "ChainConnector"].forEach(function (id) {
                sel.append($("<option></option>").attr("value", id).text(id));
            });
        }
    });
}

function createNewConnector() {
    let pluginId = document.getElementById("newConnectorPluginId").value;
    if (!pluginId) {
        alert("Select a connector type");
        return;
    }
    let name = "New " + pluginId;
    connectorJson = {
        "name": name,
        "shared": false,
        "connector": {}
    };
    connectorJson["connector"][pluginId] = {"pluginId": pluginId};
    connectorPluginId = pluginId;
    oldConnectorName = null;
    openConnectorEditForm(pluginId);
}

/**
 * Load connector metadata by name and open the generated form for its plugin type.
 */
function editConnectorByName(name) {
    $.ajax({
        url: API_BASE + "metadata/connector-json/" + encodeURIComponent(name),
        type: "GET",
        dataType: "json",
        success: function (data) {
            connectorJson = data;
            oldConnectorName = data["name"] || name;
            // Hop metadata shape: connector.{PluginId}: { fields... }
            let nested = data["connector"] || {};
            let keys = Object.keys(nested);
            if (keys.length === 0) {
                alert("Connector has no plugin payload: " + name);
                return;
            }
            connectorPluginId = keys[0];
            openConnectorEditForm(connectorPluginId);
        },
        error: function (request) {
            alert("Failed to load connector '" + name + "': " + request.responseText);
        }
    });
}

/** Default sample size for connector studio Apply preview. */
const CONNECTOR_STUDIO_MAX_ROWS = 20;
/** Debounce delay (ms) for auto full preview after source changes. */
const CONNECTOR_STUDIO_PREVIEW_DEBOUNCE_MS = 200;

let connectorStudioPreviewXhr = null;
let connectorStudioInputXhr = null;
let connectorStudioPreviewTimer = null;
let connectorStudioPreviewSeq = 0;

function openConnectorEditForm(pluginId) {
    setSidePanelOpen(true, {withPreview: false, connectorStudio: true});
    connectorColumnListTables = [];
    connectorColumnSelects = [];
    abortConnectorStudioRequests();
    // Keep presentation connector/theme caches warm when possible; only clear if missing
    // so ensureFormMetadataCaches does less work under nested sync XHR.
    if (typeof ensureFormMetadataCaches === "function") {
        try {
            ensureFormMetadataCaches();
        } catch (e) {
            console.warn("ensureFormMetadataCaches before connector form:", e);
        }
    }
    $.ajax({
        url: API_BASE + "edit/connector/" + encodeURIComponent(pluginId) + "/",
        type: "GET",
        dataType: "html",
        success: function (snippet) {
            let editArea = document.getElementById("editArea");
            editArea.innerHTML = buildConnectorStudioShell(snippet);
            // Defer so sync XHR in init/load (describe columns, metadata lists) is not nested
            // inside this async AJAX success callback.
            setTimeout(function () {
                runFormScripts(pluginId || "connector");
                wireConnectorStudioListeners();
                // Immediate input sample if a source is already selected
                let sourceEl = document.getElementById("sourceConnectorName");
                let sourceName = sourceEl ? (sourceEl.value || "").trim() : "";
                if (sourceName) {
                    let inputPane = document.getElementById("connectorInputPane");
                    if (inputPane) {
                        inputPane.removeAttribute("hidden");
                    }
                    previewConnectorStudioInputSource(sourceName);
                }
                // Full input+output preview from form state
                applyConnectorPreview();
            }, 0);
        },
        error: function (request) {
            alert("Failed to open connector editor: " + request.responseText);
        }
    });
}

/**
 * Wrap generated connector form HTML in the studio shell:
 * input samples (top) → settings (middle) → output samples + errors (bottom).
 */
function buildConnectorStudioShell(settingsHtml) {
    return ""
        + '<div class="connector-studio" id="connectorStudio">'
        + '  <div class="connector-studio-toolbar">'
        + '    <label for="connectorStudioMaxRows">Sample rows </label>'
        + '    <select id="connectorStudioMaxRows" class="connector-studio-max-rows" title="Rows to fetch on Apply">'
        + '      <option value="10">10</option>'
        + '      <option value="20" selected>20</option>'
        + '      <option value="50">50</option>'
        + '      <option value="100">100</option>'
        + "    </select>"
        + '    <span class="connector-studio-status" id="connectorStudioStatus" aria-live="polite"></span>'
        + "  </div>"
        + '  <div class="connector-studio-pane connector-studio-input" id="connectorInputPane" hidden>'
        + '    <div class="connector-studio-pane-header">'
        + '      <span class="connector-studio-pane-title">Input</span>'
        + '      <span class="connector-studio-pane-meta" id="connectorInputMeta"></span>'
        + "    </div>"
        + '    <div class="connector-studio-sample" id="connectorInputSample">'
        + '      <p class="connector-studio-placeholder">Select a source connector to preview input rows</p>'
        + "    </div>"
        + '    <button type="button" class="connector-studio-layout-btn" id="connectorInputLayoutBtn"'
        + '            onclick="toggleConnectorLayoutDetails(\'input\')">Show layout details</button>'
        + '    <div class="connector-studio-layout" id="connectorInputLayout" hidden></div>'
        + "  </div>"
        + '  <div class="connector-studio-settings" id="connectorSettings">'
        + settingsHtml
        + "  </div>"
        + '  <div class="connector-studio-pane connector-studio-output" id="connectorOutputPane">'
        + '    <div class="connector-studio-pane-header">'
        + '      <span class="connector-studio-pane-title">Output</span>'
        + '      <span class="connector-studio-pane-meta" id="connectorOutputMeta"></span>'
        + "    </div>"
        + '    <div class="connector-studio-sample" id="connectorOutputSample">'
        + '      <p class="connector-studio-placeholder">Apply to load output sample rows</p>'
        + "    </div>"
        + '    <button type="button" class="connector-studio-layout-btn" id="connectorOutputLayoutBtn"'
        + '            onclick="toggleConnectorLayoutDetails(\'output\')">Show layout details</button>'
        + '    <div class="connector-studio-layout" id="connectorOutputLayout" hidden></div>'
        + "  </div>"
        + '  <div class="connector-studio-error" id="connectorStudioError" hidden>'
        + '    <div class="connector-studio-error-header">'
        + '      <strong>Error</strong>'
        + '      <button type="button" class="connector-studio-error-toggle" id="connectorStudioErrorToggle"'
        + '              onclick="toggleConnectorStudioErrorDetail()">Details</button>'
        + "    </div>"
        + '    <div class="connector-studio-error-summary" id="connectorStudioErrorSummary"></div>'
        + '    <pre class="connector-studio-error-detail" id="connectorStudioErrorDetail" hidden></pre>'
        + "  </div>"
        + "</div>";
}

/**
 * Wire studio behaviour after the generated form scripts run.
 * Source connector changes immediately show the input pane + sample.
 */
function wireConnectorStudioListeners() {
    let sourceEl = document.getElementById("sourceConnectorName");
    if (sourceEl && !sourceEl._leanStudioWired) {
        sourceEl._leanStudioWired = true;
        sourceEl.addEventListener("change", function () {
            onConnectorStudioSourceChanged();
        });
    }
    let maxEl = document.getElementById("connectorStudioMaxRows");
    if (maxEl && !maxEl._leanStudioWired) {
        maxEl._leanStudioWired = true;
        maxEl.addEventListener("change", function () {
            scheduleConnectorPreview(CONNECTOR_STUDIO_PREVIEW_DEBOUNCE_MS);
        });
    }
}

/**
 * User picked/cleared Source connector: show/hide input pane and load input samples now;
 * also schedule a full Apply so output stays consistent.
 */
function onConnectorStudioSourceChanged() {
    let sourceEl = document.getElementById("sourceConnectorName");
    let sourceName = sourceEl ? (sourceEl.value || "").trim() : "";
    let inputPane = document.getElementById("connectorInputPane");

    if (!sourceName) {
        if (inputPane) {
            inputPane.setAttribute("hidden", "hidden");
        }
        clearConnectorStudioSide("input");
        abortConnectorStudioInputRequest();
        // Still refresh output (source may no longer apply)
        scheduleConnectorPreview(CONNECTOR_STUDIO_PREVIEW_DEBOUNCE_MS);
        return;
    }

    if (inputPane) {
        inputPane.removeAttribute("hidden");
    }
    // Immediate input sample from the selected source (does not wait for full transform)
    previewConnectorStudioInputSource(sourceName);
    // Debounced full preview updates output (and reconciles input from the same request)
    scheduleConnectorPreview(CONNECTOR_STUDIO_PREVIEW_DEBOUNCE_MS);
}

function getConnectorStudioMaxRows() {
    let el = document.getElementById("connectorStudioMaxRows");
    if (el && el.value) {
        let n = parseInt(el.value, 10);
        if (!isNaN(n) && n > 0) {
            return Math.min(100, n);
        }
    }
    return CONNECTOR_STUDIO_MAX_ROWS;
}

function setConnectorStudioStatus(text) {
    let el = document.getElementById("connectorStudioStatus");
    if (el) {
        el.textContent = text || "";
    }
}

function abortConnectorStudioInputRequest() {
    if (connectorStudioInputXhr && connectorStudioInputXhr.readyState !== 4) {
        try {
            connectorStudioInputXhr.abort();
        } catch (e) { /* ignore */ }
    }
    connectorStudioInputXhr = null;
}

function abortConnectorStudioPreviewRequest() {
    if (connectorStudioPreviewXhr && connectorStudioPreviewXhr.readyState !== 4) {
        try {
            connectorStudioPreviewXhr.abort();
        } catch (e) { /* ignore */ }
    }
    connectorStudioPreviewXhr = null;
}

function abortConnectorStudioRequests() {
    if (connectorStudioPreviewTimer) {
        clearTimeout(connectorStudioPreviewTimer);
        connectorStudioPreviewTimer = null;
    }
    abortConnectorStudioInputRequest();
    abortConnectorStudioPreviewRequest();
    setConnectorStudioBusy(false);
    setConnectorStudioStatus("");
}

/**
 * Load sample rows for a named source connector into the INPUT pane only.
 */
function previewConnectorStudioInputSource(sourceName) {
    if (!sourceName) {
        return;
    }
    abortConnectorStudioInputRequest();
    setConnectorStudioMeta("input", sourceName + " | loading...");
    let sampleEl = document.getElementById("connectorInputSample");
    if (sampleEl) {
        sampleEl.innerHTML = '<p class="connector-studio-placeholder">Loading input sample...</p>';
    }

    let seq = ++connectorStudioPreviewSeq;
    connectorStudioInputXhr = $.ajax({
        url: API_BASE + "metadata/connector-json/" + encodeURIComponent(sourceName),
        type: "GET",
        dataType: "json",
        success: function (data) {
            if (!data) {
                return;
            }
            let body = {
                leanConnectorJson: JSON.stringify(data),
                maxRows: getConnectorStudioMaxRows()
            };
            if (typeof renderId !== "undefined" && renderId) {
                body.renderId = renderId;
            }
            connectorStudioInputXhr = $.ajax({
                url: API_BASE + "edit/connector/preview/",
                type: "POST",
                data: JSON.stringify(body),
                contentType: "application/json; charset=utf-8",
                dataType: "json",
                success: function (result) {
                    // Ignore stale responses if a newer preview finished
                    if (seq < connectorStudioPreviewSeq - 1) {
                        return;
                    }
                    let inputPane = document.getElementById("connectorInputPane");
                    if (inputPane) {
                        inputPane.removeAttribute("hidden");
                    }
                    if (result && result.output) {
                        // Source connector's output is this transform's input
                        let side = result.output;
                        side.connectorName = sourceName;
                        renderConnectorStudioSide("input", side);
                    } else if (result && result.error) {
                        renderConnectorStudioSide("input", {
                            connectorName: sourceName,
                            rowMeta: [],
                            rows: [],
                            errorSummary: result.error.summary || "Could not sample source",
                            errorDetail: result.error.detail
                        });
                    }
                },
                error: function (xhr, status) {
                    if (status === "abort") {
                        return;
                    }
                    setConnectorStudioMeta("input", sourceName);
                    if (sampleEl) {
                        sampleEl.innerHTML = '<p class="connector-studio-placeholder connector-studio-side-error">'
                            + "Failed to load input sample</p>";
                    }
                }
            });
        },
        error: function (xhr, status) {
            if (status === "abort") {
                return;
            }
            setConnectorStudioMeta("input", sourceName);
            if (sampleEl) {
                sampleEl.innerHTML = '<p class="connector-studio-placeholder connector-studio-side-error">'
                    + "Could not load source connector '" + escapeHtmlText(sourceName) + "'</p>";
            }
        }
    });
}

/**
 * Pull form values into {@code connectorJson} via the generated save script (does not persist).
 * @returns {boolean} true if sync succeeded
 */
function syncConnectorJsonFromForm() {
    try {
        let saveScript = document.getElementById("connectorSaveScript");
        if (saveScript) {
            eval(saveScript.innerHTML);
        }
        return true;
    } catch (e) {
        showConnectorStudioError("Could not read form values", String(e));
        return false;
    }
}

/**
 * Schedule a full input+output preview after {@code delayMs} (cancels previous timer).
 */
function scheduleConnectorPreview(delayMs) {
    if (connectorStudioPreviewTimer) {
        clearTimeout(connectorStudioPreviewTimer);
    }
    connectorStudioPreviewTimer = setTimeout(function () {
        connectorStudioPreviewTimer = null;
        applyConnectorPreview();
    }, typeof delayMs === "number" ? delayMs : CONNECTOR_STUDIO_PREVIEW_DEBOUNCE_MS);
}

/**
 * Apply: refresh input/output sample tables from current form state (no metadata write).
 */
function applyConnectorPreview() {
    if (!syncConnectorJsonFromForm()) {
        return;
    }
    if (!connectorJson) {
        showConnectorStudioError("No connector data to preview", "connectorJson is not set");
        return;
    }
    abortConnectorStudioPreviewRequest();
    setConnectorStudioBusy(true);
    setConnectorStudioStatus("Previewing...");
    clearConnectorStudioError();

    let body = {
        leanConnectorJson: JSON.stringify(connectorJson),
        maxRows: getConnectorStudioMaxRows()
    };
    if (typeof renderId !== "undefined" && renderId) {
        body.renderId = renderId;
    }

    let seq = ++connectorStudioPreviewSeq;
    connectorStudioPreviewXhr = $.ajax({
        url: API_BASE + "edit/connector/preview/",
        type: "POST",
        data: JSON.stringify(body),
        contentType: "application/json; charset=utf-8",
        dataType: "json",
        success: function (result) {
            if (seq !== connectorStudioPreviewSeq) {
                return; // superseded
            }
            setConnectorStudioBusy(false);
            setConnectorStudioStatus("Updated");
            renderConnectorStudioPreview(result);
            // Clear status after a moment
            setTimeout(function () {
                if (seq === connectorStudioPreviewSeq) {
                    setConnectorStudioStatus("");
                }
            }, 1500);
        },
        error: function (xhr, status) {
            if (status === "abort") {
                return;
            }
            if (seq !== connectorStudioPreviewSeq) {
                return;
            }
            setConnectorStudioBusy(false);
            setConnectorStudioStatus("");
            let msg = (xhr && xhr.responseText) ? xhr.responseText : "Preview request failed";
            showConnectorStudioError("Preview request failed", msg);
            clearConnectorStudioSide("output");
        }
    });
}

/**
 * Save: persist connector metadata (and soft-reload presentation when in the editor).
 */
function saveConnector() {
    try {
        if (!syncConnectorJsonFromForm()) {
            return;
        }
        let request = {
            "oldConnectorName": oldConnectorName,
            "leanConnectorJson": JSON.stringify(connectorJson)
        };
        $.ajax({
            url: API_BASE + "metadata/modify/connector/",
            type: "POST",
            data: JSON.stringify(request),
            contentType: "application/json; charset=utf-8",
            dataType: "text",
            async: false,
            success: function (savedName) {
                oldConnectorName = savedName;
                connectorNames = null; // refresh cache
                // Soft-reload presentation so components pick up connector changes
                if (typeof presentationName !== "undefined" && presentationName
                    && typeof reloadPresentation === "function") {
                    try {
                        reloadPresentation();
                        return;
                    } catch (e) {
                        console.warn("reloadPresentation after connector save failed:", e);
                    }
                }
                alert("Connector saved: " + savedName);
            },
            error: function (request) {
                alert("Save connector failed: " + request.responseText);
            }
        });
    } catch (e) {
        alert("Error saving connector: " + e);
    }
}

function closeConnector() {
    abortConnectorStudioRequests();
    connectorJson = null;
    connectorPluginId = null;
    oldConnectorName = null;
    setSidePanelOpen(false);
}

// ---------------------------------------------------------------------------
// Connector studio: sample tables, layout details, errors
// ---------------------------------------------------------------------------

function setConnectorStudioBusy(busy) {
    let studio = document.getElementById("connectorStudio");
    if (!studio) {
        return;
    }
    // Soft busy: dim sample panes only so settings stay editable while preview runs
    let samples = studio.querySelectorAll(".connector-studio-sample");
    for (let i = 0; i < samples.length; i++) {
        if (busy) {
            samples[i].classList.add("is-busy");
        } else {
            samples[i].classList.remove("is-busy");
        }
    }
    if (busy) {
        studio.classList.add("is-previewing");
    } else {
        studio.classList.remove("is-previewing");
    }
}

function renderConnectorStudioPreview(result) {
    if (!result) {
        showConnectorStudioError("Empty preview response", "");
        return;
    }

    // Input pane: show only when we have input data or an input-related failure with source
    let hasInput = result.input
        && (result.input.rowMeta || (result.input.rows && result.input.rows.length)
            || result.input.errorSummary);
    // Also show input pane if form has a source connector selected (even before first successful sample)
    let sourceEl = document.getElementById("sourceConnectorName");
    let sourceName = sourceEl ? (sourceEl.value || "").trim() : "";
    let showInput = hasInput || !!sourceName;

    let inputPane = document.getElementById("connectorInputPane");
    if (inputPane) {
        if (showInput) {
            inputPane.removeAttribute("hidden");
            if (result.input) {
                renderConnectorStudioSide("input", result.input);
            } else {
                clearConnectorStudioSide("input");
                setConnectorStudioMeta("input", sourceName ? ("source: " + sourceName) : "");
            }
        } else {
            inputPane.setAttribute("hidden", "hidden");
            clearConnectorStudioSide("input");
        }
    }

    if (result.output) {
        renderConnectorStudioSide("output", result.output);
    } else {
        clearConnectorStudioSide("output");
    }

    if (result.ok === false && result.error) {
        showConnectorStudioError(
            result.error.summary || "Preview failed",
            result.error.detail || result.error.summary || ""
        );
    } else {
        clearConnectorStudioError();
    }
}

function renderConnectorStudioSide(which, side) {
    let sampleEl = document.getElementById(
        which === "input" ? "connectorInputSample" : "connectorOutputSample");
    let layoutEl = document.getElementById(
        which === "input" ? "connectorInputLayout" : "connectorOutputLayout");
    if (!sampleEl) {
        return;
    }

    let rowMeta = side.rowMeta || [];
    let rows = side.rows || [];
    let metaParts = [];
    if (side.connectorName) {
        metaParts.push(side.connectorName);
    }
    if (typeof side.rowCountReturned === "number") {
        metaParts.push(side.rowCountReturned + " row(s)");
    }
    if (side.truncated) {
        metaParts.push("truncated");
    }
    setConnectorStudioMeta(which, metaParts.join(" | "));

    if (side.errorSummary && (!rows || !rows.length)) {
        sampleEl.innerHTML = '<p class="connector-studio-placeholder connector-studio-side-error">'
            + escapeHtmlText(side.errorSummary) + "</p>";
    } else if (!rows || !rows.length) {
        if (rowMeta && rowMeta.length) {
            sampleEl.innerHTML = '<p class="connector-studio-placeholder">No sample rows '
                + "(layout available via Show layout details)</p>";
        } else {
            sampleEl.innerHTML = '<p class="connector-studio-placeholder">No sample rows</p>';
        }
    } else {
        sampleEl.innerHTML = buildConnectorSampleTableHtml(rowMeta, rows);
    }

    if (layoutEl) {
        // Preserve expand/collapse state across Apply refreshes
        let wasOpen = !layoutEl.hasAttribute("hidden");
        layoutEl.innerHTML = buildConnectorLayoutTableHtml(rowMeta);
        let btn = document.getElementById(
            which === "input" ? "connectorInputLayoutBtn" : "connectorOutputLayoutBtn");
        if (wasOpen) {
            layoutEl.removeAttribute("hidden");
            if (btn) {
                btn.textContent = "Hide layout details";
            }
        } else {
            layoutEl.setAttribute("hidden", "hidden");
            if (btn) {
                btn.textContent = "Show layout details";
            }
        }
    }
}

function setConnectorStudioMeta(which, text) {
    let el = document.getElementById(
        which === "input" ? "connectorInputMeta" : "connectorOutputMeta");
    if (el) {
        el.textContent = text || "";
    }
}

function clearConnectorStudioSide(which) {
    let sampleEl = document.getElementById(
        which === "input" ? "connectorInputSample" : "connectorOutputSample");
    let layoutEl = document.getElementById(
        which === "input" ? "connectorInputLayout" : "connectorOutputLayout");
    if (sampleEl) {
        sampleEl.innerHTML = '<p class="connector-studio-placeholder">-</p>';
    }
    if (layoutEl) {
        layoutEl.innerHTML = "";
        layoutEl.setAttribute("hidden", "hidden");
    }
    let btn = document.getElementById(
        which === "input" ? "connectorInputLayoutBtn" : "connectorOutputLayoutBtn");
    if (btn) {
        btn.textContent = "Show layout details";
    }
    setConnectorStudioMeta(which, "");
}

function buildConnectorSampleTableHtml(rowMeta, rows) {
    let cols = rowMeta && rowMeta.length
        ? rowMeta
        : (rows[0] || []).map(function (_, i) {
            return {name: "c" + i, type: ""};
        });
    let html = '<div class="connector-studio-table-wrap"><table class="connector-studio-table">';
    html += "<thead><tr>";
    for (let c = 0; c < cols.length; c++) {
        let name = cols[c].name || ("#" + c);
        html += "<th>" + escapeHtmlText(name) + "</th>";
    }
    html += "</tr></thead><tbody>";
    for (let r = 0; r < rows.length; r++) {
        html += "<tr>";
        let row = rows[r] || [];
        for (let c = 0; c < cols.length; c++) {
            let cell = c < row.length ? row[c] : "";
            if (cell === null || cell === undefined) {
                cell = "";
            }
            html += "<td>" + escapeHtmlText(String(cell)) + "</td>";
        }
        html += "</tr>";
    }
    html += "</tbody></table></div>";
    return html;
}

function buildConnectorLayoutTableHtml(rowMeta) {
    if (!rowMeta || !rowMeta.length) {
        return '<p class="connector-studio-placeholder">No layout (row meta) available</p>';
    }
    let html = '<div class="connector-studio-table-wrap"><table class="connector-studio-table connector-studio-layout-table">';
    html += "<thead><tr><th>Name</th><th>Type</th><th>Length</th><th>Precision</th></tr></thead><tbody>";
    for (let i = 0; i < rowMeta.length; i++) {
        let v = rowMeta[i] || {};
        html += "<tr>"
            + "<td>" + escapeHtmlText(v.name || "") + "</td>"
            + "<td>" + escapeHtmlText(v.type || "") + "</td>"
            + "<td>" + escapeHtmlText(String(v.length !== undefined && v.length !== null ? v.length : "")) + "</td>"
            + "<td>" + escapeHtmlText(String(v.precision !== undefined && v.precision !== null ? v.precision : "")) + "</td>"
            + "</tr>";
    }
    html += "</tbody></table></div>";
    return html;
}

/**
 * Toggle layout details for input or output pane.
 * @param {"input"|"output"} which
 */
function toggleConnectorLayoutDetails(which) {
    let layoutEl = document.getElementById(
        which === "input" ? "connectorInputLayout" : "connectorOutputLayout");
    let btn = document.getElementById(
        which === "input" ? "connectorInputLayoutBtn" : "connectorOutputLayoutBtn");
    if (!layoutEl) {
        return;
    }
    if (layoutEl.hasAttribute("hidden")) {
        layoutEl.removeAttribute("hidden");
        if (btn) {
            btn.textContent = "Hide layout details";
        }
    } else {
        layoutEl.setAttribute("hidden", "hidden");
        if (btn) {
            btn.textContent = "Show layout details";
        }
    }
}

function showConnectorStudioError(summary, detail) {
    let panel = document.getElementById("connectorStudioError");
    if (!panel) {
        // Studio shell not present (e.g. early failure)
        console.warn("connector studio error:", summary, detail);
        return;
    }
    let summaryEl = document.getElementById("connectorStudioErrorSummary");
    let detailEl = document.getElementById("connectorStudioErrorDetail");
    let toggle = document.getElementById("connectorStudioErrorToggle");
    if (summaryEl) {
        summaryEl.textContent = summary || "Error";
    }
    if (detailEl) {
        detailEl.textContent = detail || summary || "";
        detailEl.setAttribute("hidden", "hidden");
    }
    if (toggle) {
        toggle.textContent = "Details";
        // Auto-expand when multi-line detail
        if (detail && detail !== summary && detail.indexOf("\n") >= 0) {
            detailEl.removeAttribute("hidden");
            toggle.textContent = "Hide details";
        }
    }
    panel.removeAttribute("hidden");
}

function clearConnectorStudioError() {
    let panel = document.getElementById("connectorStudioError");
    if (!panel) {
        return;
    }
    panel.setAttribute("hidden", "hidden");
    let summaryEl = document.getElementById("connectorStudioErrorSummary");
    let detailEl = document.getElementById("connectorStudioErrorDetail");
    if (summaryEl) {
        summaryEl.textContent = "";
    }
    if (detailEl) {
        detailEl.textContent = "";
        detailEl.setAttribute("hidden", "hidden");
    }
}

function toggleConnectorStudioErrorDetail() {
    let detailEl = document.getElementById("connectorStudioErrorDetail");
    let toggle = document.getElementById("connectorStudioErrorToggle");
    if (!detailEl) {
        return;
    }
    if (detailEl.hasAttribute("hidden")) {
        detailEl.removeAttribute("hidden");
        if (toggle) {
            toggle.textContent = "Hide details";
        }
    } else {
        detailEl.setAttribute("hidden", "hidden");
        if (toggle) {
            toggle.textContent = "Details";
        }
    }
}

// ---------------------------------------------------------------------------
// Database connection administration (LeanDatabaseConnection metadata)
// ---------------------------------------------------------------------------

const DB_CONNECTION_METADATA_KEY = "lean-database-connection";
let databaseConnectionNames = null;
let oldDatabaseConnectionName = null;
let databaseConnectionJson = null;

/**
 * Open the side panel with a list of Lean Database Connection metadata elements.
 */
function editDatabaseConnectionsList() {
    databaseConnectionNames = getDatabaseConnectionNames();
    let html = "<h3>Database connections</h3>";
    html += "<p class=\"editor-hint\">Manage <code>LeanDatabaseConnection</code> metadata "
        + "(used by SQL connectors and data sources).</p>";
    html += "<ul id=\"databaseConnectionList\" class=\"admin-metadata-list\">";
    for (let i = 0; i < databaseConnectionNames.length; i++) {
        let name = databaseConnectionNames[i];
        if (name === null || name === "") {
            continue;
        }
        html += "<li><button type=\"button\" class=\"admin-list-btn\" data-db-name=\""
            + escapeHtmlAttribute(name) + "\">" + escapeHtmlText(name) + "</button></li>";
    }
    html += "</ul>";
    html += "<div class=\"admin-list-actions\">";
    html += "<button type=\"button\" id=\"createDatabaseConnectionBtn\" class=\"home-btn home-btn-primary\">New connection</button> ";
    html += "<button type=\"button\" id=\"closeDatabaseConnectionListBtn\" class=\"home-btn\">Close</button>";
    html += "</div>";

    setSidePanelOpen(true, {withPreview: false});
    document.getElementById("editArea").innerHTML = html;

    let list = document.getElementById("databaseConnectionList");
    if (list) {
        list.addEventListener("click", function (e) {
            let btn = e.target.closest("button.admin-list-btn");
            if (!btn) {
                return;
            }
            e.preventDefault();
            let name = btn.getAttribute("data-db-name");
            if (name) {
                editDatabaseConnectionByName(name);
            }
        });
    }
    let createBtn = document.getElementById("createDatabaseConnectionBtn");
    if (createBtn) {
        createBtn.onclick = function () {
            createNewDatabaseConnection();
        };
    }
    let closeBtn = document.getElementById("closeDatabaseConnectionListBtn");
    if (closeBtn) {
        closeBtn.onclick = function () {
            closeDatabaseConnection();
        };
    }
}

function getDatabaseConnectionNames() {
    let names = [];
    $.ajax({
        url: API_BASE + "metadata/list/" + DB_CONNECTION_METADATA_KEY + "/",
        type: "GET",
        dataType: "json",
        async: false,
        success: function (list) {
            names = list || [];
        },
        error: function (xhr) {
            console.warn("Failed to list database connections:", xhr.responseText || xhr.status);
        }
    });
    return names;
}

function getDatabaseTypeCodes() {
    let types = [];
    $.ajax({
        url: API_BASE + "metadata/database-types",
        type: "GET",
        dataType: "json",
        async: false,
        success: function (list) {
            types = list || [];
        },
        error: function () {
            types = [
                {id: "POSTGRESQL", name: "PostgreSQL"},
                {id: "MYSQL", name: "MySQL"},
                {id: "H2", name: "H2"},
                {id: "ORACLE", name: "Oracle"},
                {id: "MSSQL", name: "MS SQL Server"},
                {id: "GENERIC", name: "Generic"}
            ];
        }
    });
    return types;
}

function createNewDatabaseConnection() {
    oldDatabaseConnectionName = null;
    databaseConnectionJson = {
        name: "New connection",
        databaseTypeCode: "POSTGRESQL",
        hostname: "localhost",
        port: "5432",
        databaseName: "",
        username: "",
        password: ""
    };
    openDatabaseConnectionForm(databaseConnectionJson);
}

function editDatabaseConnectionByName(name) {
    $.ajax({
        url: API_BASE + "metadata/" + DB_CONNECTION_METADATA_KEY + "/" + encodeURIComponent(name),
        type: "GET",
        dataType: "json",
        success: function (data) {
            databaseConnectionJson = data || {};
            oldDatabaseConnectionName = data["name"] || name;
            openDatabaseConnectionForm(databaseConnectionJson);
        },
        error: function (xhr) {
            alert("Failed to load database connection '" + name + "': "
                + (xhr.responseText || xhr.status));
        }
    });
}

function openDatabaseConnectionForm(json) {
    setSidePanelOpen(true, {withPreview: false});
    let types = getDatabaseTypeCodes();
    let typeCode = json["databaseTypeCode"] || "POSTGRESQL";
    let html = "";
    html += "<div class=\"form-action-bar\">";
    html += "<button type=\"button\" id=\"dbConnSaveBtn\" title=\"Save connection\">Apply</button>";
    html += "<button type=\"button\" id=\"dbConnTestBtn\" title=\"Test connection\">Test</button>";
    html += "<button type=\"button\" id=\"dbConnDeleteBtn\" title=\"Delete connection\">Delete</button>";
    html += "<button type=\"button\" id=\"dbConnBackBtn\" title=\"Back to list\">Back</button>";
    html += "<button type=\"button\" id=\"dbConnCloseBtn\" title=\"Close panel\">Close</button>";
    html += "</div>";
    html += "<h3>Database connection</h3>";
    html += "<label for=\"dbConnName\">Name: </label>";
    html += "<input type=\"text\" id=\"dbConnName\" style=\"width:90%\" value=\""
        + escapeHtmlAttribute(json["name"] || "") + "\"><br><br>";
    html += "<label for=\"dbConnType\">Database type: </label>";
    html += "<select id=\"dbConnType\" style=\"width:70%\">";
    for (let i = 0; i < types.length; i++) {
        let t = types[i];
        let id = t.id || t;
        let label = t.name || id;
        let sel = (String(id) === String(typeCode)) ? " selected" : "";
        html += "<option value=\"" + escapeHtmlAttribute(id) + "\"" + sel + ">"
            + escapeHtmlText(label) + " (" + escapeHtmlText(id) + ")</option>";
    }
    html += "</select><br><br>";
    html += "<label for=\"dbConnHost\">Hostname: </label>";
    html += "<input type=\"text\" id=\"dbConnHost\" style=\"width:70%\" value=\""
        + escapeHtmlAttribute(json["hostname"] || "") + "\"><br><br>";
    html += "<label for=\"dbConnPort\">Port: </label>";
    html += "<input type=\"text\" id=\"dbConnPort\" style=\"width:30%\" value=\""
        + escapeHtmlAttribute(json["port"] || "") + "\"><br><br>";
    html += "<label for=\"dbConnDatabase\">Database name / path: </label>";
    html += "<input type=\"text\" id=\"dbConnDatabase\" style=\"width:90%\" value=\""
        + escapeHtmlAttribute(json["databaseName"] || "") + "\"><br><br>";
    html += "<label for=\"dbConnUser\">Username: </label>";
    html += "<input type=\"text\" id=\"dbConnUser\" style=\"width:50%\" value=\""
        + escapeHtmlAttribute(json["username"] || "") + "\" autocomplete=\"off\"><br><br>";
    html += "<label for=\"dbConnPassword\">Password: </label>";
    html += "<input type=\"password\" id=\"dbConnPassword\" style=\"width:50%\" value=\""
        + escapeHtmlAttribute(json["password"] || "") + "\" autocomplete=\"new-password\"><br>";
    html += "<p class=\"editor-hint\">Leave password blank only if you intend an empty password. "
        + "Encrypted values from Hop are re-saved as-is unless changed.</p>";
    html += "<p id=\"dbConnStatus\" class=\"editor-hint\"></p>";

    document.getElementById("editArea").innerHTML = html;

    document.getElementById("dbConnSaveBtn").onclick = function () {
        saveDatabaseConnection();
    };
    document.getElementById("dbConnTestBtn").onclick = function () {
        testDatabaseConnection();
    };
    document.getElementById("dbConnDeleteBtn").onclick = function () {
        deleteDatabaseConnection();
    };
    document.getElementById("dbConnBackBtn").onclick = function () {
        editDatabaseConnectionsList();
    };
    document.getElementById("dbConnCloseBtn").onclick = function () {
        closeDatabaseConnection();
    };
    // Hide delete for brand-new unsaved connections
    if (!oldDatabaseConnectionName) {
        document.getElementById("dbConnDeleteBtn").disabled = true;
    }
}

function collectDatabaseConnectionForm() {
    return {
        name: (document.getElementById("dbConnName").value || "").trim(),
        databaseTypeCode: document.getElementById("dbConnType").value,
        hostname: (document.getElementById("dbConnHost").value || "").trim(),
        port: (document.getElementById("dbConnPort").value || "").trim(),
        databaseName: (document.getElementById("dbConnDatabase").value || "").trim(),
        username: (document.getElementById("dbConnUser").value || "").trim(),
        password: document.getElementById("dbConnPassword").value || ""
    };
}

function saveDatabaseConnection() {
    let body = collectDatabaseConnectionForm();
    if (!body.name) {
        alert("Name is required");
        return;
    }
    let status = document.getElementById("dbConnStatus");
    if (status) {
        status.textContent = "Saving...";
    }
    // Rename: delete old name after save if changed
    let previousName = oldDatabaseConnectionName;
    $.ajax({
        url: API_BASE + "metadata/" + DB_CONNECTION_METADATA_KEY + "/",
        type: "POST",
        contentType: "application/json; charset=utf-8",
        data: JSON.stringify(body),
        dataType: "text",
        success: function (savedName) {
            if (previousName && previousName !== savedName) {
                $.ajax({
                    url: API_BASE + "metadata/" + DB_CONNECTION_METADATA_KEY + "/"
                        + encodeURIComponent(previousName),
                    type: "DELETE",
                    dataType: "text",
                    async: false
                });
            }
            oldDatabaseConnectionName = savedName;
            databaseConnectionNames = null;
            if (status) {
                status.textContent = "Saved: " + savedName;
            }
            // Re-enable delete after first save
            let del = document.getElementById("dbConnDeleteBtn");
            if (del) {
                del.disabled = false;
            }
        },
        error: function (xhr) {
            if (status) {
                status.textContent = "";
            }
            alert("Save failed: " + (xhr.responseText || xhr.status));
        }
    });
}

function testDatabaseConnection() {
    let body = collectDatabaseConnectionForm();
    if (!body.name) {
        body.name = "test";
    }
    let status = document.getElementById("dbConnStatus");
    if (status) {
        status.textContent = "Testing...";
    }
    $.ajax({
        url: API_BASE + "metadata/database-connection/test/",
        type: "POST",
        contentType: "application/json; charset=utf-8",
        data: JSON.stringify(body),
        dataType: "text",
        success: function (msg) {
            if (status) {
                status.textContent = msg;
            } else {
                alert(msg);
            }
        },
        error: function (xhr) {
            let msg = xhr.responseText || xhr.status;
            if (status) {
                status.textContent = "Test failed: " + msg;
            } else {
                alert("Test failed: " + msg);
            }
        }
    });
}

function deleteDatabaseConnection() {
    let name = oldDatabaseConnectionName
        || (document.getElementById("dbConnName")
            ? document.getElementById("dbConnName").value.trim()
            : "");
    if (!name) {
        alert("Nothing to delete");
        return;
    }
    if (!confirm("Delete database connection '" + name + "'?")) {
        return;
    }
    $.ajax({
        url: API_BASE + "metadata/" + DB_CONNECTION_METADATA_KEY + "/" + encodeURIComponent(name),
        type: "DELETE",
        dataType: "text",
        success: function () {
            databaseConnectionNames = null;
            oldDatabaseConnectionName = null;
            editDatabaseConnectionsList();
        },
        error: function (xhr) {
            alert("Delete failed: " + (xhr.responseText || xhr.status));
        }
    });
}

function closeDatabaseConnection() {
    databaseConnectionJson = null;
    oldDatabaseConnectionName = null;
    setSidePanelOpen(false);
}

function toInteger(value) {
    if (value === null) {
        return null;
    }
    return parseInt(value);
}

function setFont(iComponent, jsonId, setId, idPrefix) {
    try {
        let srcFont = iComponent[jsonId];
        if (srcFont !== null) {
            document.getElementById(setId).checked = true;
            document.getElementById(idPrefix + "Name").value = srcFont["fontName"];
            document.getElementById(idPrefix + "Size").value = srcFont["fontSize"];
            document.getElementById(idPrefix + "Bold").checked = srcFont["bold"];
            document.getElementById(idPrefix + "Italic").checked = srcFont["italic"];
        }
    } catch (e) {
        throw "Error setting font data for jsonId='" + jsonId + "', setId='" + setId + "', idPrefix='" + idPrefix + " : " + e;
    }
}

function getFont(iComponent, jsonId, setId, idPrefix) {
    let font = null;
    if (document.getElementById(setId).checked) {
        font = {
            "fontName": document.getElementById(idPrefix + "Name").value,
            "fontSize": toInteger(document.getElementById(idPrefix + "Size").value),
            "bold": document.getElementById(idPrefix + "Bold").checked,
            "italic": document.getElementById(idPrefix + "Italic").checked
        };
    }
    iComponent[jsonId] = font;
}

function setColor(iComponent, jsonId, setId, colorId, defaultColor) {
    try {
        let color = iComponent[jsonId];
        if (color !== null && color !== undefined) {
            document.getElementById(setId).checked = true;
            document.getElementById(colorId).value = rgbToHex(color["r"], color["g"], color["b"]);
        } else {
            document.getElementById(colorId).value = defaultColor;
        }
        // If we have this flag in the component plugin JSON, set the checkbox.
        //
        let flag = iComponent[setId];
        if (flag !== null && flag !== undefined) {
            document.getElementById(setId).checked = flag;
        }
    } catch (e) {
        throw "Error setting color data for jsonId='" + jsonId
        + "', setId='" + setId
        + "', colorId='" + colorId
        + "', JSON=" + JSON.stringify(iComponent) + " : " + e;
    }
}

function getColor(iComponent, jsonId, setId, colorId) {
    let color = null;
    let checked = document.getElementById(setId).checked;
    if (checked) {
        color = hexToRgb(document.getElementById(colorId).value);
    }
    iComponent[jsonId] = color;

    if (iComponent[setId] !== null) {
        iComponent[setId] = checked;
    }
}

function setElement(json, elementId, jsonId) {
    if (jsonId === undefined) {
        jsonId = elementId;
    }
    let el = document.getElementById(elementId);
    if (!el) {
        return;
    }
    let value = json[jsonId];
    el.value = (value === null || value === undefined) ? "" : value;
}

function getElement(json, elementId, jsonId) {
    if (jsonId === undefined) {
        jsonId = elementId;
    }
    let el = document.getElementById(elementId);
    if (!el) {
        return;
    }
    let value = el.value;
    // Optional metadata selectors: empty / "(none)" must be null, not "".
    // Blank themeName makes render lookupTheme("") fail ("no default font set").
    if (value === "" && isOptionalEmptyStringField(jsonId)) {
        json[jsonId] = null;
    } else {
        json[jsonId] = value;
    }
}

/**
 * Field names where empty form value means "unset" (null), not an empty string.
 * themeName "" is especially harmful: PresentationRenderContext treats it as a
 * named theme and fails instead of using the presentation default.
 */
function isOptionalEmptyStringField(jsonId) {
    if (!jsonId) {
        return false;
    }
    switch (jsonId) {
        case "themeName":
        case "sourceConnectorName":
        case "rotation":
        case "transparency":
        case "customHtml":
        case "formatMask":
        case "lineWidth":
        case "horizontalLabelInterval":
        case "componentName": // layout reference: empty = page, not a component
            return true;
        default:
            return false;
    }
}

/**
 * Recursively turn "" into null for optional fields after form save (covers nested
 * plugin maps, layout sides, list items).
 */
function normalizeOptionalEmptyStrings(obj) {
    if (obj === null || obj === undefined) {
        return;
    }
    if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
            normalizeOptionalEmptyStrings(obj[i]);
        }
        return;
    }
    if (typeof obj !== "object") {
        return;
    }
    for (let key of Object.keys(obj)) {
        let val = obj[key];
        if (val === "" && isOptionalEmptyStringField(key)) {
            obj[key] = null;
        } else if (val !== null && typeof val === "object") {
            normalizeOptionalEmptyStrings(val);
        }
    }
}

/**
 * Load a LeanSize {width,height} into idWidth / idHeight inputs.
 */
function setSize(json, elementId, jsonId) {
    if (jsonId === undefined) {
        jsonId = elementId;
    }
    let size = json[jsonId];
    let widthEl = document.getElementById(elementId + "Width");
    let heightEl = document.getElementById(elementId + "Height");
    if (!widthEl || !heightEl) {
        return;
    }
    if (size === null || size === undefined) {
        widthEl.value = "";
        heightEl.value = "";
        return;
    }
    widthEl.value = (size["width"] === null || size["width"] === undefined) ? "" : size["width"];
    heightEl.value = (size["height"] === null || size["height"] === undefined) ? "" : size["height"];
}

/**
 * Save idWidth / idHeight into a LeanSize object, or null when both empty / zero.
 */
function getSize(json, elementId, jsonId) {
    if (jsonId === undefined) {
        jsonId = elementId;
    }
    let widthEl = document.getElementById(elementId + "Width");
    let heightEl = document.getElementById(elementId + "Height");
    if (!widthEl || !heightEl) {
        json[jsonId] = null;
        return;
    }
    let widthStr = (widthEl.value || "").trim();
    let heightStr = (heightEl.value || "").trim();
    if (widthStr === "" && heightStr === "") {
        json[jsonId] = null;
        return;
    }
    let width = widthStr === "" ? 0 : toInteger(widthStr);
    let height = heightStr === "" ? 0 : toInteger(heightStr);
    json[jsonId] = {"width": width, "height": height};
}

function getElementInteger(json, elementId, jsonId) {
    if (jsonId === undefined) {
        jsonId = elementId;
    }
    json[jsonId] = toInteger(document.getElementById(elementId).value);
}

function setChecked(json, elementId, jsonId) {
    if (jsonId === undefined) {
        jsonId = elementId;
    }
    document.getElementById(elementId).checked = json[jsonId];
}

function getChecked(json, elementId, jsonId) {
    if (jsonId === undefined) {
        jsonId = elementId;
    }
    json[jsonId] = document.getElementById(elementId).checked;
}

function setLayout(componentJson, name) {
    let layout = componentJson["layout"] ? componentJson["layout"][name] : null;
    let isEnabled = layout != null;
    let en = document.getElementById(name + "Enabled");
    if (!en) {
        return;
    }
    en.checked = isEnabled;
    if (isEnabled) {
        let obj = document.getElementById(name + "ObjectName");
        if (obj) {
            // null / missing componentName = page
            obj.value = layout["componentName"] != null ? layout["componentName"] : "";
        }
        let off = document.getElementById(name + "Offset");
        if (off) {
            off.value = "" + (layout["offset"] != null ? layout["offset"] : 0);
        }
        let pct = document.getElementById(name + "Percentage");
        if (pct) {
            pct.value = "" + (layout["percentage"] != null ? layout["percentage"] : 0);
        }
        let al = document.getElementById(name + "Alignment");
        if (al) {
            al.value = "" + (layout["alignment"] != null ? layout["alignment"] : "DEFAULT");
        }
    }
}

/**
 * Map UI values to LeanAttachment.Alignment. Content vertical uses MIDDLE;
 * layout attachment uses CENTER — older forms may still submit MIDDLE.
 */
function normalizeLayoutAlignment(value) {
    if (value == null || value === "") {
        return "DEFAULT";
    }
    if (value === "MIDDLE") {
        return "CENTER";
    }
    return value;
}

function getLayout(componentJson, name) {
    let layout = null;
    let en = document.getElementById(name + "Enabled");
    let isEnabled = en && en.checked;
    if (isEnabled) {
        let objName = document.getElementById(name + "ObjectName").value;
        if (objName === "") {
            objName = null; // page reference
        }
        layout = {
            "componentName": objName,
            "offset": parseInt(document.getElementById(name + "Offset").value) || 0,
            "percentage": parseInt(document.getElementById(name + "Percentage").value) || 0,
            "alignment": normalizeLayoutAlignment(document.getElementById(name + "Alignment").value)
        };
    }
    if (!componentJson["layout"]) {
        componentJson["layout"] = {};
    }
    componentJson["layout"][name] = layout;
}

/**
 * Apply a layout side preset in the property form (page = empty object name).
 * Alignments match LeanLayout.fullPage() / topLeftPage().
 */
function setLayoutSideForm(side, enabled, componentName, offset, percentage, alignment) {
    let en = document.getElementById(side + "Enabled");
    if (!en) {
        return;
    }
    en.checked = !!enabled;
    if (!enabled) {
        return;
    }
    let obj = document.getElementById(side + "ObjectName");
    if (obj) {
        obj.value = componentName != null ? componentName : "";
    }
    let off = document.getElementById(side + "Offset");
    if (off) {
        off.value = "" + (offset != null ? offset : 0);
    }
    let pct = document.getElementById(side + "Percentage");
    if (pct) {
        pct.value = "" + (percentage != null ? percentage : 0);
    }
    let al = document.getElementById(side + "Alignment");
    if (al) {
        al.value = alignment || "DEFAULT";
    }
}

/** LeanLayout.fullPage(): left/top/right/bottom → page, offset 0 */
function applyLayoutFullPage() {
    setLayoutSideForm("left", true, null, 0, 0, "LEFT");
    setLayoutSideForm("top", true, null, 0, 0, "TOP");
    setLayoutSideForm("right", true, null, 0, 0, "RIGHT");
    setLayoutSideForm("bottom", true, null, 0, 0, "BOTTOM");
}

/** LeanLayout.topLeftPage(): left/top → page, offset 0; clear right/bottom */
function applyLayoutTopLeft() {
    setLayoutSideForm("left", true, null, 0, 0, "LEFT");
    setLayoutSideForm("top", true, null, 0, 0, "TOP");
    setLayoutSideForm("right", false);
    setLayoutSideForm("bottom", false);
}

function createTableRowId(tableId, rowNumber) {
    return tableId + "-" + (rowNumber + 1);
}

function setColumns(json, columnsId, tableId, columnPrefix, connectorColumnNames) {
    let columns = json[columnsId];
    let table = document.getElementById(tableId);
    if (!table || !columns) {
        return;
    }
    if (table.getAttribute("data-list-kind") === null) {
        table.setAttribute("data-list-kind", "column");
    }
    if (columnPrefix) {
        table.setAttribute("data-column-prefix", columnPrefix);
    }

    for (let i = 0; i < columns.length; i++) {
        let column = columns[i];
        createColumnsRow(table, column, i, columnPrefix, connectorColumnNames);
    }

}

function createColumnsRow(table, column, i, columnPrefix, connectorColumnNames) {
    let row = table.insertRow(i + 1);
    let index = 0;

    // For the unique id for the row we use a global row number.
    //
    row.id = createTableRowId(table.id, rowIdNumber++);

    // Column name: always preserve stored name if not in live connector list
    //
    row.insertCell(index++).innerHTML = createSelection(
        createTableColumnId(columnPrefix, "Name", i),
        column["columnName"],
        connectorColumnNames,
        { preserveMissing: true }
    );

    // Header value: a text box
    //
    row.insertCell(index++).innerHTML = createText(
        createTableColumnId(columnPrefix, "Header", i),
        column["headerValue"]
    );
    // Width / Format: compact fields (~1/4 of a default text input)
    row.insertCell(index++).innerHTML = createText(
        createTableColumnId(columnPrefix, "Width", i),
        column["width"],
        "width: 4em"
    );
    row.insertCell(index++).innerHTML = createSelection(
        createTableColumnId(columnPrefix, "HorizontalAlignment", i),
        column["horizontalAlignment"],
        HORIZONTAL_ALIGNMENTS,
        { defaultEmptyToFirst: true }
    );
    row.insertCell(index++).innerHTML = createSelection(
        createTableColumnId(columnPrefix, "VerticalAlignment", i),
        column["verticalAlignment"],
        VERTICAL_ALIGNMENTS,
        { defaultEmptyToFirst: true }
    );
    let mask = column["formatMask"];
    row.insertCell(index++).innerHTML = createText(
        createTableColumnId(columnPrefix, "Format", i),
        mask === null ? "" : mask,
        "width: 4em"
    );

    appendListReorderCells(row, table, index);
}

function columnAdd(table, row, columnsPrefix, connectorColumnNames) {
    // Legacy helper: insert after the given row (header Add uses listFieldAdd)
    let index = row.rowIndex;
    let column = {
        "columnName": "",
        "headerValue": "",
        "width": 0,
        "horizontalAlignment": "LEFT",
        "verticalAlignment": "MIDDLE",
        "formatMask": ""
    }
    createColumnsRow(table, column, index, columnsPrefix, connectorColumnNames);
}

function columnDelete(table, row) {
    table.deleteRow(row.rowIndex);
}


function setFacts(json, columnsId, tableId, columnPrefix, connectorColumnNames) {
    let columns = json[columnsId];
    let table = document.getElementById(tableId);
    if (!table || !columns) {
        return;
    }
    if (table.getAttribute("data-list-kind") === null) {
        table.setAttribute("data-list-kind", "fact");
    }
    if (columnPrefix) {
        table.setAttribute("data-column-prefix", columnPrefix);
    }

    for (let i = 0; i < columns.length; i++) {
        let column = columns[i];
        createFactsRow(table, column, i, columnPrefix, connectorColumnNames);
    }
}

function createTableColumnId(prefix, typeIndicator, index) {
    return prefix + typeIndicator + "-" + index;
}

function createFactsRow(table, column, i, columnPrefix, connectorColumnNames) {
    let row = table.insertRow(i + 1);
    let index = 0;

    // For the unique id for the row we use a global row number.
    //
    row.id = createTableRowId(table.id, rowIdNumber++);

    // Fact column name: preserve stored name when connector columns unavailable
    //
    row.insertCell(index++).innerHTML = createSelection(
        createTableColumnId(columnPrefix, "Name", i),
        column["columnName"],
        connectorColumnNames,
        { preserveMissing: true }
    );

    // Header value: a text box
    //
    row.insertCell(index++).innerHTML = createText(
        createTableColumnId(columnPrefix, "Header", i),
        column["headerValue"]
    );
    // Width / Format: compact fields (~1/4 of a default text input)
    row.insertCell(index++).innerHTML = createText(
        createTableColumnId(columnPrefix, "Width", i),
        column["width"],
        "width: 4em"
    );
    row.insertCell(index++).innerHTML = createSelection(
        createTableColumnId(columnPrefix, "HorizontalAlignment", i),
        column["horizontalAlignment"],
        HORIZONTAL_ALIGNMENTS,
        { defaultEmptyToFirst: true }
    );
    row.insertCell(index++).innerHTML = createSelection(
        createTableColumnId(columnPrefix, "VerticalAlignment", i),
        column["verticalAlignment"],
        VERTICAL_ALIGNMENTS,
        { defaultEmptyToFirst: true }
    );
    let mask = column["formatMask"];
    row.insertCell(index++).innerHTML = createText(
        createTableColumnId(columnPrefix, "Format", i),
        mask === null ? "" : mask,
        "width: 4em"
    );

    // Aggregation settings
    //
    row.insertCell(index++).innerHTML = createCheckBox(
        createTableColumnId(columnPrefix, "HorizontalAggregation", i),
        column["horizontalAggregation"]);
    row.insertCell(index++).innerHTML = createCheckBox(
        createTableColumnId(columnPrefix, "VerticalAggregation", i),
        column["verticalAggregation"]);
    row.insertCell(index++).innerHTML = createSelection(
        createTableColumnId(columnPrefix, "aggregationMethod", i),
        column["aggregationMethod"],
        AGGREGATION_METHODS,
        { defaultEmptyToFirst: true }
    );

    appendListReorderCells(row, table, index);
}

function factAdd(table, row, columnsPrefix, connectorColumnNames) {
    // Legacy helper: insert after the given row (header Add uses listFieldAdd)
    let index = row.rowIndex;
    let column = {
        "columnName": "",
        "headerValue": "",
        "width": 0,
        "horizontalAlignment": "LEFT",
        "verticalAlignment": "MIDDLE",
        "formatMask": "",
        "horizontalAggregation": true,
        "verticalAggregation": true,
        "aggregationMethod": "SUM"
    }
    createFactsRow(table, column, index, columnsPrefix, connectorColumnNames);
}

function cellControlValue(cell) {
    if (cell === null || cell === undefined) {
        return null;
    }
    let el = cell.querySelector("input, select, textarea");
    if (el === null || el === undefined) {
        // Fallback: raw text
        return cell.textContent;
    }
    if (el.type === "checkbox") {
        return el.checked;
    }
    return el.value;
}

function getColumns(json, columnsId, tableId) {
    try {
        let columns = [];
        let table = document.getElementById(tableId);
        if (table === null || table === undefined) {
            throw "unable to find table with id: " + tableId;
        }
        let rows = table.rows;
        if (rows === null || rows === undefined) {
            throw "unable to find rows in table with id: " + tableId;
        }

        for (let i = 1; i < rows.length; i++) {
            columns.push(getColumnsRow(rows[i]));
        }
        json[columnsId] = columns;

    } catch (e) {
        alert("Error getting column values for tableId=" + tableId + " : " + e);
    }
}

function getColumnsRow(row) {
    try {
        let column = {};
        let index = 0;
        column["columnName"] = cellControlValue(row.cells[index++]);
        column["headerValue"] = cellControlValue(row.cells[index++]);
        let width = cellControlValue(row.cells[index++]);
        column["width"] = width === null || width === "" ? 0 : parseInt(width);
        let hAlign = cellControlValue(row.cells[index++]);
        let vAlign = cellControlValue(row.cells[index++]);
        // Never write null/empty enums — Hop leaves them null and switch(enum) NPEs
        column["horizontalAlignment"] = hAlign || "LEFT";
        column["verticalAlignment"] = vAlign || "TOP";
        column["formatMask"] = cellControlValue(row.cells[index++]);
        return column;
    } catch (e) {
        throw "Error getting values from row " + row.id + " : " + e;
    }
}

function getFacts(json, columnsId, tableId) {
    try {
        let facts = [];
        let table = document.getElementById(tableId);
        if (table === null || table === undefined) {
            throw "unable to find table with id: " + tableId;
        }
        for (let i = 1; i < table.rows.length; i++) {
            facts.push(getFactsRow(table.rows[i]));
        }
        json[columnsId] = facts;
    } catch (e) {
        alert("Error getting fact values for tableId=" + tableId + " : " + e);
    }
}

function getFactsRow(row) {
    try {
        let fact = getColumnsRow(row);
        // After LeanColumn cells (0-5): H-Agg, V-Agg, Method
        fact["horizontalAggregation"] = !!cellControlValue(row.cells[6]);
        fact["verticalAggregation"] = !!cellControlValue(row.cells[7]);
        fact["aggregationMethod"] = cellControlValue(row.cells[8]) || "SUM";
        // Header cell alignments are not yet on the form — keep safe defaults so
        // Apply does not wipe them to null (crosstab render NPEs on null enums).
        fact["headerHorizontalAlignment"] = "LEFT";
        fact["headerVerticalAlignment"] = "TOP";
        return fact;
    } catch (e) {
        throw "Error getting fact values from row " + row.id + " : " + e;
    }
}

function setStringList(json, fieldId, tableId) {
    let values = json[fieldId];
    if (values === null || values === undefined) {
        return;
    }
    let table = document.getElementById(tableId);
    if (!table) {
        return;
    }
    if (table.getAttribute("data-list-kind") === null) {
        table.setAttribute("data-list-kind", "string");
    }
    for (let i = 0; i < values.length; i++) {
        createStringListRow(table, values[i], i);
    }
}

function createStringListRow(table, value, i) {
    let row = table.insertRow(i + 1);
    row.id = createTableRowId(table.id, rowIdNumber++);
    row.insertCell(0).innerHTML = createText("stringList-" + i, value === null ? "" : value);
    appendListReorderCells(row, table, 1);
}

function getStringList(json, fieldId, tableId) {
    let values = [];
    let table = document.getElementById(tableId);
    if (table === null) {
        json[fieldId] = values;
        return;
    }
    for (let i = 1; i < table.rows.length; i++) {
        values.push(cellControlValue(table.rows[i].cells[0]));
    }
    json[fieldId] = values;
}

/**
 * Edit the current presentation.
 * Get the metadata using the name.
 *
 * The render ID and presentation name are known for the whole page.
 *
 * @param component
 * @param requestData
 */
// ---------------------------------------------------------------------------
// Presentation properties (name, theme, interactions, parameter mappings)
// ---------------------------------------------------------------------------

/** Working copy while the properties panel is open. */
let presentationPropertiesWorking = null;
/** Snapshot JSON string when the panel was opened (dirty detection). */
let presentationPropertiesBaseline = null;
/** Name when the panel was opened (for rename). */
let presentationPropertiesOldName = null;
/** Index of interaction being edited in the expanded form, or -1. */
let presentationInteractionEditIndex = -1;
/** Index of parameter mapping group being edited, or -1. */
let presentationParamMapEditIndex = -1;
/** True after user edits in the properties panel (or nested editors). */
let presentationPropertiesDirty = false;

function markPresentationPropertiesDirty() {
    presentationPropertiesDirty = true;
}

function clearPresentationPropertiesDirty() {
    presentationPropertiesDirty = false;
    if (presentationPropertiesWorking) {
        try {
            presentationPropertiesBaseline = JSON.stringify(presentationPropertiesWorking);
        } catch (e) {
            presentationPropertiesBaseline = null;
        }
    }
}

/**
 * True if working copy or basic form fields differ from the load baseline.
 */
function isPresentationPropertiesDirty() {
    if (presentationPropertiesDirty) {
        return true;
    }
    if (!presentationPropertiesWorking || presentationPropertiesBaseline == null) {
        return false;
    }
    // Include current form basics without mutating working copy permanently
    let snap = JSON.parse(JSON.stringify(presentationPropertiesWorking));
    let nameEl = document.getElementById("presPropName");
    let descEl = document.getElementById("presPropDescription");
    let themeEl = document.getElementById("presPropDefaultTheme");
    if (nameEl) {
        snap.name = nameEl.value.trim();
    }
    if (descEl) {
        snap.description = descEl.value;
    }
    if (themeEl) {
        snap.defaultThemeName = themeEl.value;
    }
    try {
        return JSON.stringify(snap) !== presentationPropertiesBaseline;
    } catch (e) {
        return presentationPropertiesDirty;
    }
}

/**
 * Ensure the presentation title bar exists and is wired (edit: clickable; view: label only).
 */
function installPresentationTitleBar() {
    let bar = document.getElementById("presentationTitleBar");
    let link = document.getElementById("presentationTitleLink");
    if (!bar || !link) {
        // Inject if template omitted it
        if (!bar && typeof presentationName !== "undefined" && presentationName) {
            bar = document.createElement("div");
            bar.id = "presentationTitleBar";
            bar.className = "presentation-title-bar"
                + (isEditMode() ? "" : " presentation-title-bar-view");
            if (isEditMode()) {
                bar.innerHTML = '<a href="#" id="presentationTitleLink" class="presentation-title-link"></a>';
            } else {
                bar.innerHTML = '<span id="presentationTitleLink" class="presentation-title-text"></span>';
            }
            document.body.insertBefore(bar, document.body.firstChild);
            link = document.getElementById("presentationTitleLink");
        }
    }
    if (!link || typeof presentationName === "undefined") {
        return;
    }
    link.textContent = presentationName || "";
    if (isEditMode() && link.tagName === "A" && !link._leanPropsWired) {
        link._leanPropsWired = true;
        link.addEventListener("click", function (e) {
            e.preventDefault();
            openPresentationProperties();
        });
    }
}

function updatePresentationTitleBar(name) {
    let link = document.getElementById("presentationTitleLink");
    if (link) {
        link.textContent = name || "";
    }
    if (typeof document !== "undefined" && name) {
        // Keep document title roughly in sync
        let t = document.title || "";
        if (t.indexOf("(edit)") >= 0 || t.indexOf("(view)") >= 0) {
            document.title = t.replace(/^[^ ]+/, name);
        }
    }
}

/**
 * Open the presentation properties side panel (edit mode).
 */
function openPresentationProperties() {
    if (!isEditMode()) {
        return;
    }
    if (typeof presentationName === "undefined" || !presentationName) {
        alert("No presentation is open");
        return;
    }
    if (themeNames === null) {
        themeNames = getThemeNames();
    }
    setSidePanelOpen(true, {withPreview: false});
    let editArea = document.getElementById("editArea");
    if (editArea) {
        editArea.innerHTML = "<p class=\"editor-hint\">Loading presentation...</p>";
    }
    $.ajax({
        url: API_BASE + "metadata/presentation/" + encodeURIComponent(presentationName),
        type: "GET",
        dataType: "json",
        success: function (json) {
            presentationJson = json || {};
            presentationPropertiesWorking = JSON.parse(JSON.stringify(presentationJson));
            if (!presentationPropertiesWorking.interactions) {
                presentationPropertiesWorking.interactions = [];
            }
            if (!presentationPropertiesWorking.parameterMappings) {
                presentationPropertiesWorking.parameterMappings = [];
            }
            if (!presentationPropertiesWorking.themes) {
                presentationPropertiesWorking.themes = [];
            }
            presentationPropertiesOldName = presentationPropertiesWorking.name || presentationName;
            presentationInteractionEditIndex = -1;
            presentationParamMapEditIndex = -1;
            clearPresentationPropertiesDirty();
            renderPresentationPropertiesForm();
            // Load header/footer state into form fields
            loadPresentationHeaderFooterIntoForm();
        },
        error: function (xhr) {
            alert("Failed to load presentation: " + (xhr.responseText || xhr.status));
            setSidePanelOpen(false);
        }
    });
}

/** @deprecated use openPresentationProperties */
function editPresentationMetadata() {
    openPresentationProperties();
}

function loadPresentationHeaderFooterIntoForm() {
    if (typeof presentationName === "undefined") {
        return;
    }
    $.ajax({
        url: API_BASE + "edit/presentation/" + encodeURIComponent(presentationName) + "/header-footer/",
        type: "GET",
        dataType: "json",
        success: function (state) {
            let h = (state && state.header) || {enabled: false, height: 50};
            let f = (state && state.footer) || {enabled: false, height: 25};
            let chkH = document.getElementById("presPropHeaderEnabled");
            let chkF = document.getElementById("presPropFooterEnabled");
            let hH = document.getElementById("presPropHeaderHeight");
            let hF = document.getElementById("presPropFooterHeight");
            if (chkH) {
                chkH.checked = !!h.enabled;
            }
            if (chkF) {
                chkF.checked = !!f.enabled;
            }
            if (hH) {
                hH.value = h.height != null ? h.height : 50;
            }
            if (hF) {
                hF.value = f.height != null ? f.height : 25;
            }
        }
    });
}

function renderPresentationPropertiesForm() {
    let w = presentationPropertiesWorking;
    if (!w) {
        return;
    }
    let themes = themeNames || getThemeNames() || [];
    let themeOpts = "";
    let defTheme = w.defaultThemeName || "Default";
    for (let i = 0; i < themes.length; i++) {
        let t = themes[i];
        if (!t) {
            continue;
        }
        themeOpts += "<option value=\"" + escapeHtmlAttribute(t) + "\""
            + (t === defTheme ? " selected" : "") + ">" + escapeHtmlText(t) + "</option>";
    }
    if (!themeOpts) {
        themeOpts = "<option value=\"Default\">Default</option>";
    }

    let themesListHtml = buildPresentationThemesListHtml(w);

    let html = "";
    html += "<div class=\"form-action-bar\" id=\"formActionBar-presentation\">";
    html += "<button type=\"button\" class=\"form-action-save\" id=\"presPropSave\">Save</button> ";
    html += "<button type=\"button\" class=\"form-action-close\" id=\"presPropClose\">Close</button>";
    html += "</div>";
    html += "<h3>Presentation properties</h3>";
    html += "<p id=\"presPropStatus\" class=\"editor-hint\" hidden></p>";

    html += "<div class=\"pres-prop-section\">";
    html += "<label for=\"presPropName\">Name</label><br>";
    html += "<input type=\"text\" id=\"presPropName\" class=\"pres-prop-input\" value=\""
        + escapeHtmlAttribute(w.name || "") + "\"><br>";
    html += "<label for=\"presPropDescription\">Description</label><br>";
    html += "<textarea id=\"presPropDescription\" class=\"pres-prop-textarea\" rows=\"2\">"
        + escapeHtmlText(w.description || "") + "</textarea><br>";
    html += "<label for=\"presPropDefaultTheme\">Default theme</label><br>";
    html += "<select id=\"presPropDefaultTheme\" class=\"pres-prop-input\">" + themeOpts + "</select>";
    html += "</div>";

    html += "<div class=\"pres-prop-section\">";
    html += "<h4>Themes on this presentation</h4>";
    html += "<ul class=\"pres-prop-theme-list\" id=\"presPropThemeList\">" + themesListHtml + "</ul>";
    html += "<label for=\"presPropAddTheme\">Add theme from metadata</label> ";
    html += "<select id=\"presPropAddTheme\" class=\"pres-prop-input-sm\">" + themeOpts + "</select> ";
    html += "<button type=\"button\" id=\"presPropAddThemeBtn\" class=\"home-btn\">Add</button>";
    html += "<p class=\"editor-hint\">Embedded themes travel with the presentation. "
        + "Default theme is loaded from metadata at render time if not embedded.</p>";
    html += "</div>";

    html += "<div class=\"pres-prop-section\">";
    html += "<h4>Header / Footer</h4>";
    html += "<label><input type=\"checkbox\" id=\"presPropHeaderEnabled\"> Header enabled</label> ";
    html += "height <input type=\"number\" id=\"presPropHeaderHeight\" class=\"pres-prop-num\" min=\"0\" value=\"50\"> px<br>";
    html += "<label><input type=\"checkbox\" id=\"presPropFooterEnabled\"> Footer enabled</label> ";
    html += "height <input type=\"number\" id=\"presPropFooterHeight\" class=\"pres-prop-num\" min=\"0\" value=\"25\"> px";
    html += "<p class=\"editor-hint\">Header/footer content is edited via the left rail when enabled.</p>";
    html += "</div>";

    html += "<div class=\"pres-prop-section\">";
    html += "<div class=\"pres-prop-section-head\">";
    html += "<h4>Interactions</h4>";
    html += "<span>";
    html += "<button type=\"button\" id=\"presPropAddInteraction\" class=\"home-btn\" title=\"Blank interaction\">+ Add</button> ";
    html += "<button type=\"button\" id=\"presPropPresetTableDrill\" class=\"home-btn\" "
        + "title=\"Preset: table cell click opens another presentation\">Table drill-down</button>";
    html += "</span>";
    html += "</div>";
    html += "<p class=\"editor-hint\">Drill-down: table cell click opens another presentation "
        + "(optionally sets a parameter from the cell value). "
        + "Test interactions in <strong>view</strong> mode after Save.</p>";
    html += "<div id=\"presPropInteractionsList\"></div>";
    html += "<div id=\"presPropInteractionEditor\" class=\"pres-prop-nested-editor\" hidden></div>";
    html += "</div>";

    html += "<div class=\"pres-prop-section\">";
    html += "<div class=\"pres-prop-section-head\">";
    html += "<h4>Parameter mappings</h4>";
    html += "<button type=\"button\" id=\"presPropAddParamMap\" class=\"home-btn\">+ Add</button>";
    html += "</div>";
    html += "<p class=\"editor-hint\">Map connector fields to presentation parameters "
        + "(e.g. for labels using \${PARAM}). Used by drill-down targets like execution-details.</p>";
    html += "<div id=\"presPropParamMapsList\"></div>";
    html += "<div id=\"presPropParamMapEditor\" class=\"pres-prop-nested-editor\" hidden></div>";
    html += "</div>";

    let editArea = document.getElementById("editArea");
    if (!editArea) {
        return;
    }
    editArea.innerHTML = html;

    document.getElementById("presPropSave").onclick = function () {
        savePresentationProperties();
    };
    document.getElementById("presPropClose").onclick = function () {
        closePresentationProperties();
    };
    document.getElementById("presPropAddThemeBtn").onclick = function () {
        addPresentationThemeFromMetadata();
    };
    document.getElementById("presPropAddInteraction").onclick = function () {
        addPresentationInteraction(null);
    };
    document.getElementById("presPropPresetTableDrill").onclick = function () {
        addPresentationInteraction({preset: "table-drill"});
    };
    document.getElementById("presPropAddParamMap").onclick = function () {
        addPresentationParamMapping();
    };
    wirePresentationThemeListRemove();
    // Mark dirty when basic fields change
    ["presPropName", "presPropDescription", "presPropDefaultTheme",
        "presPropHeaderEnabled", "presPropFooterEnabled",
        "presPropHeaderHeight", "presPropFooterHeight"].forEach(function (id) {
        let el = document.getElementById(id);
        if (el) {
            el.addEventListener("change", markPresentationPropertiesDirty);
            el.addEventListener("input", markPresentationPropertiesDirty);
        }
    });

    refreshPresentationInteractionsList();
    refreshPresentationParamMapsList();
}

function buildPresentationThemesListHtml(w) {
    if (!w.themes || !w.themes.length) {
        return "<li class=\"editor-hint\">(none embedded - default theme loaded from metadata)</li>";
    }
    let html = "";
    for (let i = 0; i < w.themes.length; i++) {
        let th = w.themes[i];
        if (!th || !th.name) {
            continue;
        }
        html += "<li class=\"pres-prop-theme-item\">";
        html += "<span>" + escapeHtmlText(th.name) + "</span> ";
        html += "<button type=\"button\" class=\"home-btn-small\" data-theme-remove=\""
            + escapeHtmlAttribute(th.name) + "\" title=\"Remove embedded theme\">Remove</button>";
        html += "</li>";
    }
    return html || "<li class=\"editor-hint\">(none embedded)</li>";
}

function wirePresentationThemeListRemove() {
    let list = document.getElementById("presPropThemeList");
    if (!list) {
        return;
    }
    list.onclick = function (e) {
        let t = e.target;
        if (!t || !t.getAttribute || t.getAttribute("data-theme-remove") == null) {
            return;
        }
        removePresentationTheme(t.getAttribute("data-theme-remove"));
    };
}

function removePresentationTheme(themeName) {
    if (!presentationPropertiesWorking || !themeName) {
        return;
    }
    let w = presentationPropertiesWorking;
    let def = (document.getElementById("presPropDefaultTheme")
        || {}).value || w.defaultThemeName;
    if (def === themeName) {
        if (!confirm("Remove embedded theme \"" + themeName
            + "\"? It is the default theme name (will still load from metadata if available).")) {
            return;
        }
    }
    w.themes = (w.themes || []).filter(function (th) {
        return th && th.name !== themeName;
    });
    markPresentationPropertiesDirty();
    // Re-render theme list only to avoid collapsing nested editors
    let list = document.getElementById("presPropThemeList");
    if (list) {
        list.innerHTML = buildPresentationThemesListHtml(w);
        wirePresentationThemeListRemove();
    }
}

function collectPresentationPropertiesBasics() {
    let w = presentationPropertiesWorking;
    if (!w) {
        return;
    }
    let nameEl = document.getElementById("presPropName");
    let descEl = document.getElementById("presPropDescription");
    let themeEl = document.getElementById("presPropDefaultTheme");
    if (nameEl) {
        w.name = nameEl.value.trim();
    }
    if (descEl) {
        w.description = descEl.value;
    }
    if (themeEl) {
        w.defaultThemeName = themeEl.value;
    }
}

function addPresentationThemeFromMetadata() {
    let sel = document.getElementById("presPropAddTheme");
    if (!sel || !sel.value || !presentationPropertiesWorking) {
        return;
    }
    let themeName = sel.value;
    let w = presentationPropertiesWorking;
    if (!w.themes) {
        w.themes = [];
    }
    for (let i = 0; i < w.themes.length; i++) {
        if (w.themes[i] && w.themes[i].name === themeName) {
            alert("Theme already attached: " + themeName);
            return;
        }
    }
    $.ajax({
        url: API_BASE + "metadata/theme/" + encodeURIComponent(themeName),
        type: "GET",
        dataType: "json",
        success: function (themeJson) {
            if (themeJson) {
                w.themes.push(themeJson);
                markPresentationPropertiesDirty();
                let list = document.getElementById("presPropThemeList");
                if (list) {
                    list.innerHTML = buildPresentationThemesListHtml(w);
                    wirePresentationThemeListRemove();
                } else {
                    renderPresentationPropertiesForm();
                }
            }
        },
        error: function (xhr) {
            alert("Failed to load theme: " + (xhr.responseText || xhr.status));
        }
    });
}

/**
 * Ensure defaultThemeName is either embedded in presentation.themes or loadable from metadata.
 * If missing from both, tries to embed from metadata before save.
 */
function ensureDefaultThemeEmbedded(w, done) {
    let def = (w && w.defaultThemeName) ? w.defaultThemeName.trim() : "";
    if (!def) {
        if (done) {
            done();
        }
        return;
    }
    if (!w.themes) {
        w.themes = [];
    }
    for (let i = 0; i < w.themes.length; i++) {
        if (w.themes[i] && w.themes[i].name === def) {
            if (done) {
                done();
            }
            return;
        }
    }
    // Not embedded - engine loads from metadata at layout; optional embed for portability
    $.ajax({
        url: API_BASE + "metadata/theme/" + encodeURIComponent(def),
        type: "GET",
        dataType: "json",
        success: function (themeJson) {
            if (themeJson && themeJson.name) {
                w.themes.push(themeJson);
            }
            if (done) {
                done();
            }
        },
        error: function () {
            // Leave defaultThemeName as-is; layout may still resolve it
            if (done) {
                done();
            }
        }
    });
}

// ── Interactions ──────────────────────────────────────────────────────────

function interactionSummary(ix) {
    if (!ix) {
        return "(empty)";
    }
    let method = ix.method || {};
    let click = method.mouseDoubleClick ? "Double-click" : "Click";
    let loc = ix.location || {};
    // ASCII separators only (avoid UTF-8 mojibake if charset is wrong)
    let where = (loc.componentName || "?")
        + (loc.itemCategory ? " | " + loc.itemCategory : "")
        + (loc.dimensionColumns && loc.dimensionColumns.length
            ? " | [" + loc.dimensionColumns.join(", ") + "]" : "");
    let act = (ix.actions && ix.actions[0]) || {};
    let target = act.objectName
        ? ("-> " + act.objectName)
        : "-> (presentation = cell value)";
    if (act.valueParameter) {
        target += " (param " + act.valueParameter + ")";
    }
    return click + " on " + where + " " + target;
}

function refreshPresentationInteractionsList() {
    let root = document.getElementById("presPropInteractionsList");
    if (!root || !presentationPropertiesWorking) {
        return;
    }
    let list = presentationPropertiesWorking.interactions || [];
    if (!list.length) {
        root.innerHTML = "<p class=\"editor-hint\">No interactions yet.</p>";
        return;
    }
    let html = "<ul class=\"pres-prop-card-list\">";
    for (let i = 0; i < list.length; i++) {
        html += "<li class=\"pres-prop-card\">";
        html += "<div class=\"pres-prop-card-summary\">" + escapeHtmlText(interactionSummary(list[i])) + "</div>";
        html += "<div class=\"pres-prop-card-actions\">";
        html += "<button type=\"button\" data-ix-edit=\"" + i + "\">Edit</button> ";
        html += "<button type=\"button\" data-ix-up=\"" + i + "\" title=\"Move up\">Up</button> ";
        html += "<button type=\"button\" data-ix-down=\"" + i + "\" title=\"Move down\">Down</button> ";
        html += "<button type=\"button\" data-ix-del=\"" + i + "\" title=\"Delete\">Del</button>";
        html += "</div></li>";
    }
    html += "</ul>";
    root.innerHTML = html;
    root.onclick = function (e) {
        let t = e.target;
        if (!t || !t.getAttribute) {
            return;
        }
        if (t.getAttribute("data-ix-edit") != null) {
            openPresentationInteractionEditor(parseInt(t.getAttribute("data-ix-edit"), 10));
        } else if (t.getAttribute("data-ix-del") != null) {
            let di = parseInt(t.getAttribute("data-ix-del"), 10);
            presentationPropertiesWorking.interactions.splice(di, 1);
            presentationInteractionEditIndex = -1;
            hidePresentationInteractionEditor();
            markPresentationPropertiesDirty();
            refreshPresentationInteractionsList();
        } else if (t.getAttribute("data-ix-up") != null) {
            let ui = parseInt(t.getAttribute("data-ix-up"), 10);
            if (ui > 0) {
                let a = presentationPropertiesWorking.interactions;
                let tmp = a[ui - 1];
                a[ui - 1] = a[ui];
                a[ui] = tmp;
                markPresentationPropertiesDirty();
                refreshPresentationInteractionsList();
            }
        } else if (t.getAttribute("data-ix-down") != null) {
            let di2 = parseInt(t.getAttribute("data-ix-down"), 10);
            let a2 = presentationPropertiesWorking.interactions;
            if (di2 < a2.length - 1) {
                let tmp2 = a2[di2 + 1];
                a2[di2 + 1] = a2[di2];
                a2[di2] = tmp2;
                markPresentationPropertiesDirty();
                refreshPresentationInteractionsList();
            }
        }
    };
}

/**
 * @param {{preset?: string}|null} opts  preset "table-drill" fills table cell location defaults
 */
function addPresentationInteraction(opts) {
    if (!presentationPropertiesWorking.interactions) {
        presentationPropertiesWorking.interactions = [];
    }
    let pageComps = (typeof window.leanEdit !== "undefined" && window.leanEdit.getPageComponents)
        ? (window.leanEdit.getPageComponents() || [])
        : [];
    // Prefer first table-like component for drill-down preset
    let defaultComp = "";
    let defaultPlugin = "LeanTableComponent";
    for (let i = 0; i < pageComps.length; i++) {
        let p = pageComps[i];
        if (p && p.pluginId && String(p.pluginId).indexOf("Table") >= 0) {
            defaultComp = p.name || "";
            defaultPlugin = p.pluginId;
            break;
        }
    }
    if (!defaultComp && pageComps.length && pageComps[0].name) {
        defaultComp = pageComps[0].name;
        defaultPlugin = pageComps[0].pluginId || defaultPlugin;
    }
    let isPreset = opts && opts.preset === "table-drill";
    presentationPropertiesWorking.interactions.push({
        method: {mouseClick: true, mouseDoubleClick: false},
        location: {
            componentName: isPreset ? defaultComp : "",
            componentPluginId: isPreset ? defaultPlugin : "LeanTableComponent",
            itemType: "ComponentItem",
            itemCategory: "Cell",
            dimensionColumns: []
        },
        actions: [{
            actionType: "OPEN_PRESENTATION",
            objectName: "",
            valueParameter: ""
        }]
    });
    markPresentationPropertiesDirty();
    let idx = presentationPropertiesWorking.interactions.length - 1;
    refreshPresentationInteractionsList();
    openPresentationInteractionEditor(idx);
}

function hidePresentationInteractionEditor() {
    let ed = document.getElementById("presPropInteractionEditor");
    if (ed) {
        ed.setAttribute("hidden", "hidden");
        ed.innerHTML = "";
    }
    presentationInteractionEditIndex = -1;
}

function openPresentationInteractionEditor(index) {
    let list = presentationPropertiesWorking.interactions || [];
    if (index < 0 || index >= list.length) {
        return;
    }
    presentationInteractionEditIndex = index;
    let ix = list[index];
    let loc = ix.location || {};
    let act = (ix.actions && ix.actions[0]) || {};
    let method = ix.method || {};
    let selectedDims = loc.dimensionColumns || [];

    // Prefer live page component list (name + pluginId) from edit mode
    let pageComps = (typeof window.leanEdit !== "undefined" && window.leanEdit.getPageComponents)
        ? (window.leanEdit.getPageComponents() || [])
        : [];
    let pluginByName = {};
    for (let i = 0; i < pageComps.length; i++) {
        if (pageComps[i] && pageComps[i].name) {
            pluginByName[pageComps[i].name] = pageComps[i].pluginId || "";
        }
    }
    let componentNamesList = pageComps.length
        ? pageComps.map(function (c) {
            return c.name;
        }).filter(Boolean)
        : getPresentationComponentNamesForProps();

    let compOptions = "<option value=\"\">- select -</option>";
    for (let i = 0; i < componentNamesList.length; i++) {
        let cn = componentNamesList[i];
        compOptions += "<option value=\"" + escapeHtmlAttribute(cn) + "\""
            + (cn === (loc.componentName || "") ? " selected" : "") + ">"
            + escapeHtmlText(cn) + "</option>";
    }
    // Keep a free-text fallback if the stored name is not on the current page
    if (loc.componentName && componentNamesList.indexOf(loc.componentName) < 0) {
        compOptions += "<option value=\"" + escapeHtmlAttribute(loc.componentName)
            + "\" selected>" + escapeHtmlText(loc.componentName) + " (other page)</option>";
    }

    let presOptions = "<option value=\"\">(use clicked cell value)</option>";
    let presentations = getPresentationNamesList();
    for (let i = 0; i < presentations.length; i++) {
        let pn = presentations[i];
        if (!pn) {
            continue;
        }
        presOptions += "<option value=\"" + escapeHtmlAttribute(pn) + "\""
            + (pn === (act.objectName || "") ? " selected" : "") + ">"
            + escapeHtmlText(pn) + "</option>";
    }

    let colNames = getPresentationComponentColumnNames(loc.componentName || "");
    let dimCheckHtml = buildDimensionColumnsChecklist(colNames, selectedDims);

    let html = "<h5>Edit interaction</h5>";
    html += "<p class=\"editor-hint\">Preset tip: use <strong>Table drill-down</strong> for "
        + "cell click -&gt; OPEN_PRESENTATION.</p>";
    html += "<label>Method</label><br>";
    html += "<label><input type=\"radio\" name=\"ixMethod\" value=\"click\""
        + (!method.mouseDoubleClick ? " checked" : "") + "> Single click</label> ";
    html += "<label><input type=\"radio\" name=\"ixMethod\" value=\"dbl\""
        + (method.mouseDoubleClick ? " checked" : "") + "> Double click</label><br><br>";

    html += "<label for=\"ixComponentName\">Component name</label><br>";
    html += "<select id=\"ixComponentName\" class=\"pres-prop-input\">" + compOptions + "</select><br>";
    html += "<label for=\"ixPluginId\">Component plugin id</label><br>";
    html += "<input type=\"text\" id=\"ixPluginId\" class=\"pres-prop-input\" value=\""
        + escapeHtmlAttribute(loc.componentPluginId || "LeanTableComponent") + "\"><br>";
    html += "<label for=\"ixItemType\">Item type</label><br>";
    html += "<select id=\"ixItemType\" class=\"pres-prop-input\">";
    ["ComponentItem", "Component"].forEach(function (t) {
        html += "<option value=\"" + t + "\"" + (t === (loc.itemType || "ComponentItem") ? " selected" : "")
            + ">" + t + "</option>";
    });
    html += "</select><br>";
    html += "<label for=\"ixItemCategory\">Item category</label><br>";
    html += "<select id=\"ixItemCategory\" class=\"pres-prop-input\">";
    ["Cell", "ChartSeriesLabel", ""].forEach(function (t) {
        let lab = t || "(any)";
        html += "<option value=\"" + escapeHtmlAttribute(t) + "\""
            + (t === (loc.itemCategory || "Cell") ? " selected" : "") + ">" + lab + "</option>";
    });
    html += "</select><br>";
    html += "<label>Dimension columns</label>";
    html += "<p class=\"editor-hint\">Match only cells for these columns "
        + "(empty = any column). Required for multi-column tables.</p>";
    html += "<div id=\"ixDimensionsBox\" class=\"pres-prop-check-list\">" + dimCheckHtml + "</div>";
    html += "<label for=\"ixDimensionsExtra\">Extra dimensions (comma-separated)</label><br>";
    html += "<input type=\"text\" id=\"ixDimensionsExtra\" class=\"pres-prop-input\" value=\"\" "
        + "placeholder=\"optional names not listed above\"><br><br>";

    html += "<label>Action</label><br>";
    html += "<input type=\"hidden\" id=\"ixActionType\" value=\"OPEN_PRESENTATION\">";
    html += "<span class=\"editor-hint\">OPEN_PRESENTATION</span><br>";
    html += "<label for=\"ixObjectName\">Target presentation</label><br>";
    html += "<select id=\"ixObjectName\" class=\"pres-prop-input\">" + presOptions + "</select><br>";
    html += "<label for=\"ixValueParameter\">Set parameter from cell value</label><br>";
    html += "<input type=\"text\" id=\"ixValueParameter\" class=\"pres-prop-input\" value=\""
        + escapeHtmlAttribute(act.valueParameter || "") + "\" "
        + "placeholder=\"e.g. EXECUTION_ID\"><br><br>";

    html += "<button type=\"button\" id=\"ixEditorOk\" class=\"form-action-save\">OK</button> ";
    html += "<button type=\"button\" id=\"ixEditorCancel\" class=\"form-action-close\">Cancel</button>";

    let ed = document.getElementById("presPropInteractionEditor");
    ed.innerHTML = html;
    ed.removeAttribute("hidden");
    document.getElementById("ixEditorOk").onclick = function () {
        commitPresentationInteractionEditor();
    };
    document.getElementById("ixEditorCancel").onclick = function () {
        hidePresentationInteractionEditor();
    };
    document.getElementById("ixComponentName").onchange = function () {
        let name = this.value;
        let pluginEl = document.getElementById("ixPluginId");
        if (pluginEl && name && pluginByName[name]) {
            pluginEl.value = pluginByName[name];
        }
        // Refresh dimension checklist for the selected component
        let box = document.getElementById("ixDimensionsBox");
        if (box) {
            let current = collectDimensionColumnsFromEditor();
            box.innerHTML = buildDimensionColumnsChecklist(
                getPresentationComponentColumnNames(name), current);
        }
    };
}

function buildDimensionColumnsChecklist(colNames, selected) {
    selected = selected || [];
    let selectedSet = {};
    for (let i = 0; i < selected.length; i++) {
        selectedSet[selected[i]] = true;
    }
    if (!colNames || !colNames.length) {
        return "<p class=\"editor-hint\">No columns found for this component "
            + "(pick a table component or type extra names below).</p>";
    }
    let html = "";
    for (let i = 0; i < colNames.length; i++) {
        let c = colNames[i];
        html += "<label class=\"pres-prop-check\">"
            + "<input type=\"checkbox\" class=\"ix-dim-cb\" value=\""
            + escapeHtmlAttribute(c) + "\""
            + (selectedSet[c] ? " checked" : "") + "> "
            + escapeHtmlText(c) + "</label> ";
    }
    return html;
}

function collectDimensionColumnsFromEditor() {
    let dims = [];
    let boxes = document.querySelectorAll("#ixDimensionsBox .ix-dim-cb:checked");
    for (let i = 0; i < boxes.length; i++) {
        if (boxes[i].value) {
            dims.push(boxes[i].value);
        }
    }
    let extraEl = document.getElementById("ixDimensionsExtra");
    let extraRaw = extraEl ? (extraEl.value || "").trim() : "";
    if (extraRaw) {
        extraRaw.split(",").forEach(function (s) {
            s = s.trim();
            if (s && dims.indexOf(s) < 0) {
                dims.push(s);
            }
        });
    }
    return dims;
}

/**
 * Column names for a component: table columnSelection, else describe(sourceConnectorName).
 */
function getPresentationComponentColumnNames(componentName) {
    let names = [];
    if (!componentName || !presentationPropertiesWorking) {
        return names;
    }
    let pages = presentationPropertiesWorking.pages || [];
    function considerComponent(lc) {
        if (!lc || lc.name !== componentName) {
            return;
        }
        let pluginWrap = lc.component;
        if (!pluginWrap || typeof pluginWrap !== "object") {
            return;
        }
        let inner = null;
        let keys = Object.keys(pluginWrap);
        if (keys.length === 1 && typeof pluginWrap[keys[0]] === "object") {
            inner = pluginWrap[keys[0]];
        } else {
            inner = pluginWrap;
        }
        if (!inner) {
            return;
        }
        let cols = inner.columnSelection || inner.columns || [];
        for (let i = 0; i < cols.length; i++) {
            let cn = cols[i] && (cols[i].columnName || cols[i].name);
            if (cn && names.indexOf(cn) < 0) {
                names.push(cn);
            }
        }
        if (!names.length && inner.sourceConnectorName
            && typeof getConnectorColumnNames === "function") {
            let fromConn = getConnectorColumnNames(inner.sourceConnectorName) || [];
            for (let j = 0; j < fromConn.length; j++) {
                if (fromConn[j] && names.indexOf(fromConn[j]) < 0) {
                    names.push(fromConn[j]);
                }
            }
        }
    }
    for (let p = 0; p < pages.length; p++) {
        let comps = (pages[p] && pages[p].components) || [];
        for (let c = 0; c < comps.length; c++) {
            considerComponent(comps[c]);
        }
    }
    // Header / footer components
    [["header"], ["footer"]].forEach(function (keyArr) {
        let band = presentationPropertiesWorking[keyArr[0]];
        if (band && band.components) {
            for (let i = 0; i < band.components.length; i++) {
                considerComponent(band.components[i]);
            }
        }
    });
    return names;
}

function commitPresentationInteractionEditor() {
    let idx = presentationInteractionEditIndex;
    if (idx < 0 || !presentationPropertiesWorking) {
        return;
    }
    let componentName = document.getElementById("ixComponentName").value || "";
    if (!componentName.trim()) {
        alert("Component name is required for the interaction location.");
        return;
    }
    let methodVal = document.querySelector("input[name=\"ixMethod\"]:checked");
    let isDbl = methodVal && methodVal.value === "dbl";
    let dims = collectDimensionColumnsFromEditor();
    let pluginId = (document.getElementById("ixPluginId").value || "").trim();
    // Prefer the real plugin id from the page component list when known
    if (typeof window.leanEdit !== "undefined" && window.leanEdit.getPageComponents) {
        let pcs = window.leanEdit.getPageComponents() || [];
        for (let pi = 0; pi < pcs.length; pi++) {
            if (pcs[pi] && pcs[pi].name === componentName && pcs[pi].pluginId) {
                // If the plugin field was left blank or mistakenly set to a component name, fix it
                if (!pluginId || pluginId === componentName || !pluginId.startsWith("Lean")) {
                    pluginId = pcs[pi].pluginId;
                }
                break;
            }
        }
    }
    let itemType = document.getElementById("ixItemType").value || "ComponentItem";
    let itemCategory = document.getElementById("ixItemCategory").value || "";
    // Whole-component interactions do not use item category / dimensions
    if (itemType === "Component") {
        itemCategory = "";
        dims = [];
    }
    presentationPropertiesWorking.interactions[idx] = {
        method: {mouseClick: !isDbl, mouseDoubleClick: !!isDbl},
        location: {
            componentName: componentName,
            componentPluginId: pluginId,
            itemType: itemType,
            itemCategory: itemCategory,
            dimensionColumns: dims
        },
        actions: [{
            actionType: "OPEN_PRESENTATION",
            objectName: document.getElementById("ixObjectName").value || null,
            valueParameter: document.getElementById("ixValueParameter").value || null
        }]
    };
    // Clean null empty strings for Hop friendliness
    let a = presentationPropertiesWorking.interactions[idx].actions[0];
    if (!a.objectName) {
        delete a.objectName;
    }
    if (!a.valueParameter) {
        delete a.valueParameter;
    }
    markPresentationPropertiesDirty();
    hidePresentationInteractionEditor();
    refreshPresentationInteractionsList();
}

function getPresentationComponentNamesForProps() {
    let names = [];
    if (typeof presentationName === "undefined" || !presentationName) {
        return names;
    }
    // Prefer live page component list from edit mode if exposed
    if (typeof window.leanEdit !== "undefined" && window.leanEdit.getComponentNames) {
        return window.leanEdit.getComponentNames() || [];
    }
    // Sync fetch component names for current page
    if (typeof renderId !== "undefined" && renderId) {
        $.ajax({
            url: API_BASE + "render/info/components/" + encodeURIComponent(renderId)
                + "/" + encodeURIComponent(renderPageNumber0 || 0) + "/",
            type: "GET",
            dataType: "json",
            async: false,
            success: function (list) {
                if (Array.isArray(list)) {
                    names = list;
                } else if (list && list.names) {
                    names = list.names;
                }
            }
        });
    }
    if (!names.length && typeof presentationName !== "undefined") {
        $.ajax({
            url: API_BASE + "edit/presentation/" + encodeURIComponent(presentationName)
                + "/pages/" + encodeURIComponent(renderPageNumber0 || 0) + "/components/",
            type: "GET",
            dataType: "json",
            async: false,
            success: function (list) {
                if (Array.isArray(list)) {
                    for (let i = 0; i < list.length; i++) {
                        if (list[i] && list[i].name) {
                            names.push(list[i].name);
                        }
                    }
                }
            }
        });
    }
    return names;
}

function getPresentationNamesList() {
    let names = [];
    $.ajax({
        url: API_BASE + "metadata/list/presentation/",
        type: "GET",
        dataType: "json",
        async: false,
        success: function (list) {
            names = list || [];
        },
        error: function () {
            $.ajax({
                url: API_BASE + "metadata/presentations/",
                type: "GET",
                dataType: "json",
                async: false,
                success: function (list) {
                    if (Array.isArray(list)) {
                        names = list.map(function (p) {
                            return p.name || p;
                        });
                    }
                }
            });
        }
    });
    return names;
}

// ── Parameter mappings ────────────────────────────────────────────────────

function paramMapSummary(pm) {
    if (!pm) {
        return "(empty)";
    }
    let maps = pm.mappings || [];
    let bits = maps.map(function (m) {
        return (m.fieldName || "?") + "->" + (m.parameterName || "?");
    });
    return (pm.connectorName || "?") + (bits.length ? ": " + bits.join(", ") : "");
}

function refreshPresentationParamMapsList() {
    let root = document.getElementById("presPropParamMapsList");
    if (!root || !presentationPropertiesWorking) {
        return;
    }
    let list = presentationPropertiesWorking.parameterMappings || [];
    if (!list.length) {
        root.innerHTML = "<p class=\"editor-hint\">No parameter mappings yet.</p>";
        return;
    }
    let html = "<ul class=\"pres-prop-card-list\">";
    for (let i = 0; i < list.length; i++) {
        html += "<li class=\"pres-prop-card\">";
        html += "<div class=\"pres-prop-card-summary\">" + escapeHtmlText(paramMapSummary(list[i])) + "</div>";
        html += "<div class=\"pres-prop-card-actions\">";
        html += "<button type=\"button\" data-pm-edit=\"" + i + "\">Edit</button> ";
        html += "<button type=\"button\" data-pm-up=\"" + i + "\" title=\"Move up\">Up</button> ";
        html += "<button type=\"button\" data-pm-down=\"" + i + "\" title=\"Move down\">Down</button> ";
        html += "<button type=\"button\" data-pm-del=\"" + i + "\" title=\"Delete\">Del</button>";
        html += "</div></li>";
    }
    html += "</ul>";
    root.innerHTML = html;
    root.onclick = function (e) {
        let t = e.target;
        if (!t || !t.getAttribute) {
            return;
        }
        if (t.getAttribute("data-pm-edit") != null) {
            openPresentationParamMapEditor(parseInt(t.getAttribute("data-pm-edit"), 10));
        } else if (t.getAttribute("data-pm-del") != null) {
            presentationPropertiesWorking.parameterMappings.splice(
                parseInt(t.getAttribute("data-pm-del"), 10), 1);
            hidePresentationParamMapEditor();
            markPresentationPropertiesDirty();
            refreshPresentationParamMapsList();
        } else if (t.getAttribute("data-pm-up") != null) {
            let ui = parseInt(t.getAttribute("data-pm-up"), 10);
            let a = presentationPropertiesWorking.parameterMappings;
            if (ui > 0) {
                let tmp = a[ui - 1];
                a[ui - 1] = a[ui];
                a[ui] = tmp;
                markPresentationPropertiesDirty();
                refreshPresentationParamMapsList();
            }
        } else if (t.getAttribute("data-pm-down") != null) {
            let di = parseInt(t.getAttribute("data-pm-down"), 10);
            let a = presentationPropertiesWorking.parameterMappings;
            if (di < a.length - 1) {
                let tmp = a[di + 1];
                a[di + 1] = a[di];
                a[di] = tmp;
                markPresentationPropertiesDirty();
                refreshPresentationParamMapsList();
            }
        }
    };
}

function addPresentationParamMapping() {
    if (!presentationPropertiesWorking.parameterMappings) {
        presentationPropertiesWorking.parameterMappings = [];
    }
    presentationPropertiesWorking.parameterMappings.push({
        connectorName: "",
        separator: "",
        mappings: [{fieldName: "", parameterName: ""}]
    });
    markPresentationPropertiesDirty();
    refreshPresentationParamMapsList();
    openPresentationParamMapEditor(presentationPropertiesWorking.parameterMappings.length - 1);
}

function hidePresentationParamMapEditor() {
    let ed = document.getElementById("presPropParamMapEditor");
    if (ed) {
        ed.setAttribute("hidden", "hidden");
        ed.innerHTML = "";
    }
    presentationParamMapEditIndex = -1;
}

function openPresentationParamMapEditor(index) {
    let list = presentationPropertiesWorking.parameterMappings || [];
    if (index < 0 || index >= list.length) {
        return;
    }
    presentationParamMapEditIndex = index;
    let pm = list[index];
    let connOpts = "<option value=\"\">- select -</option>";
    let conns = getConnectorNames().filter(function (n) {
        return n;
    });
    for (let i = 0; i < conns.length; i++) {
        connOpts += "<option value=\"" + escapeHtmlAttribute(conns[i]) + "\""
            + (conns[i] === (pm.connectorName || "") ? " selected" : "") + ">"
            + escapeHtmlText(conns[i]) + "</option>";
    }

    let fieldNames = pm.connectorName
        ? (getConnectorColumnNames(pm.connectorName) || [])
        : [];
    let rows = pm.mappings || [];
    let mapRows = "";
    for (let r = 0; r < rows.length; r++) {
        mapRows += buildParamMapFieldRowHtml(r, rows[r].fieldName || "",
            rows[r].parameterName || "", fieldNames);
    }
    if (!mapRows) {
        mapRows = buildParamMapFieldRowHtml(0, "", "", fieldNames);
    }

    let html = "<h5>Edit parameter mapping</h5>";
    html += "<label for=\"pmConnector\">Connector</label><br>";
    html += "<select id=\"pmConnector\" class=\"pres-prop-input\">" + connOpts + "</select><br>";
    html += "<label for=\"pmSeparator\">Separator (multi-row join)</label><br>";
    html += "<input type=\"text\" id=\"pmSeparator\" class=\"pres-prop-input\" value=\""
        + escapeHtmlAttribute(pm.separator || "") + "\"><br>";
    html += "<table class=\"pres-prop-map-table\"><thead><tr><th>Field name</th><th>Parameter name</th><th></th></tr></thead>";
    html += "<tbody id=\"pmMapBody\">" + mapRows + "</tbody></table>";
    html += "<button type=\"button\" id=\"pmAddRow\">+ Field</button><br><br>";
    html += "<button type=\"button\" id=\"pmEditorOk\" class=\"form-action-save\">OK</button> ";
    html += "<button type=\"button\" id=\"pmEditorCancel\" class=\"form-action-close\">Cancel</button>";

    let ed = document.getElementById("presPropParamMapEditor");
    ed.innerHTML = html;
    ed.removeAttribute("hidden");

    document.getElementById("pmConnector").onchange = function () {
        let cname = this.value;
        let cols = cname ? (getConnectorColumnNames(cname) || []) : [];
        // Rebuild field selects, preserve parameter names and selected fields when possible
        let body = document.getElementById("pmMapBody");
        if (!body) {
            return;
        }
        let preserved = [];
        for (let i = 0; i < body.rows.length; i++) {
            let row = body.rows[i];
            let fieldInp = row.querySelector(".pm-field");
            let paramInp = row.querySelector(".pm-param");
            preserved.push({
                fieldName: fieldInp ? fieldInp.value : "",
                parameterName: paramInp ? paramInp.value : ""
            });
        }
        body.innerHTML = "";
        if (!preserved.length) {
            preserved = [{fieldName: "", parameterName: ""}];
        }
        for (let r = 0; r < preserved.length; r++) {
            body.insertAdjacentHTML("beforeend",
                buildParamMapFieldRowHtml(r, preserved[r].fieldName,
                    preserved[r].parameterName, cols));
        }
    };
    document.getElementById("pmAddRow").onclick = function () {
        let body = document.getElementById("pmMapBody");
        let cname = (document.getElementById("pmConnector") || {}).value || "";
        let cols = cname ? (getConnectorColumnNames(cname) || []) : [];
        let r = body.rows.length;
        body.insertAdjacentHTML("beforeend", buildParamMapFieldRowHtml(r, "", "", cols));
    };
    ed.onclick = function (e) {
        let t = e.target;
        if (t && t.getAttribute && t.getAttribute("data-pm-row-del") != null) {
            let tr = t.closest("tr");
            if (tr) {
                tr.parentNode.removeChild(tr);
            }
        }
    };
    document.getElementById("pmEditorOk").onclick = function () {
        commitPresentationParamMapEditor();
    };
    document.getElementById("pmEditorCancel").onclick = function () {
        hidePresentationParamMapEditor();
    };
}

function buildParamMapFieldRowHtml(r, fieldName, parameterName, fieldNames) {
    fieldNames = fieldNames || [];
    let html = "<tr>";
    html += "<td>";
    if (fieldNames.length) {
        html += "<select class=\"pm-field\" data-r=\"" + r + "\">";
        html += "<option value=\"\">- field -</option>";
        let found = false;
        for (let i = 0; i < fieldNames.length; i++) {
            let fn = fieldNames[i];
            let sel = (fn === fieldName) ? " selected" : "";
            if (fn === fieldName) {
                found = true;
            }
            html += "<option value=\"" + escapeHtmlAttribute(fn) + "\"" + sel + ">"
                + escapeHtmlText(fn) + "</option>";
        }
        if (fieldName && !found) {
            html += "<option value=\"" + escapeHtmlAttribute(fieldName)
                + "\" selected>" + escapeHtmlText(fieldName) + " (custom)</option>";
        }
        html += "</select>";
    } else {
        html += "<input type=\"text\" class=\"pm-field\" data-r=\"" + r + "\" value=\""
            + escapeHtmlAttribute(fieldName || "") + "\" placeholder=\"field name\">";
    }
    html += "</td>";
    html += "<td><input type=\"text\" class=\"pm-param\" data-r=\"" + r + "\" value=\""
        + escapeHtmlAttribute(parameterName || "") + "\" placeholder=\"PARAM_NAME\"></td>";
    html += "<td><button type=\"button\" data-pm-row-del=\"" + r + "\">x</button></td>";
    html += "</tr>";
    return html;
}

function commitPresentationParamMapEditor() {
    let idx = presentationParamMapEditIndex;
    if (idx < 0 || !presentationPropertiesWorking) {
        return;
    }
    let connectorName = (document.getElementById("pmConnector").value || "").trim();
    if (!connectorName) {
        alert("Connector is required for a parameter mapping.");
        return;
    }
    let mappings = [];
    let body = document.getElementById("pmMapBody");
    if (body) {
        for (let i = 0; i < body.rows.length; i++) {
            let row = body.rows[i];
            let fieldInp = row.querySelector(".pm-field");
            let paramInp = row.querySelector(".pm-param");
            let fn = fieldInp ? fieldInp.value.trim() : "";
            let pn = paramInp ? paramInp.value.trim() : "";
            if (fn || pn) {
                if (!fn || !pn) {
                    alert("Each mapping row needs both a field name and a parameter name.");
                    return;
                }
                mappings.push({fieldName: fn, parameterName: pn});
            }
        }
    }
    if (!mappings.length) {
        alert("Add at least one field to parameter mapping.");
        return;
    }
    presentationPropertiesWorking.parameterMappings[idx] = {
        connectorName: connectorName,
        separator: document.getElementById("pmSeparator").value || "",
        mappings: mappings
    };
    markPresentationPropertiesDirty();
    hidePresentationParamMapEditor();
    refreshPresentationParamMapsList();
}

// ── Save / close ──────────────────────────────────────────────────────────

function setPresentationPropertiesStatus(msg, isError) {
    let el = document.getElementById("presPropStatus");
    if (!el) {
        return;
    }
    if (!msg) {
        el.setAttribute("hidden", "hidden");
        el.textContent = "";
        return;
    }
    el.removeAttribute("hidden");
    el.textContent = msg;
    el.style.color = isError ? "#a00" : "#245";
}

/**
 * Validate interactions and parameter mappings before save.
 * @returns {string|null} error message or null if ok
 */
function validatePresentationPropertiesWorking(w) {
    if (!w.name || !w.name.trim()) {
        return "Presentation name is required.";
    }
    let ixs = w.interactions || [];
    for (let i = 0; i < ixs.length; i++) {
        let loc = (ixs[i] && ixs[i].location) || {};
        if (!loc.componentName || !String(loc.componentName).trim()) {
            return "Interaction #" + (i + 1) + " needs a component name.";
        }
        let acts = (ixs[i] && ixs[i].actions) || [];
        if (!acts.length || !acts[0].actionType) {
            return "Interaction #" + (i + 1) + " needs an action.";
        }
    }
    let pms = w.parameterMappings || [];
    for (let j = 0; j < pms.length; j++) {
        let pm = pms[j] || {};
        if (!pm.connectorName || !String(pm.connectorName).trim()) {
            return "Parameter mapping #" + (j + 1) + " needs a connector.";
        }
        let maps = pm.mappings || [];
        if (!maps.length) {
            return "Parameter mapping #" + (j + 1) + " needs at least one field mapping.";
        }
        for (let k = 0; k < maps.length; k++) {
            if (!maps[k].fieldName || !maps[k].parameterName) {
                return "Parameter mapping #" + (j + 1)
                    + " row " + (k + 1) + " needs field and parameter names.";
            }
        }
    }
    return null;
}

function savePresentationProperties() {
    if (!presentationPropertiesWorking) {
        return;
    }
    // Commit open nested editors first
    if (presentationInteractionEditIndex >= 0
        && document.getElementById("presPropInteractionEditor")
        && !document.getElementById("presPropInteractionEditor").hasAttribute("hidden")) {
        // commit may alert and leave editor open on validation failure
        let beforeIx = presentationInteractionEditIndex;
        commitPresentationInteractionEditor();
        if (presentationInteractionEditIndex === beforeIx
            && document.getElementById("presPropInteractionEditor")
            && !document.getElementById("presPropInteractionEditor").hasAttribute("hidden")) {
            return;
        }
    }
    if (presentationParamMapEditIndex >= 0
        && document.getElementById("presPropParamMapEditor")
        && !document.getElementById("presPropParamMapEditor").hasAttribute("hidden")) {
        let beforePm = presentationParamMapEditIndex;
        commitPresentationParamMapEditor();
        if (presentationParamMapEditIndex === beforePm
            && document.getElementById("presPropParamMapEditor")
            && !document.getElementById("presPropParamMapEditor").hasAttribute("hidden")) {
            return;
        }
    }
    collectPresentationPropertiesBasics();
    let w = presentationPropertiesWorking;
    let validationError = validatePresentationPropertiesWorking(w);
    if (validationError) {
        setPresentationPropertiesStatus(validationError, true);
        alert(validationError);
        return;
    }
    let oldName = presentationPropertiesOldName;
    let newName = w.name.trim();
    w.name = newName;

    setPresentationPropertiesStatus("Saving...", false);

    function doPost() {
        $.ajax({
            url: API_BASE + "metadata/presentation/",
            type: "POST",
            data: JSON.stringify(w),
            contentType: "application/json; charset=utf-8",
            dataType: "text",
            success: function (savedName) {
                let finalName = savedName || newName;
                // Rename: delete old if name changed
                if (oldName && finalName && oldName !== finalName) {
                    $.ajax({
                        url: API_BASE + "metadata/presentation/" + encodeURIComponent(oldName),
                        type: "DELETE",
                        async: false
                    });
                }
                // Header / footer via dedicated API
                savePresentationHeaderFooterFromForm(finalName, function () {
                    presentationName = finalName;
                    presentationJson = w;
                    presentationPropertiesOldName = finalName;
                    clearPresentationPropertiesDirty();
                    updatePresentationTitleBar(finalName);
                    // If renamed, navigate to new editor URL so bookmarks stay valid
                    if (oldName && finalName && oldName !== finalName) {
                        window.open(
                            API_BASE + "edit/presentation/" + encodeURIComponent(finalName) + "/",
                            "_self"
                        );
                        return;
                    }
                    // Soft reload so interactions / themes / header-footer take effect
                    if (typeof softReloadEditor === "function") {
                        softReloadEditor();
                    }
                    if (typeof window.leanEdit !== "undefined"
                        && typeof window.leanEdit.refreshHeaderFooter === "function") {
                        window.leanEdit.refreshHeaderFooter();
                    }
                    setPresentationPropertiesStatus("Saved: " + finalName, false);
                });
            },
            error: function (xhr) {
                let msg = "Save failed: " + (xhr.responseText || xhr.status);
                setPresentationPropertiesStatus(msg, true);
                alert(msg);
            }
        });
    }

    // Optionally embed default theme if missing from presentation.themes
    ensureDefaultThemeEmbedded(w, doPost);
}

function savePresentationHeaderFooterFromForm(name, done) {
    let chkH = document.getElementById("presPropHeaderEnabled");
    let chkF = document.getElementById("presPropFooterEnabled");
    let hH = document.getElementById("presPropHeaderHeight");
    let hF = document.getElementById("presPropFooterHeight");
    if (!chkH && !chkF) {
        if (done) {
            done();
        }
        return;
    }
    let body = {
        header: {
            enabled: chkH ? !!chkH.checked : false,
            height: hH ? (parseInt(hH.value, 10) || 50) : 50
        },
        footer: {
            enabled: chkF ? !!chkF.checked : false,
            height: hF ? (parseInt(hF.value, 10) || 25) : 25
        }
    };
    $.ajax({
        url: API_BASE + "edit/presentation/" + encodeURIComponent(name) + "/header-footer/",
        type: "POST",
        data: JSON.stringify(body),
        contentType: "application/json; charset=utf-8",
        dataType: "json",
        success: function () {
            if (done) {
                done();
            }
        },
        error: function (xhr) {
            console.warn("header-footer save failed:", xhr.responseText);
            if (done) {
                done();
            }
        }
    });
}

function closePresentationProperties() {
    if (presentationPropertiesWorking && isPresentationPropertiesDirty()) {
        if (!confirm("Discard unsaved presentation property changes?")) {
            return;
        }
    }
    presentationPropertiesWorking = null;
    presentationPropertiesBaseline = null;
    presentationPropertiesDirty = false;
    presentationInteractionEditIndex = -1;
    presentationParamMapEditIndex = -1;
    setSidePanelOpen(false);
}

/** @deprecated */
function savePresentation() {
    savePresentationProperties();
}

function closePresentation() {
    closePresentationProperties();
}

function addPresentationPage() {
    alert("Add page: not yet implemented in properties panel");
}
// ---------------------------------------------------------------------------
// Nested LeanComponent editors (Group.groupComponent, Composite.children, …)
// Driven by window.componentCatalog from generated form schemas.
// ---------------------------------------------------------------------------

let nestedComponentSeq = 0;

function catalogById(pluginId) {
    if (!window.componentCatalog) {
        return null;
    }
    for (let i = 0; i < window.componentCatalog.length; i++) {
        if (window.componentCatalog[i].pluginId === pluginId) {
            return window.componentCatalog[i];
        }
    }
    return null;
}

function catalogPluginIds() {
    if (!window.componentCatalog) {
        return [];
    }
    return window.componentCatalog.map(c => c.pluginId);
}

function initNestedComponentPanel(prefix) {
    let panel = document.getElementById(prefix + "_panel");
    if (panel === null) {
        return;
    }
    panel.innerHTML = buildNestedComponentShellHtml(prefix, false);
    wireNestedComponentShell(prefix);
}

function initNestedComponentList(prefix) {
    let items = document.getElementById(prefix + "_items");
    if (items === null) {
        return;
    }
    items.innerHTML = "";
}

function buildNestedComponentShellHtml(prefix, withRemove) {
    let options = "";
    let ids = catalogPluginIds();
    for (let i = 0; i < ids.length; i++) {
        let info = catalogById(ids[i]);
        let label = info && info.name ? info.name : ids[i];
        options += '<option value="' + ids[i] + '">' + label + " (" + ids[i] + ")</option>";
    }
    let removeBtn = withRemove
        ? '<button type="button" onclick="nestedComponentListRemove(this)">Remove</button>'
        : "";
    return ""
        + '<div class="nested-component-shell" data-prefix="' + prefix + '">'
        + '  <label>Name </label><input type="text" id="' + prefix + '_name" style="width: 40%">'
        + '  <label> Type </label><select id="' + prefix + '_pluginId" style="width: 40%">' + options + '</select>'
        + "  " + removeBtn + "<br>"
        + '  <div id="' + prefix + '_pluginFields" class="nested-plugin-fields" style="margin-left: 8px; border-left: 2px solid #ccc; padding-left: 8px;"></div>'
        + '  <button type="button" class="collapsible nested-layout-toggle">Layout</button>'
        + '  <div class="content nested-layout" id="' + prefix + '_layout" style="display: none;">'
        + buildNestedLayoutHtml(prefix)
        + "  </div>"
        + "</div>";
}

function buildNestedLayoutHtml(prefix) {
    let sides = ["left", "right", "top", "bottom"];
    let html = "";
    for (let s = 0; s < sides.length; s++) {
        let side = sides[s];
        let cap = side.charAt(0).toUpperCase() + side.slice(1);
        html += '<fieldset style="border-width:1px;border-color:#999;margin:4px 0;">'
            + "<legend>" + cap + "</legend>"
            + '<label><input type="checkbox" id="' + prefix + '_' + side + 'Enabled"> enabled</label> '
            + 'to <select id="' + prefix + '_' + side + 'ObjectName" style="width:40%"></select><br>'
            + 'Offset <input type="text" id="' + prefix + '_' + side + 'Offset" style="width:15%"> '
            + 'Pct <input type="text" id="' + prefix + '_' + side + 'Percentage" style="width:15%"> '
            + 'From <select id="' + prefix + '_' + side + 'Alignment" style="width:20%"></select>'
            + "</fieldset>";
    }
    return html;
}

function wireNestedComponentShell(prefix) {
    let typeSelect = document.getElementById(prefix + "_pluginId");
    if (typeSelect !== null) {
        typeSelect.onchange = function () {
            rebuildNestedPluginFields(prefix, typeSelect.value, null);
        };
        if (typeSelect.options.length > 0 && !typeSelect.value) {
            typeSelect.selectedIndex = 0;
        }
        if (typeSelect.value) {
            rebuildNestedPluginFields(prefix, typeSelect.value, null);
        }
    }
    // layout alignment options
    let sides = ["left", "right", "top", "bottom"];
    for (let s = 0; s < sides.length; s++) {
        let side = sides[s];
        let obj = document.getElementById(prefix + "_" + side + "ObjectName");
        if (obj && typeof componentNames !== "undefined" && componentNames !== null) {
            setSelectOptions(prefix + "_" + side + "ObjectName", componentNames);
        }
        let align = document.getElementById(prefix + "_" + side + "Alignment");
        if (align) {
            // LeanAttachment.Alignment (CENTER), not content LeanVerticalAlignment (MIDDLE)
            let vals = (side === "left" || side === "right")
                ? (typeof LAYOUT_HORIZONTAL_ALIGNMENTS !== "undefined"
                    ? LAYOUT_HORIZONTAL_ALIGNMENTS
                    : ["DEFAULT", "LEFT", "RIGHT", "CENTER"])
                : (typeof LAYOUT_VERTICAL_ALIGNMENTS !== "undefined"
                    ? LAYOUT_VERTICAL_ALIGNMENTS
                    : ["DEFAULT", "TOP", "BOTTOM", "CENTER"]);
            align.innerHTML = "";
            for (let i = 0; i < vals.length; i++) {
                addOptionToSelect(align, vals[i]);
            }
        }
    }
    // collapsible for this shell only
    let shell = document.querySelector('.nested-component-shell[data-prefix="' + prefix + '"]');
    if (shell) {
        let toggles = shell.querySelectorAll(".nested-layout-toggle");
        for (let t = 0; t < toggles.length; t++) {
            toggles[t].onclick = function () {
                let c = this.nextElementSibling;
                if (c.style.display === "block") {
                    c.style.display = "none";
                } else {
                    c.style.display = "block";
                }
            };
        }
    }
}

function rebuildNestedPluginFields(prefix, pluginId, values) {
    let container = document.getElementById(prefix + "_pluginFields");
    if (container === null) {
        return;
    }
    container.innerHTML = "";
    let info = catalogById(pluginId);
    if (info === null || !info.sections) {
        container.innerHTML = "<em>No form schema for " + pluginId + "</em>";
        return;
    }
    let pluginValues = values || {};
    for (let s = 0; s < info.sections.length; s++) {
        let section = info.sections[s];
        let title = section.title || section.id;
        let open = section.openByDefault ? "block" : "none";
        let secId = prefix + "_sec_" + section.id;
        let secHtml = '<button type="button" class="collapsible nested-sec-toggle">' + title + "</button>"
            + '<div class="content" id="' + secId + '" style="display: ' + open + ';">';
        container.insertAdjacentHTML("beforeend", secHtml);
        let secDiv = document.getElementById(secId);
        for (let f = 0; f < (section.fields || []).length; f++) {
            appendNestedFieldControl(secDiv, prefix, section.fields[f], pluginValues);
        }
        // wire section toggle
        let btn = secDiv.previousElementSibling;
        if (btn) {
            btn.onclick = function () {
                let c = this.nextElementSibling;
                c.style.display = c.style.display === "block" ? "none" : "block";
            };
        }
    }
}

function nestedFieldDomId(prefix, field) {
    return prefix + "_f_" + field.id;
}

function appendNestedFieldControl(container, prefix, field, pluginValues) {
    let domId = nestedFieldDomId(prefix, field);
    let type = field.type;
    let label = field.label || field.fieldName || field.id;
    let val = pluginValues ? pluginValues[field.fieldName] : null;

    if (type === "COMPONENT") {
        let wrap = document.createElement("div");
        wrap.innerHTML = '<fieldset style="border:1px solid #aaa;margin:6px 0;padding:6px;"><legend>'
            + label + '</legend><div id="' + domId + '_panel" data-prefix="' + domId + '"></div></fieldset>';
        container.appendChild(wrap);
        let panel = document.getElementById(domId + "_panel");
        panel.innerHTML = buildNestedComponentShellHtml(domId, false);
        wireNestedComponentShell(domId);
        if (val) {
            loadNestedComponentIntoPanel(domId, val);
        }
        return;
    }

    if (type === "LIST" && field.itemKind === "component") {
        let wrap = document.createElement("div");
        wrap.innerHTML = '<fieldset style="border:1px solid #aaa;margin:6px 0;padding:6px;"><legend>'
            + label + '</legend>'
            + '<div id="' + domId + '_items"></div>'
            + '<button type="button" onclick="nestedComponentListAdd(\'' + domId + '\')">Add child</button>'
            + "</fieldset>";
        container.appendChild(wrap);
        if (val && Array.isArray(val)) {
            setNestedComponentList({[field.fieldName]: val}, field.fieldName, domId);
        }
        return;
    }

    if (type === "LIST" && field.itemKind === "connector") {
        let wrap = document.createElement("div");
        wrap.innerHTML = '<fieldset class="nested-connector-list-fieldset" style="border:1px solid #aaa;margin:6px 0;padding:6px;">'
            + "<legend>" + label + "</legend>"
            + '<div id="' + domId + '_items" class="nested-connector-list" data-prefix="' + domId + '"></div>'
            + '<button type="button" onclick="nestedConnectorListAdd(\'' + domId + '\')">Add step</button>'
            + "</fieldset>";
        container.appendChild(wrap);
        let tmp = {};
        tmp[field.fieldName] = val || [];
        setNestedConnectorList(tmp, field.fieldName, domId);
        return;
    }

    if (type === "LIST") {
        // column / fact / string tables — Add/Delete in header, Up/Down on rows
        let tableId = domId;
        let kind = field.itemKind || "column";
        let headers;
        if (kind === "fact") {
            headers = "<tr><th>Column</th><th>Header</th><th>Width</th><th>H</th><th>V</th><th>Format</th><th>H-Agg</th><th>V-Agg</th><th>Method</th><th></th><th></th><th></th></tr>";
        } else if (kind === "string") {
            headers = "<tr><th>Value</th><th></th><th></th><th></th></tr>";
        } else if (kind === "sort") {
            headers = "<tr><th>Type</th><th>Ascending</th><th></th><th></th><th></th></tr>";
        } else if (kind === "filter") {
            headers = "<tr><th>Field name</th><th>Filter value</th><th></th><th></th><th></th></tr>";
        } else if (kind === "groupKey") {
            headers = "<tr><th>Group column</th><th>Connector column</th><th></th><th></th><th></th></tr>";
        } else if (kind === "jsonField") {
            headers = "<tr><th>JSON tag</th><th>Name</th><th>Type</th><th>Format</th><th>Length</th><th>Precision</th><th></th><th></th><th></th></tr>";
        } else if (kind === "connector" || kind === "bean") {
            headers = "<tr><th>Plugin JSON (advanced)</th><th></th><th></th><th></th></tr>";
        } else {
            headers = "<tr><th>Column</th><th>Header</th><th>Width</th><th>H</th><th>V</th><th>Format</th><th></th><th></th><th></th></tr>";
        }
        let wrap = document.createElement("div");
        wrap.innerHTML =
            '<div class="list-field-header">'
            + "<label>" + label + "</label>"
            + '<span class="list-field-toolbar">'
            + '<button type="button" class="list-toolbar-btn" title="Add row" onclick="listFieldAdd(\'' + tableId + '\')">'
            + '<img src="' + API_BASE + 'static/images/add-item.svg" alt="Add" width="16" height="16">'
            + "</button>"
            + "</span></div>"
            + '<table id="' + tableId + '" class="list-field-table" data-list-kind="' + kind
            + '" data-column-prefix="' + domId + '">' + headers + "</table>";
        container.appendChild(wrap);
        let sourceName = pluginValues ? pluginValues["sourceConnectorName"] : null;
        let colNames = (typeof getConnectorColumnNames === "function" && sourceName)
            ? getConnectorColumnNames(sourceName) : [];
        let tmp = {};
        tmp[field.fieldName] = val || [];
        if (kind === "fact") {
            setFacts(tmp, field.fieldName, tableId, domId, colNames);
        } else if (kind === "string") {
            setStringList(tmp, field.fieldName, tableId);
        } else if (kind === "sort") {
            setSortMethods(tmp, field.fieldName, tableId);
        } else if (kind === "filter") {
            setFilterValues(tmp, field.fieldName, tableId, colNames);
        } else if (kind === "groupKey") {
            setGroupKeyMappings(tmp, field.fieldName, tableId);
        } else if (kind === "jsonField") {
            setJsonFields(tmp, field.fieldName, tableId);
        } else if (kind === "bean") {
            setJsonObjectList(tmp, field.fieldName, tableId);
        } else {
            setColumns(tmp, field.fieldName, tableId, domId, colNames);
        }
        return;
    }

    if (type === "CHECKBOX") {
        let checked = val === true ? " checked" : "";
        container.insertAdjacentHTML("beforeend",
            '<input type="checkbox" id="' + domId + '"' + checked + '> <label for="' + domId + '">' + label + "</label><br>");
        return;
    }

    if (type === "COMBO" || type === "METADATA") {
        let source = field.comboSource || "none";
        let options = field.comboValues || [];
        if (source && source !== "none") {
            options = resolveSelectSourceValues(source, {
                dependsOn: field.comboDependsOn || "sourceConnectorName",
                metadataKey: field.metadataKey || "",
                staticValues: field.comboValues || []
            });
        } else {
            if (field.fieldName === "themeName") {
                options = themeNames || getThemeNames();
            }
            if (field.fieldName === "sourceConnectorName") {
                options = connectorNames || getPresentationConnectorNames();
            }
        }
        // Preserve stored combo value when not in live options (e.g. connector columns offline)
        let missingVal = false;
        if (val !== null && val !== undefined && val !== ""
            && !optionsIncludeValue(options, val)) {
            options = [val].concat(options || []);
            missingVal = true;
        }
        let preserveAttr = "";
        if (val !== null && val !== undefined && val !== "") {
            preserveAttr = ' data-preserve-value="'
                + String(val).replace(/&/g, "&amp;").replace(/"/g, "&quot;") + '"';
        }
        let html = "<label for=\"" + domId + "\">" + label + ' </label><select id="'
            + domId + '" style="width:50%"' + preserveAttr + ">";
        for (let i = 0; i < options.length; i++) {
            let isMissing = missingVal && String(options[i]) === String(val);
            let display = optionDisplayText(options[i], isMissing);
            let sel = (val !== null && val !== undefined && String(val) === String(options[i]))
                ? " selected" : "";
            let safeVal = String(options[i] == null ? "" : options[i])
                .replace(/&/g, "&amp;").replace(/"/g, "&quot;");
            let safeDisplay = String(display).replace(/&/g, "&amp;").replace(/</g, "&lt;");
            html += '<option value="' + safeVal + '"' + sel
                + (isMissing ? ' data-missing-source="true"' : "")
                + ">" + safeDisplay + "</option>";
        }
        html += "</select><br>";
        container.insertAdjacentHTML("beforeend", html);
        if (source === "connectorColumns") {
            connectorColumnSelects.push({
                selectId: domId,
                dependsOn: (prefix ? prefix + "_f_" : "") + (field.comboDependsOn || "sourceConnectorName")
            });
        }
        return;
    }

    if (type === "COLOR") {
        // simplified color: optional enable + color input
        let setId = domId + "_set";
        let has = val !== null && val !== undefined;
        let hex = has ? rgbToHex(val.r, val.g, val.b) : "#000000";
        container.insertAdjacentHTML("beforeend",
            '<input type="checkbox" id="' + setId + '"' + (has ? " checked" : "") + "> "
            + "<label>" + label + ' </label><input type="color" id="' + domId + '" value="' + hex + '"><br>');
        return;
    }

    if (type === "FONT") {
        let setId = domId + "_set";
        let has = val !== null && val !== undefined;
        let name = has ? (val.fontName || "") : "";
        let size = has ? (val.fontSize || "") : "";
        let bold = has && val.bold ? " checked" : "";
        let italic = has && val.italic ? " checked" : "";
        container.insertAdjacentHTML("beforeend",
            '<input type="checkbox" id="' + setId + '"' + (has ? " checked" : "") + "> "
            + "<label>" + label + ' </label>'
            + '<input type="text" id="' + domId + 'Name" value="' + name + '" style="width:25%">'
            + '<input type="text" id="' + domId + 'Size" value="' + size + '" style="width:10%">'
            + " bold<input type=\"checkbox\" id=\"" + domId + "Bold\"" + bold + ">"
            + " italic<input type=\"checkbox\" id=\"" + domId + "Italic\"" + italic + "><br>");
        return;
    }

    // MULTI_LINE_TEXT
    if (type === "MULTI_LINE_TEXT") {
        let textVal = val === null || val === undefined ? "" : String(val);
        let rows = Math.max(1, field.multiLineTextHeight || 4);
        container.insertAdjacentHTML("beforeend",
            "<label for=\"" + domId + "\">" + label + " </label><br>"
            + '<textarea id="' + domId + '" rows="' + rows + '" style="width:90%">'
            + textVal.replace(/&/g, "&amp;").replace(/</g, "&lt;")
            + "</textarea><br>");
        return;
    }

    // TEXT and default
    let textVal = val === null || val === undefined ? "" : val;
    container.insertAdjacentHTML("beforeend",
        "<label for=\"" + domId + "\">" + label + ' </label>'
        + '<input type="text" id="' + domId + '" value="' + String(textVal).replace(/"/g, "&quot;") + '"><br>');
}

function setNestedComponent(parentObj, fieldName, prefix) {
    initNestedComponentPanel(prefix);
    let nested = parentObj[fieldName];
    if (nested === null || nested === undefined) {
        return;
    }
    loadNestedComponentIntoPanel(prefix, nested);
}

function loadNestedComponentIntoPanel(prefix, nested) {
    let nameEl = document.getElementById(prefix + "_name");
    if (nameEl) {
        nameEl.value = nested.name || "";
    }
    let pluginMap = nested.component || {};
    let pluginId = Object.keys(pluginMap)[0];
    let typeSelect = document.getElementById(prefix + "_pluginId");
    if (typeSelect && pluginId) {
        typeSelect.value = pluginId;
        rebuildNestedPluginFields(prefix, pluginId, pluginMap[pluginId] || {});
    }
    loadNestedLayout(prefix, nested.layout);
}

function loadNestedLayout(prefix, layout) {
    if (!layout) {
        return;
    }
    let sides = ["left", "right", "top", "bottom"];
    for (let s = 0; s < sides.length; s++) {
        let side = sides[s];
        let att = layout[side];
        let enabled = document.getElementById(prefix + "_" + side + "Enabled");
        if (!enabled) {
            continue;
        }
        if (att) {
            enabled.checked = true;
            let obj = document.getElementById(prefix + "_" + side + "ObjectName");
            if (obj) {
                obj.value = att.componentName || "";
            }
            let off = document.getElementById(prefix + "_" + side + "Offset");
            if (off) {
                off.value = att.offset !== undefined ? att.offset : 0;
            }
            let pct = document.getElementById(prefix + "_" + side + "Percentage");
            if (pct) {
                pct.value = att.percentage !== undefined ? att.percentage : 0;
            }
            let al = document.getElementById(prefix + "_" + side + "Alignment");
            if (al) {
                al.value = att.alignment || "DEFAULT";
            }
        } else {
            enabled.checked = false;
        }
    }
}

function getNestedComponent(parentObj, fieldName, prefix) {
    parentObj[fieldName] = readNestedComponentFromPanel(prefix);
}

function readNestedComponentFromPanel(prefix) {
    let nameEl = document.getElementById(prefix + "_name");
    let typeSelect = document.getElementById(prefix + "_pluginId");
    if (!nameEl || !typeSelect) {
        return null;
    }
    let pluginId = typeSelect.value;
    let info = catalogById(pluginId);
    let pluginValues = {};
    if (info && info.sections) {
        for (let s = 0; s < info.sections.length; s++) {
            let fields = info.sections[s].fields || [];
            for (let f = 0; f < fields.length; f++) {
                readNestedFieldValue(prefix, fields[f], pluginValues);
            }
        }
    }
    pluginValues["pluginId"] = pluginId;
    return {
        "name": nameEl.value,
        "shared": false,
        "layout": readNestedLayout(prefix),
        "component": (function () {
            let m = {};
            m[pluginId] = pluginValues;
            return m;
        })()
    };
}

function readNestedFieldValue(prefix, field, pluginValues) {
    let domId = nestedFieldDomId(prefix, field);
    let type = field.type;
    let key = field.fieldName;

    if (type === "COMPONENT") {
        pluginValues[key] = readNestedComponentFromPanel(domId);
        return;
    }
    if (type === "LIST" && field.itemKind === "component") {
        let tmp = {};
        getNestedComponentList(tmp, key, domId);
        pluginValues[key] = tmp[key];
        return;
    }
    if (type === "LIST") {
        let tmp = {};
        let kind = field.itemKind || "column";
        if (kind === "fact") {
            getFacts(tmp, key, domId);
        } else if (kind === "string") {
            getStringList(tmp, key, domId);
        } else if (kind === "sort") {
            getSortMethods(tmp, key, domId);
        } else if (kind === "filter") {
            getFilterValues(tmp, key, domId);
        } else if (kind === "groupKey") {
            getGroupKeyMappings(tmp, key, domId);
        } else if (kind === "jsonField") {
            getJsonFields(tmp, key, domId);
        } else if (kind === "connector") {
            getNestedConnectorList(tmp, key, domId);
        } else if (kind === "bean") {
            getJsonObjectList(tmp, key, domId);
        } else {
            getColumns(tmp, key, domId);
        }
        pluginValues[key] = tmp[key];
        return;
    }
    if (type === "CHECKBOX") {
        let el = document.getElementById(domId);
        pluginValues[key] = el ? el.checked : false;
        return;
    }
    if (type === "COLOR") {
        let setEl = document.getElementById(domId + "_set");
        if (setEl && setEl.checked) {
            let colorEl = document.getElementById(domId);
            pluginValues[key] = colorEl ? hexToRgb(colorEl.value) : null;
            // mirror flags for border/background style when field names match
            if (key === "borderColor") {
                pluginValues["border"] = true;
            }
            if (key === "backGroundColor") {
                pluginValues["background"] = true;
            }
        } else {
            pluginValues[key] = null;
            if (key === "borderColor") {
                pluginValues["border"] = false;
            }
            if (key === "backGroundColor") {
                pluginValues["background"] = false;
            }
        }
        return;
    }
    if (type === "FONT") {
        let setEl = document.getElementById(domId + "_set");
        if (setEl && setEl.checked) {
            pluginValues[key] = {
                "fontName": document.getElementById(domId + "Name").value,
                "fontSize": toInteger(document.getElementById(domId + "Size").value),
                "bold": document.getElementById(domId + "Bold").checked,
                "italic": document.getElementById(domId + "Italic").checked
            };
        } else {
            pluginValues[key] = null;
        }
        return;
    }
    let el = document.getElementById(domId);
    if (!el) {
        return;
    }
    if (field.integerValue) {
        pluginValues[key] = toInteger(el.value);
    } else {
        pluginValues[key] = el.value;
    }
}

function readNestedLayout(prefix) {
    let layout = {};
    let sides = ["left", "right", "top", "bottom"];
    for (let s = 0; s < sides.length; s++) {
        let side = sides[s];
        let enabled = document.getElementById(prefix + "_" + side + "Enabled");
        if (enabled && enabled.checked) {
            layout[side] = {
                "componentName": document.getElementById(prefix + "_" + side + "ObjectName").value || null,
                "offset": parseInt(document.getElementById(prefix + "_" + side + "Offset").value) || 0,
                "percentage": parseInt(document.getElementById(prefix + "_" + side + "Percentage").value) || 0,
                "alignment": normalizeLayoutAlignment(
                    document.getElementById(prefix + "_" + side + "Alignment").value)
            };
        } else {
            layout[side] = null;
        }
    }
    return layout;
}

function setNestedComponentList(parentObj, fieldName, prefix) {
    let items = document.getElementById(prefix + "_items");
    if (items === null) {
        return;
    }
    items.innerHTML = "";
    let list = parentObj[fieldName];
    if (!list || !Array.isArray(list)) {
        return;
    }
    for (let i = 0; i < list.length; i++) {
        nestedComponentListAppend(prefix, list[i]);
    }
}

function getNestedComponentList(parentObj, fieldName, prefix) {
    let items = document.getElementById(prefix + "_items");
    let result = [];
    if (items) {
        let shells = items.querySelectorAll(":scope > .nested-component-list-item");
        for (let i = 0; i < shells.length; i++) {
            let p = shells[i].getAttribute("data-prefix");
            result.push(readNestedComponentFromPanel(p));
        }
    }
    parentObj[fieldName] = result;
}

function nestedComponentListAdd(prefix) {
    nestedComponentListAppend(prefix, null);
}

function nestedComponentListAppend(prefix, nestedValue) {
    let items = document.getElementById(prefix + "_items");
    if (items === null) {
        return;
    }
    let childPrefix = prefix + "_c" + (nestedComponentSeq++);
    let wrap = document.createElement("div");
    wrap.className = "nested-component-list-item";
    wrap.setAttribute("data-prefix", childPrefix);
    wrap.style.border = "1px dashed #888";
    wrap.style.margin = "6px 0";
    wrap.style.padding = "6px";
    wrap.innerHTML = buildNestedComponentShellHtml(childPrefix, true);
    items.appendChild(wrap);
    wireNestedComponentShell(childPrefix);
    if (nestedValue) {
        loadNestedComponentIntoPanel(childPrefix, nestedValue);
    } else {
        // default to Label if available
        let typeSelect = document.getElementById(childPrefix + "_pluginId");
        if (typeSelect) {
            if (catalogById("LeanLabelComponent")) {
                typeSelect.value = "LeanLabelComponent";
            }
            rebuildNestedPluginFields(childPrefix, typeSelect.value, null);
        }
    }
}

function nestedComponentListRemove(btn) {
    let item = btn.closest(".nested-component-list-item");
    if (item) {
        item.remove();
    }
}

// ---------------------------------------------------------------------------
// Nested connector steps (ChainConnector.connectors, …)
// Driven by window.connectorCatalog from generated form schemas.
// Nested sourceConnectorName is hidden — chain wiring sets it at runtime.
// ---------------------------------------------------------------------------

let nestedConnectorSeq = 0;

/** Plugin ids that are poor choices as nested chain steps (or recurse too easily). */
const NESTED_CONNECTOR_EXCLUDE = {
    "ChainConnector": true
};

function connectorCatalogById(pluginId) {
    if (!window.connectorCatalog) {
        return null;
    }
    for (let i = 0; i < window.connectorCatalog.length; i++) {
        if (window.connectorCatalog[i].pluginId === pluginId) {
            return window.connectorCatalog[i];
        }
    }
    return null;
}

function connectorCatalogPluginIds() {
    if (!window.connectorCatalog) {
        return [];
    }
    let ids = [];
    for (let i = 0; i < window.connectorCatalog.length; i++) {
        let id = window.connectorCatalog[i].pluginId;
        if (id && !NESTED_CONNECTOR_EXCLUDE[id]) {
            ids.push(id);
        }
    }
    return ids;
}

function initNestedConnectorList(prefix) {
    let items = document.getElementById(prefix + "_items");
    if (items === null) {
        return;
    }
    items.innerHTML = "";
}

/**
 * Normalize hop/form step JSON to a flat plugin payload with pluginId.
 * Accepts either { pluginId, …fields } or { SelectionConnector: { … } }.
 */
function unwrapConnectorStep(obj) {
    if (!obj || typeof obj !== "object") {
        return {pluginId: "PassthroughConnector"};
    }
    if (obj.pluginId) {
        return obj;
    }
    let keys = Object.keys(obj);
    if (keys.length === 1 && obj[keys[0]] && typeof obj[keys[0]] === "object") {
        let inner = Object.assign({}, obj[keys[0]]);
        if (!inner.pluginId) {
            inner.pluginId = keys[0];
        }
        return inner;
    }
    return obj;
}

function setNestedConnectorList(parentObj, fieldName, prefix) {
    let items = document.getElementById(prefix + "_items");
    if (items === null) {
        return;
    }
    items.innerHTML = "";
    let list = parentObj[fieldName];
    if (!list || !Array.isArray(list)) {
        return;
    }
    for (let i = 0; i < list.length; i++) {
        nestedConnectorListAppend(prefix, unwrapConnectorStep(list[i]));
    }
}

function getNestedConnectorList(parentObj, fieldName, prefix) {
    let items = document.getElementById(prefix + "_items");
    let result = [];
    if (items) {
        let shells = items.querySelectorAll(":scope > .nested-connector-list-item");
        for (let i = 0; i < shells.length; i++) {
            let p = shells[i].getAttribute("data-prefix");
            let step = readNestedConnectorFromPanel(p);
            if (step) {
                result.push(step);
            }
        }
    }
    parentObj[fieldName] = result;
}

function nestedConnectorListAdd(prefix) {
    nestedConnectorListAppend(prefix, null);
}

function nestedConnectorListAppend(prefix, stepValue) {
    let items = document.getElementById(prefix + "_items");
    if (items === null) {
        return;
    }
    let childPrefix = prefix + "_s" + (nestedConnectorSeq++);
    let wrap = document.createElement("div");
    wrap.className = "nested-connector-list-item";
    wrap.setAttribute("data-prefix", childPrefix);
    wrap.innerHTML = buildNestedConnectorShellHtml(childPrefix);
    items.appendChild(wrap);
    wireNestedConnectorShell(childPrefix);
    if (stepValue) {
        loadNestedConnectorIntoPanel(childPrefix, stepValue);
    } else {
        let typeSelect = document.getElementById(childPrefix + "_pluginId");
        if (typeSelect) {
            let preferred = ["SelectionConnector", "SimpleFilterConnector", "SortConnector",
                "DistinctConnector", "PassthroughConnector"];
            for (let p = 0; p < preferred.length; p++) {
                if (connectorCatalogById(preferred[p])) {
                    typeSelect.value = preferred[p];
                    break;
                }
            }
            if (!typeSelect.value && typeSelect.options.length) {
                typeSelect.selectedIndex = 0;
            }
            rebuildNestedConnectorPluginFields(childPrefix, typeSelect.value, null);
            updateNestedConnectorStepSummary(childPrefix);
        }
    }
}

function nestedConnectorListRemove(btn) {
    let item = btn.closest(".nested-connector-list-item");
    if (item) {
        item.remove();
    }
}

function nestedConnectorListMoveUp(btn) {
    let item = btn.closest(".nested-connector-list-item");
    if (!item || !item.parentNode) {
        return;
    }
    let prev = item.previousElementSibling;
    if (prev && prev.classList.contains("nested-connector-list-item")) {
        item.parentNode.insertBefore(item, prev);
    }
}

function nestedConnectorListMoveDown(btn) {
    let item = btn.closest(".nested-connector-list-item");
    if (!item || !item.parentNode) {
        return;
    }
    let next = item.nextElementSibling;
    if (next && next.classList.contains("nested-connector-list-item")) {
        item.parentNode.insertBefore(next, item);
    }
}

function buildNestedConnectorShellHtml(prefix) {
    let options = "";
    let ids = connectorCatalogPluginIds();
    for (let i = 0; i < ids.length; i++) {
        let info = connectorCatalogById(ids[i]);
        let label = info && info.name ? info.name : ids[i];
        options += '<option value="' + ids[i] + '">' + label + " (" + ids[i] + ")</option>";
    }
    if (!options) {
        // Fallback when catalog missing
        ["SelectionConnector", "SortConnector", "SimpleFilterConnector", "DistinctConnector",
            "PassthroughConnector", "SqlConnector", "SampleDataConnector", "LeanRestConnector",
            "LeanListConnector"].forEach(function (id) {
            options += '<option value="' + id + '">' + id + "</option>";
        });
    }
    let iconSrc = API_BASE + "static/images/connector.svg";
    return ""
        + '<div class="nested-connector-shell" data-prefix="' + prefix + '">'
        + '  <div class="nested-connector-step-header">'
        + '    <img class="nested-connector-step-icon" id="' + prefix + '_icon" src="' + iconSrc
        + '" width="18" height="18" alt="">'
        + '    <span class="nested-connector-step-summary" id="' + prefix + '_summary">Step</span>'
        + '    <label class="nested-connector-type-label">Type </label>'
        + '    <select id="' + prefix + '_pluginId" class="nested-connector-type-select">' + options + "</select>"
        + '    <span class="nested-connector-step-actions">'
        + '      <button type="button" class="list-row-btn" title="Move up" '
        + 'onclick="nestedConnectorListMoveUp(this)">'
        + '<img src="' + API_BASE + 'static/images/arrow-up.svg" alt="Up" width="14" height="14"></button>'
        + '      <button type="button" class="list-row-btn" title="Move down" '
        + 'onclick="nestedConnectorListMoveDown(this)">'
        + '<img src="' + API_BASE + 'static/images/arrow-down.svg" alt="Down" width="14" height="14"></button>'
        + '      <button type="button" class="list-row-btn" title="Remove step" '
        + 'onclick="nestedConnectorListRemove(this)">'
        + '<img src="' + API_BASE + 'static/images/delete.svg" alt="Remove" width="14" height="14"></button>'
        + '      <button type="button" class="nested-connector-toggle" id="' + prefix
        + '_toggle" title="Expand or collapse settings">Settings</button>'
        + "    </span>"
        + "  </div>"
        + '  <div id="' + prefix + '_pluginFields" class="nested-connector-plugin-fields" style="display:none;"></div>'
        + "</div>";
}

function wireNestedConnectorShell(prefix) {
    let typeSelect = document.getElementById(prefix + "_pluginId");
    if (typeSelect) {
        typeSelect.onchange = function () {
            rebuildNestedConnectorPluginFields(prefix, typeSelect.value, null);
            updateNestedConnectorStepSummary(prefix);
        };
    }
    let toggle = document.getElementById(prefix + "_toggle");
    let fields = document.getElementById(prefix + "_pluginFields");
    if (toggle && fields) {
        toggle.onclick = function () {
            if (fields.style.display === "none" || !fields.style.display) {
                fields.style.display = "block";
                toggle.textContent = "Hide";
            } else {
                fields.style.display = "none";
                toggle.textContent = "Settings";
            }
        };
    }
}

function updateNestedConnectorStepSummary(prefix) {
    let typeSelect = document.getElementById(prefix + "_pluginId");
    let summary = document.getElementById(prefix + "_summary");
    let icon = document.getElementById(prefix + "_icon");
    if (!typeSelect) {
        return;
    }
    let pluginId = typeSelect.value;
    let info = connectorCatalogById(pluginId);
    let label = info && info.name ? info.name : pluginId;
    if (summary) {
        summary.textContent = label;
        summary.title = info && info.description
            ? (label + " - " + info.description)
            : label;
    }
    if (icon && typeof connectorPluginIconUrl === "function") {
        icon.src = connectorPluginIconUrl(pluginId);
        icon.alt = pluginId || "connector";
        if (info && info.description) {
            icon.title = label + "\n" + info.description;
        } else {
            icon.title = label;
        }
    }
}

function rebuildNestedConnectorPluginFields(prefix, pluginId, values) {
    let container = document.getElementById(prefix + "_pluginFields");
    if (container === null) {
        return;
    }
    container.innerHTML = "";
    let info = connectorCatalogById(pluginId);
    if (info === null || !info.sections) {
        container.innerHTML = "<em class=\"editor-hint\">No form schema for "
            + escapeHtmlText(pluginId || "?")
            + ". Source wiring is automatic for chain steps.</em>";
        return;
    }
    let pluginValues = values || {};
    let anyField = false;
    for (let s = 0; s < info.sections.length; s++) {
        let section = info.sections[s];
        let fields = section.fields || [];
        // Filter out sourceConnectorName — chain sets this at runtime
        let visible = [];
        for (let f = 0; f < fields.length; f++) {
            if (fields[f].fieldName === "sourceConnectorName" || fields[f].id === "sourceConnectorName") {
                continue;
            }
            // Nested chain lists are stripped from catalog at depth; still skip
            if (fields[f].type === "LIST" && fields[f].itemKind === "connector") {
                continue;
            }
            visible.push(fields[f]);
        }
        if (!visible.length) {
            continue;
        }
        anyField = true;
        let title = section.title || section.id || "Options";
        let open = section.openByDefault ? "block" : "block";
        let secId = prefix + "_sec_" + (section.id || s);
        container.insertAdjacentHTML("beforeend",
            '<button type="button" class="collapsible nested-sec-toggle">' + escapeHtmlText(title) + "</button>"
            + '<div class="content" id="' + secId + '" style="display: ' + open + ';"></div>');
        let secDiv = document.getElementById(secId);
        for (let f = 0; f < visible.length; f++) {
            appendNestedFieldControl(secDiv, prefix, visible[f], pluginValues);
        }
        let btn = secDiv.previousElementSibling;
        if (btn) {
            btn.onclick = function () {
                let c = this.nextElementSibling;
                c.style.display = c.style.display === "block" ? "none" : "block";
            };
        }
    }
    if (!anyField) {
        container.innerHTML = "<em class=\"editor-hint\">This step has no extra settings "
            + "(uses the chain source automatically).</em>";
    }
}

function loadNestedConnectorIntoPanel(prefix, step) {
    step = unwrapConnectorStep(step);
    let pluginId = step.pluginId;
    let typeSelect = document.getElementById(prefix + "_pluginId");
    if (typeSelect && pluginId) {
        // Ensure option exists
        let found = false;
        for (let i = 0; i < typeSelect.options.length; i++) {
            if (typeSelect.options[i].value === pluginId) {
                found = true;
                break;
            }
        }
        if (!found) {
            let opt = document.createElement("option");
            opt.value = pluginId;
            opt.textContent = pluginId;
            typeSelect.appendChild(opt);
        }
        typeSelect.value = pluginId;
        rebuildNestedConnectorPluginFields(prefix, pluginId, step);
    }
    updateNestedConnectorStepSummary(prefix);
}

function readNestedConnectorFromPanel(prefix) {
    let typeSelect = document.getElementById(prefix + "_pluginId");
    if (!typeSelect) {
        return null;
    }
    let pluginId = typeSelect.value;
    if (!pluginId) {
        return null;
    }
    let info = connectorCatalogById(pluginId);
    let pluginValues = {};
    if (info && info.sections) {
        for (let s = 0; s < info.sections.length; s++) {
            let fields = info.sections[s].fields || [];
            for (let f = 0; f < fields.length; f++) {
                let field = fields[f];
                if (field.fieldName === "sourceConnectorName" || field.id === "sourceConnectorName") {
                    continue;
                }
                if (field.type === "LIST" && field.itemKind === "connector") {
                    continue;
                }
                readNestedFieldValue(prefix, field, pluginValues);
            }
        }
    }
    // Runtime wiring: leave source unset so chain context assigns it
    pluginValues["pluginId"] = pluginId;
    pluginValues["sourceConnectorName"] = null;

    // Hop JsonMetadataParser requires @HopMetadataObject list items as:
    //   { "SelectionConnector": { "pluginId": "SelectionConnector", ...fields } }
    // Flat { pluginId, ... } makes createObject("pluginId") → null → NPE on save/preview.
    let wrapped = {};
    wrapped[pluginId] = pluginValues;
    return wrapped;
}

// ---------------------------------------------------------------------------
// Sort methods, filter values, and JSON object lists (connectors)
// ---------------------------------------------------------------------------

const SORT_METHOD_TYPES = [
    "NATIVE_VALUE",
    "STRING_ALPHA",
    "STRING_ALPHA_CASE_INSENSITIVE",
    "STRING_NUMERIC",
    "STRING_CUSTOM"
];

function setSortMethods(json, fieldId, tableId) {
    let values = json[fieldId];
    if (!values) {
        return;
    }
    let table = document.getElementById(tableId);
    if (!table) {
        return;
    }
    if (table.getAttribute("data-list-kind") === null) {
        table.setAttribute("data-list-kind", "sort");
    }
    for (let i = 0; i < values.length; i++) {
        createSortMethodRow(table, values[i], i);
    }
}

function createSortMethodRow(table, method, i) {
    let row = table.insertRow(i + 1);
    row.id = createTableRowId(table.id, rowIdNumber++);
    let type = method && method.type ? method.type : "NATIVE_VALUE";
    let ascending = method && method.ascending !== false;
    row.insertCell(0).innerHTML = createSelection(
        "sortType-" + i, type, SORT_METHOD_TYPES, { defaultEmptyToFirst: true });
    row.insertCell(1).innerHTML = createCheckBox("sortAsc-" + i, ascending);
    appendListReorderCells(row, table, 2);
}

function getSortMethods(json, fieldId, tableId) {
    let values = [];
    let table = document.getElementById(tableId);
    if (!table) {
        json[fieldId] = values;
        return;
    }
    for (let i = 1; i < table.rows.length; i++) {
        let row = table.rows[i];
        values.push({
            "type": cellControlValue(row.cells[0]),
            "ascending": !!cellControlValue(row.cells[1]),
            "customOrder": []
        });
    }
    json[fieldId] = values;
}

function setFilterValues(json, fieldId, tableId, connectorColumnNames) {
    let values = json[fieldId];
    if (!values) {
        return;
    }
    let table = document.getElementById(tableId);
    if (!table) {
        return;
    }
    if (table.getAttribute("data-list-kind") === null) {
        table.setAttribute("data-list-kind", "filter");
    }
    let colNames = connectorColumnNames;
    if (!colNames || !colNames.length) {
        // Prefer live source connector select when present (connector editors)
        colNames = (typeof listFieldConnectorColumnNames === "function")
            ? listFieldConnectorColumnNames(table)
            : [];
    }
    for (let i = 0; i < values.length; i++) {
        createFilterValueRow(table, values[i], i, colNames);
    }
}

function createFilterValueRow(table, filter, i, connectorColumnNames) {
    let row = table.insertRow(i + 1);
    row.id = createTableRowId(table.id, rowIdNumber++);
    let fieldName = filter && filter.fieldName ? filter.fieldName : "";
    let filterValue = filter && filter.filterValue ? filter.filterValue : "";
    let colNames = connectorColumnNames;
    if (!colNames) {
        colNames = (typeof listFieldConnectorColumnNames === "function")
            ? listFieldConnectorColumnNames(table)
            : [];
    }
    // Column select from source connector (preserve stored name if offline)
    row.insertCell(0).innerHTML = createSelection(
        "filterField-" + i, fieldName, colNames || [], { preserveMissing: true });
    row.insertCell(1).innerHTML = createText("filterValue-" + i, filterValue);
    appendListReorderCells(row, table, 2);
}

/** Hop value type names for REST JsonField mapping (matches LeanRestConnector.JsonField). */
const JSON_FIELD_TYPES = [
    "String",
    "Integer",
    "Number",
    "BigNumber",
    "Boolean",
    "Date",
    "Timestamp",
    "Binary",
    "Internet Address"
];

function setJsonFields(json, fieldId, tableId) {
    let values = json[fieldId];
    if (!values) {
        return;
    }
    let table = document.getElementById(tableId);
    if (!table) {
        return;
    }
    if (table.getAttribute("data-list-kind") === null) {
        table.setAttribute("data-list-kind", "jsonField");
    }
    for (let i = 0; i < values.length; i++) {
        createJsonFieldRow(table, values[i], i);
    }
}

function createJsonFieldRow(table, field, i) {
    let row = table.insertRow(i + 1);
    row.id = createTableRowId(table.id, rowIdNumber++);
    let f = field || {};
    let type = f.type || "String";
    row.insertCell(0).innerHTML = createText("jsonTag-" + i, f.tag || "");
    row.insertCell(1).innerHTML = createText("jsonName-" + i, f.name || "");
    row.insertCell(2).innerHTML = createSelection(
        "jsonType-" + i, type, JSON_FIELD_TYPES, { defaultEmptyToFirst: true, preserveMissing: true });
    row.insertCell(3).innerHTML = createText("jsonFormat-" + i, f.formatMask || "", "width: 5em");
    row.insertCell(4).innerHTML = createText("jsonLength-" + i, f.length || "", "width: 4em");
    row.insertCell(5).innerHTML = createText("jsonPrecision-" + i, f.precision || "", "width: 4em");
    appendListReorderCells(row, table, 6);
}

function getJsonFields(json, fieldId, tableId) {
    let values = [];
    let table = document.getElementById(tableId);
    if (!table) {
        json[fieldId] = values;
        return;
    }
    for (let i = 1; i < table.rows.length; i++) {
        let row = table.rows[i];
        values.push({
            "tag": cellControlValue(row.cells[0]),
            "name": cellControlValue(row.cells[1]),
            "type": cellControlValue(row.cells[2]),
            "formatMask": cellControlValue(row.cells[3]),
            "length": cellControlValue(row.cells[4]),
            "precision": cellControlValue(row.cells[5]),
            "decimal": "",
            "grouping": ""
        });
    }
    json[fieldId] = values;
}

function getFilterValues(json, fieldId, tableId) {
    let values = [];
    let table = document.getElementById(tableId);
    if (!table) {
        json[fieldId] = values;
        return;
    }
    for (let i = 1; i < table.rows.length; i++) {
        let row = table.rows[i];
        values.push({
            "fieldName": cellControlValue(row.cells[0]),
            "filterValue": cellControlValue(row.cells[1])
        });
    }
    json[fieldId] = values;
}

/** Group component: group column → nested connector column key mappings. */
function setGroupKeyMappings(json, fieldId, tableId) {
    let values = json[fieldId];
    if (!values) {
        return;
    }
    let table = document.getElementById(tableId);
    if (!table) {
        return;
    }
    if (table.getAttribute("data-list-kind") === null) {
        table.setAttribute("data-list-kind", "groupKey");
    }
    for (let i = 0; i < values.length; i++) {
        createGroupKeyMappingRow(table, values[i], i);
    }
}

function createGroupKeyMappingRow(table, mapping, i) {
    let row = table.insertRow(i + 1);
    row.id = createTableRowId(table.id, rowIdNumber++);
    let m = mapping || {};
    row.insertCell(0).innerHTML = createText("groupKeyGroup-" + i, m.groupColumn || "");
    row.insertCell(1).innerHTML = createText("groupKeyConn-" + i, m.connectorColumn || "");
    appendListReorderCells(row, table, 2);
}

function getGroupKeyMappings(json, fieldId, tableId) {
    let values = [];
    let table = document.getElementById(tableId);
    if (!table) {
        json[fieldId] = values;
        return;
    }
    for (let i = 1; i < table.rows.length; i++) {
        let row = table.rows[i];
        values.push({
            "groupColumn": cellControlValue(row.cells[0]),
            "connectorColumn": cellControlValue(row.cells[1])
        });
    }
    json[fieldId] = values;
}

function setJsonObjectList(json, fieldId, tableId) {
    let values = json[fieldId];
    if (!values) {
        return;
    }
    let table = document.getElementById(tableId);
    if (!table) {
        return;
    }
    if (table.getAttribute("data-list-kind") === null) {
        table.setAttribute("data-list-kind", "connector");
    }
    for (let i = 0; i < values.length; i++) {
        createJsonObjectRow(table, values[i], i);
    }
}

function createJsonObjectRow(table, obj, i) {
    let row = table.insertRow(i + 1);
    row.id = createTableRowId(table.id, rowIdNumber++);
    let text = "";
    try {
        text = obj === null || obj === undefined ? "" : JSON.stringify(obj);
    } catch (e) {
        text = String(obj);
    }
    row.insertCell(0).innerHTML = '<textarea id="jsonObj-' + i + '" rows="3" style="width:95%">'
        + text.replace(/</g, "&lt;") + "</textarea>";
    appendListReorderCells(row, table, 1);
}

function getJsonObjectList(json, fieldId, tableId) {
    let values = [];
    let table = document.getElementById(tableId);
    if (!table) {
        json[fieldId] = values;
        return;
    }
    for (let i = 1; i < table.rows.length; i++) {
        let row = table.rows[i];
        let raw = cellControlValue(row.cells[0]);
        try {
            values.push(raw ? JSON.parse(raw) : {});
        } catch (e) {
            alert("Invalid JSON in list row " + i + ": " + e);
            values.push({});
        }
    }
    json[fieldId] = values;
}
