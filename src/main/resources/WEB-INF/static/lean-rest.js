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
            let max = withPreview ? 1200 : 640;
            let frac = withPreview ? 0.96 : 0.58;
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
        empty.textContent = "Rendering preview…";
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
            meta.textContent = componentName + " · " + w + "×" + h + " px (page size)";
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

    if (result["method"] != null
        && result["found"]
        && result["drawnItem"] != null) {

        let geo = result["drawnItem"]["geometry"];
        // console.log("gc? " + (gc != null) + " geo: (" + geo.x + "," + geo.y + "," + geo.width + "x" + geo.height + ")");

        // Draw a blue rectangle over the item we can click on
        //
        setClickableRegion((geo.x - offset.x + 1) * scale,
            (geo.y - offset.y + 1) * scale,
            (geo.width - 2) * scale,
            (geo.height - 2) * scale,
            ICON_SIZE);
        return true;
    }

    // Show the default cursor
    $("#svgCanvas").css("cursor", "default");

    return false;
}

function setClickableRegion(x, y, width, height, yTranslation) {
    gc.fillStyle = "rgba(0,0,120,0.2)";
    if (yTranslation > 0) {
        gc.translate(0, yTranslation);
    }
    gc.fillRect(x, y, width, height);
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
            const method = result.method;
            if (method != null && method.mouseClick) {
                // reset the cursor to default
                //
                $("#svgPage").css("cursor", "default");

                // Perform all the actions
                //
                const actions = result.actions;
                for (let i = 0; i < actions.length; i++) {
                    let action = actions[i];
                    if (action.actionType === "OPEN_PRESENTATION") {
                        let presentationName = action.objectName;
                        let parameterName = action.valueParameter;
                        let parameterValue = result.drawnItem.context.value;
                        if (presentationName === null) {
                            // Take the value of the string on which we clicked.
                            presentationName = parameterValue;
                        }
                        if (presentationName !== null) {
                            console.log("Open presentation: " + presentationName + ", with " + parameterName + "=" + parameterValue);

                            openPresentation(presentationName, parameterName, parameterValue);
                        }
                    }
                }
            }
        },
        error: function (request, status, error) {
            alert(request.responseText);
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
        createFilterValueRow(table, {"fieldName": "", "filterValue": ""}, i);
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
 * Open the side panel with a list of connector metadata elements.
 */
function editConnectorsList() {
    connectorNames = getConnectorNames();
    let html = "<h3>Connectors</h3>";
    html += "<p>Select a connector to edit, or create a new one.</p>";
    html += "<ul id=\"connectorList\">";
    for (let i = 0; i < connectorNames.length; i++) {
        let name = connectorNames[i];
        if (name === null || name === "") {
            continue;
        }
        // Use buttons + data-name (not href="#"/inline onclick with JSON.stringify).
        // Double-quoted onclick + JSON.stringify(name) breaks the attribute:
        //   onclick="editConnectorByName("Sample Data")"  → only runs editConnectorByName(
        html += "<li><button type=\"button\" class=\"connector-list-btn\" data-connector-name=\""
            + escapeHtmlAttribute(name) + "\">" + escapeHtmlText(name) + "</button></li>";
    }
    html += "</ul>";
    html += "<br><label for=\"newConnectorPluginId\">New connector type: </label>";
    html += "<select id=\"newConnectorPluginId\" style=\"width: 60%\"></select> ";
    html += "<button type=\"button\" id=\"createConnectorBtn\">Create</button>";
    html += "<br><br><button type=\"button\" id=\"closeConnectorListBtn\">Close</button>";

    setSidePanelOpen(true, {withPreview: false});
    document.getElementById("editArea").innerHTML = html;

    // Wire list item clicks via data attributes (safe for spaces/special chars)
    let list = document.getElementById("connectorList");
    if (list) {
        list.addEventListener("click", function (e) {
            let btn = e.target.closest("button.connector-list-btn");
            if (!btn) {
                return;
            }
            e.preventDefault();
            let name = btn.getAttribute("data-connector-name");
            if (name) {
                editConnectorByName(name);
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

    // Populate plugin type dropdown from plugins/components API
    loadConnectorPluginTypes("#newConnectorPluginId");
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
                // Fallback known types
                list = [
                    {"id": "SqlConnector", "name": "SQL"},
                    {"id": "SampleDataConnector", "name": "Sample data"},
                    {"id": "SortConnector", "name": "Sort"},
                    {"id": "SelectionConnector", "name": "Select fields"},
                    {"id": "SimpleFilterConnector", "name": "Simple filter"},
                    {"id": "LeanRestConnector", "name": "REST"},
                    {"id": "LeanListConnector", "name": "List"}
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
                "DistinctConnector", "PassthroughConnector"].forEach(function (id) {
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

function openConnectorEditForm(pluginId) {
    setSidePanelOpen(true, {withPreview: false});
    connectorColumnListTables = [];
    connectorColumnSelects = [];
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
            editArea.innerHTML = snippet;
            // Defer so sync XHR in init/load (describe columns, metadata lists) is not nested
            // inside this async AJAX success callback.
            setTimeout(function () {
                runFormScripts(pluginId || "connector");
            }, 0);
        },
        error: function (request) {
            alert("Failed to open connector editor: " + request.responseText);
        }
    });
}

function saveConnector() {
    try {
        let saveScript = document.getElementById("connectorSaveScript");
        if (saveScript) {
            eval(saveScript.innerHTML);
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
                // Match Apply button title: save and reload presentation so changes apply
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
    connectorJson = null;
    connectorPluginId = null;
    oldConnectorName = null;
    setSidePanelOpen(false);
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
        status.textContent = "Saving…";
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
        status.textContent = "Testing…";
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
/**
 * Legacy metadata form for presentation name/pages (static HTML).
 * Prefer the WYSIWYG editor (leanMode=edit) for structure changes.
 */
function editPresentationMetadata() {
    if (connectorNames === null) {
        connectorNames = getConnectorNames();
    }
    if (themeNames === null) {
        themeNames = getThemeNames();
    }

    $.ajax({
        url: API_BASE + "metadata/presentation/" + presentationName + "/",
        type: "GET",
        contentType: "application/json; charset=utf-8",
        dataType: "json",
        success: function (json) {
            presentationJson = json;
            openEditArea("/lean/api/static/edit/edit-presentation.html");
        },
        error: function (request, status, error) {
            alert(request.responseText);
        }
    });
}

function savePresentation() {
    alert("save presentation JSON: " + JSON.stringify(presentationJson));
    closePresentation();
}

function closePresentation() {
    setSidePanelOpen(false);
}

function addPresentationPage() {
    // presentationJson['pages'].push({});
    alert("Add new page");
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
            setFilterValues(tmp, field.fieldName, tableId);
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

function setFilterValues(json, fieldId, tableId) {
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
    for (let i = 0; i < values.length; i++) {
        createFilterValueRow(table, values[i], i);
    }
}

function createFilterValueRow(table, filter, i) {
    let row = table.insertRow(i + 1);
    row.id = createTableRowId(table.id, rowIdNumber++);
    let fieldName = filter && filter.fieldName ? filter.fieldName : "";
    let filterValue = filter && filter.filterValue ? filter.filterValue : "";
    row.insertCell(0).innerHTML = createText("filterField-" + i, fieldName);
    row.insertCell(1).innerHTML = createText("filterValue-" + i, filterValue);
    appendListReorderCells(row, table, 2);
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
