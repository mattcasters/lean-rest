/**
 * Edit-mode (WYSIWYG) helpers for lean-rest.
 * Loaded after lean-rest.js when leanMode === 'edit'.
 *
 * PR2: geometries, list (name + type), hover + selection
 * PR3: delete, name-based properties, soft re-render after mutations
 * PR4: palette drag/drop create + toolbar Add
 * PR5: offset-only drag of existing components (outline + nudge API)
 */
(function () {
    if (typeof leanMode === "undefined" || leanMode !== "edit") {
        return;
    }

    /** @type {Array<{componentName:string, pluginId:string, geometry:{x,y,width,height}, pageRole?:string, logicalPageNumber?:number}>} */
    let componentGeometries = [];
    /** @type {Array<{name:string, pluginId:string, pluginName:string, pageRole?:string}>} */
    let pageComponents = [];
    let componentPluginCatalog = [];

    let selectedComponentName = null;
    /** pageRole for the current selection (page|header|footer) — used for Apply routing */
    let selectedPageRole = "page";
    let hoverComponentName = null;
    let lastHoverName = null;
    let redrawScheduled = false;
    let pendingSelectName = null;

    /**
     * Active pointer drag for moving a component (offset-only nudge).
     * @type {null|{
     *   drawnName:string, metadataName:string, pageRole:string,
     *   startPageX:number, startPageY:number,
     *   originGeo:{x,y,width,height},
     *   dx:number, dy:number, dragging:boolean, openPropsOnUp:boolean
     * }}
     */
    let dragState = null;
    const DRAG_THRESHOLD_PX = 4;

    function initEditShell() {
        loadComponentPalette();
        refreshEditorState();
        wireListToolbar();
        wireHeaderFooterControls();
        wireCanvasDrop();
        console.log("Lean edit mode ready for presentation:", presentationName);
    }

    function refreshEditorState(selectName) {
        if (selectName !== undefined && selectName !== null) {
            pendingSelectName = selectName;
        }
        loadPageComponentList();
        loadComponentGeometries();
        loadHeaderFooterState();
    }

    // ── Header / Footer ──────────────────────────────────────────────────

    let headerFooterState = {
        header: {enabled: false, height: 50},
        footer: {enabled: false, height: 25},
        regions: null
    };
    /** @type {null|"header"|"content"|"footer"} region under pointer while dragging */
    let activeDropRegion = null;
    /** Palette HTML5 drag currently over the canvas */
    let paletteDragActive = false;

    function loadHeaderFooterState() {
        if (typeof presentationName === "undefined" || !presentationName) {
            return;
        }
        $.ajax({
            url: API_BASE + "edit/presentation/" + encodeURIComponent(presentationName)
                + "/header-footer/",
            type: "GET",
            dataType: "json",
            success: function (state) {
                headerFooterState = state || headerFooterState;
                applyHeaderFooterUi();
                scheduleRedraw();
            },
            error: function (xhr) {
                console.warn("Failed to load header/footer state:", xhr.responseText || xhr.status);
            }
        });
    }

    function getPageRegions() {
        return (headerFooterState && headerFooterState.regions) || null;
    }

    function getActiveDropRegion() {
        return activeDropRegion;
    }

    /**
     * Which band (header / content / footer) contains page-space point (px, py).
     * Footer and header win over content when overlapping edges.
     */
    function hitTestPageRegion(px, py) {
        let regions = getPageRegions();
        if (!regions) {
            return "content";
        }
        function contains(r) {
            return r && px >= r.x && py >= r.y
                && px <= r.x + r.width && py <= r.y + r.height;
        }
        if (contains(regions.header)) {
            return "header";
        }
        if (contains(regions.footer)) {
            return "footer";
        }
        if (contains(regions.content)) {
            return "content";
        }
        if (contains(regions.page)) {
            return "content";
        }
        return null;
    }

    function setActiveDropRegion(region) {
        if (activeDropRegion === region) {
            return;
        }
        activeDropRegion = region;
        scheduleRedraw();
    }

    function clearActiveDropRegion() {
        if (activeDropRegion === null && !paletteDragActive) {
            return;
        }
        activeDropRegion = null;
        paletteDragActive = false;
        scheduleRedraw();
    }

    function applyHeaderFooterUi() {
        let h = (headerFooterState && headerFooterState.header) || {enabled: false, height: 50};
        let f = (headerFooterState && headerFooterState.footer) || {enabled: false, height: 25};
        let chkH = document.getElementById("chkHeader");
        let chkF = document.getElementById("chkFooter");
        let labH = document.getElementById("headerHeightLabel");
        let labF = document.getElementById("footerHeightLabel");
        if (chkH) {
            chkH.checked = !!h.enabled;
        }
        if (chkF) {
            chkF.checked = !!f.enabled;
        }
        if (labH) {
            labH.textContent = h.enabled ? (h.height + " px") : "";
        }
        if (labF) {
            labF.textContent = f.enabled ? (f.height + " px") : "";
        }
        let linkH = document.getElementById("linkHeader");
        let linkF = document.getElementById("linkFooter");
        if (linkH) {
            linkH.classList.toggle("hf-disabled", !h.enabled);
        }
        if (linkF) {
            linkF.classList.toggle("hf-disabled", !f.enabled);
        }
    }

    function wireHeaderFooterControls() {
        let chkH = document.getElementById("chkHeader");
        let chkF = document.getElementById("chkFooter");
        let linkH = document.getElementById("linkHeader");
        let linkF = document.getElementById("linkFooter");
        if (chkH) {
            chkH.addEventListener("change", function () {
                setHeaderFooterEnabled("header", chkH.checked);
            });
        }
        if (chkF) {
            chkF.addEventListener("change", function () {
                setHeaderFooterEnabled("footer", chkF.checked);
            });
        }
        if (linkH) {
            linkH.addEventListener("click", function (e) {
                e.preventDefault();
                editHeaderFooterHeight("header");
            });
        }
        if (linkF) {
            linkF.addEventListener("click", function (e) {
                e.preventDefault();
                editHeaderFooterHeight("footer");
            });
        }
    }

    function setHeaderFooterEnabled(which, enabled) {
        let cur = headerFooterState[which] || {};
        let height = cur.height != null ? cur.height : (which === "header" ? 50 : 25);
        let body = {};
        body[which] = {enabled: enabled, height: height};
        postHeaderFooter(body);
    }

    function editHeaderFooterHeight(which) {
        let cur = headerFooterState[which] || {};
        let enabled = !!cur.enabled;
        if (!enabled) {
            // Offer to enable when editing size while disabled
            if (!confirm("Enable " + which + " first?")) {
                return;
            }
            enabled = true;
        }
        let currentH = cur.height != null ? cur.height : (which === "header" ? 50 : 25);
        let answer = prompt(
            which.charAt(0).toUpperCase() + which.slice(1) + " height (pixels):",
            String(currentH)
        );
        if (answer === null) {
            return;
        }
        let h = parseInt(String(answer).trim(), 10);
        if (isNaN(h) || h < 1) {
            alert("Height must be a positive number");
            return;
        }
        let body = {};
        body[which] = {enabled: enabled, height: h};
        postHeaderFooter(body);
    }

    function postHeaderFooter(body) {
        $.ajax({
            url: API_BASE + "edit/presentation/" + encodeURIComponent(presentationName)
                + "/header-footer/",
            type: "POST",
            contentType: "application/json; charset=utf-8",
            data: JSON.stringify(body),
            dataType: "json",
            success: function (state) {
                headerFooterState = state || headerFooterState;
                applyHeaderFooterUi();
                if (typeof softReloadEditor === "function") {
                    softReloadEditor(
                        typeof selectedComponentName !== "undefined" ? selectedComponentName : null
                    );
                } else if (typeof reloadPresentation === "function") {
                    reloadPresentation();
                }
            },
            error: function (xhr, status, error) {
                // Re-sync UI with server state
                loadHeaderFooterState();
                if (typeof showAjaxError === "function") {
                    showAjaxError("Header/footer update failed", xhr, status, error);
                } else {
                    alert("Header/footer update failed: " + (xhr.responseText || status));
                }
            }
        });
    }

    // ── Palette ──────────────────────────────────────────────────────────

    /**
     * URL for a component type icon from {@code @LeanComponentPlugin(image=...)} /
     * {@code GET plugins/components/{id}/image}.
     */
    function componentPluginIconUrl(pluginId) {
        if (!pluginId) {
            return API_BASE + "plugins/components/default/image";
        }
        return API_BASE + "plugins/components/" + encodeURIComponent(pluginId) + "/image";
    }

    /** Tooltip: display name, plugin id, description (multi-line title). */
    function componentPluginTooltip(p, extraLine) {
        if (!p) {
            return extraLine || "";
        }
        let name = p.name || p.id || "Component";
        let id = p.id || "";
        let desc = (p.description || "").trim();
        let lines = [];
        if (id && name !== id) {
            lines.push(name + " (" + id + ")");
        } else {
            lines.push(name);
        }
        if (desc) {
            lines.push(desc);
        }
        if (extraLine) {
            lines.push(extraLine);
        }
        return lines.join("\n");
    }

    function findComponentPluginInCatalog(pluginId) {
        if (!pluginId || !componentPluginCatalog) {
            return null;
        }
        for (let i = 0; i < componentPluginCatalog.length; i++) {
            if (componentPluginCatalog[i].id === pluginId) {
                return componentPluginCatalog[i];
            }
        }
        return null;
    }

    function loadComponentPalette() {
        let root = document.getElementById("componentPalette");
        if (!root) {
            return;
        }
        root.innerHTML = "<p class=\"editor-hint\">Loading types…</p>";
        $.ajax({
            url: API_BASE + "plugins/components",
            type: "GET",
            dataType: "json",
            success: function (list) {
                componentPluginCatalog = list || [];
                root.innerHTML = "";
                if (componentPluginCatalog.length === 0) {
                    root.innerHTML = "<p class=\"editor-hint\">No component plugins found.</p>";
                    return;
                }
                for (let i = 0; i < componentPluginCatalog.length; i++) {
                    let p = componentPluginCatalog[i];
                    let btn = document.createElement("button");
                    btn.type = "button";
                    btn.className = "palette-item";
                    btn.draggable = true;
                    btn.setAttribute("data-plugin-id", p.id);
                    btn.title = componentPluginTooltip(p, "— drag onto the page");
                    let icon = document.createElement("img");
                    icon.className = "palette-item-icon";
                    icon.src = componentPluginIconUrl(p.id);
                    icon.alt = "";
                    icon.width = 20;
                    icon.height = 20;
                    icon.draggable = false;
                    let label = document.createElement("span");
                    label.className = "palette-item-label";
                    label.textContent = p.name || p.id;
                    btn.appendChild(icon);
                    btn.appendChild(label);
                    btn.addEventListener("dragstart", function (e) {
                        // Custom type + text/plain (browsers often only expose plain in drop)
                        e.dataTransfer.setData("text/lean-component-plugin", p.id);
                        e.dataTransfer.setData("text/plain", p.id);
                        e.dataTransfer.effectAllowed = "copy";
                        btn.classList.add("palette-item-dragging");
                    });
                    btn.addEventListener("dragend", function () {
                        btn.classList.remove("palette-item-dragging");
                        let canvasEl = document.getElementById("svgCanvas");
                        if (canvasEl) {
                            canvasEl.classList.remove("canvas-drop-target");
                        }
                    });
                    root.appendChild(btn);
                }
            },
            error: function (xhr) {
                root.innerHTML = "<p class=\"editor-hint\">Failed to load plugins: "
                    + (xhr.responseText || xhr.status) + "</p>";
            }
        });
    }

    // ── Page component list ──────────────────────────────────────────────

    function loadPageComponentList() {
        let listEl = document.getElementById("pageComponentList");
        let emptyEl = document.getElementById("pageComponentListEmpty");
        if (!listEl) {
            return;
        }
        listEl.innerHTML = "";
        $.ajax({
            url: API_BASE + "edit/presentation/by-render/" + encodeURIComponent(renderId)
                + "/pages/" + encodeURIComponent(renderPageNumber0) + "/components/",
            type: "GET",
            dataType: "json",
            success: function (list) {
                pageComponents = list || [];
                if (emptyEl) {
                    emptyEl.style.display = pageComponents.length ? "none" : "block";
                }
                for (let i = 0; i < pageComponents.length; i++) {
                    let item = pageComponents[i];
                    let name = item.name;
                    let typeLabel = item.pluginName || item.pluginId || "component";
                    let pluginInfo = findComponentPluginInCatalog(item.pluginId);
                    let li = document.createElement("li");
                    li.className = "page-component-item";
                    if (name === selectedComponentName || name === pendingSelectName) {
                        li.classList.add("selected");
                    }
                    li.setAttribute("data-component-name", name);
                    li.title = componentPluginTooltip(
                        pluginInfo || {
                            id: item.pluginId,
                            name: typeLabel,
                            description: ""
                        },
                        "Component: " + name
                    );
                    li.innerHTML = "<img class=\"comp-type-icon\" width=\"18\" height=\"18\" alt=\"\">"
                        + "<span class=\"comp-text\">"
                        + "<span class=\"comp-name\"></span>"
                        + "<span class=\"comp-type\"></span>"
                        + "</span>";
                    let iconEl = li.querySelector(".comp-type-icon");
                    iconEl.src = componentPluginIconUrl(item.pluginId);
                    iconEl.alt = typeLabel;
                    li.querySelector(".comp-name").textContent = name;
                    li.querySelector(".comp-type").textContent = typeLabel;
                    if (item.pageRole && item.pageRole !== "page") {
                        li.querySelector(".comp-type").textContent =
                            typeLabel + " · " + item.pageRole;
                    }
                    li.addEventListener("click", function () {
                        selectComponent(name, true);
                    });
                    li.addEventListener("dblclick", function () {
                        selectComponent(name, true);
                        openPropertiesForComponent(name);
                    });
                    listEl.appendChild(li);
                }
                if (pendingSelectName) {
                    let stillThere = pageComponents.some(function (c) {
                        return c.name === pendingSelectName;
                    });
                    if (stillThere) {
                        selectComponent(pendingSelectName, false);
                    } else {
                        selectedComponentName = null;
                    }
                    pendingSelectName = null;
                }
                updateListToolbarState();
            },
            error: function (xhr) {
                if (emptyEl) {
                    emptyEl.textContent = "Could not load component list: "
                        + (xhr.responseText || xhr.status);
                    emptyEl.style.display = "block";
                }
            }
        });
    }

    // ── Geometries ───────────────────────────────────────────────────────

    function loadComponentGeometries() {
        $.ajax({
            url: API_BASE + "render/info/component-geometries/" + encodeURIComponent(renderId)
                + "/" + encodeURIComponent(renderPageNumber0) + "/",
            type: "GET",
            dataType: "json",
            success: function (list) {
                componentGeometries = list || [];
                scheduleRedraw();
            },
            error: function (xhr) {
                console.warn("Failed to load component geometries:", xhr.responseText || xhr.status);
                componentGeometries = [];
            }
        });
    }

    function findGeometry(name) {
        if (!name) {
            return null;
        }
        for (let i = 0; i < componentGeometries.length; i++) {
            if (componentGeometries[i].componentName === name) {
                return componentGeometries[i];
            }
        }
        return null;
    }

    function hitTest(pageX, pageY) {
        // Top-most drawn area on this render page (last in list = drawn later)
        for (let i = componentGeometries.length - 1; i >= 0; i--) {
            let entry = componentGeometries[i];
            let g = entry.geometry;
            if (!g || g.width <= 0 || g.height <= 0) {
                continue;
            }
            if (pageX >= g.x && pageY >= g.y
                && pageX <= g.x + g.width && pageY <= g.y + g.height) {
                return entry;
            }
        }
        return null;
    }

    // ── Selection / hover ────────────────────────────────────────────────

    function resolvePageRoleForName(name) {
        let geo = findGeometry(name);
        if (geo && geo.pageRole) {
            return geo.pageRole;
        }
        for (let i = 0; i < pageComponents.length; i++) {
            if (pageComponents[i].name === name && pageComponents[i].pageRole) {
                return pageComponents[i].pageRole;
            }
        }
        return "page";
    }

    function selectComponent(name, fromList) {
        selectedComponentName = name;
        selectedPageRole = resolvePageRoleForName(name);
        // Keep global edit-mode save routing in sync with canvas/list selection
        if (typeof editPageRole !== "undefined") {
            editPageRole = selectedPageRole;
        }
        if (typeof editLogicalPageNumber !== "undefined") {
            let geo = findGeometry(name);
            if (geo && typeof geo.logicalPageNumber === "number" && geo.logicalPageNumber >= 0) {
                editLogicalPageNumber = geo.logicalPageNumber;
            }
        }
        let nodes = document.querySelectorAll("#pageComponentList .page-component-item");
        for (let i = 0; i < nodes.length; i++) {
            let n = nodes[i];
            if (n.getAttribute("data-component-name") === name) {
                n.classList.add("selected");
                if (fromList) {
                    n.scrollIntoView({block: "nearest"});
                }
            } else {
                n.classList.remove("selected");
            }
        }
        updateListToolbarState();
        scheduleRedraw();
    }

    function clearSelection() {
        selectedComponentName = null;
        selectedPageRole = "page";
        let nodes = document.querySelectorAll("#pageComponentList .page-component-item");
        for (let i = 0; i < nodes.length; i++) {
            nodes[i].classList.remove("selected");
        }
        updateListToolbarState();
        scheduleRedraw();
    }

    function updateListToolbarState() {
        let has = !!selectedComponentName;
        let editBtn = document.getElementById("btnComponentEdit");
        let delBtn = document.getElementById("btnComponentDelete");
        if (editBtn) {
            editBtn.disabled = !has;
        }
        if (delBtn) {
            delBtn.disabled = !has;
        }
        let addBtn = document.getElementById("btnComponentAdd");
        if (addBtn) {
            // Enabled once catalog is loaded (or always — picker falls back)
            addBtn.disabled = false;
        }
    }

    function wireListToolbar() {
        let editBtn = document.getElementById("btnComponentEdit");
        if (editBtn) {
            editBtn.onclick = function () {
                if (!selectedComponentName) {
                    return;
                }
                openPropertiesForComponent(selectedComponentName);
            };
        }
        let delBtn = document.getElementById("btnComponentDelete");
        if (delBtn) {
            delBtn.onclick = function () {
                if (!selectedComponentName) {
                    return;
                }
                deleteSelectedComponent();
            };
        }
        let addBtn = document.getElementById("btnComponentAdd");
        if (addBtn) {
            addBtn.onclick = function () {
                promptAddComponent();
            };
            addBtn.disabled = false;
        }
    }

    /**
     * Toolbar + : place a component without drag (dialog for type, fixed offset on page).
     */
    function promptAddComponent() {
        if (!componentPluginCatalog || componentPluginCatalog.length === 0) {
            alert("Component types are still loading or unavailable.");
            return;
        }
        let lines = [];
        for (let i = 0; i < componentPluginCatalog.length; i++) {
            let p = componentPluginCatalog[i];
            lines.push((i + 1) + ". " + (p.name || p.id) + " (" + p.id + ")");
        }
        let answer = prompt(
            "Add component type (number or plugin id):\n\n" + lines.join("\n"),
            "1"
        );
        if (answer === null) {
            return;
        }
        answer = String(answer).trim();
        let pluginId = null;
        let asNum = parseInt(answer, 10);
        if (!isNaN(asNum) && asNum >= 1 && asNum <= componentPluginCatalog.length) {
            pluginId = componentPluginCatalog[asNum - 1].id;
        } else {
            for (let i = 0; i < componentPluginCatalog.length; i++) {
                if (componentPluginCatalog[i].id === answer
                    || (componentPluginCatalog[i].name || "").toLowerCase() === answer.toLowerCase()) {
                    pluginId = componentPluginCatalog[i].id;
                    break;
                }
            }
        }
        if (!pluginId) {
            alert("Unknown component type: " + answer);
            return;
        }
        // Place near top-left of the content area (page space)
        addComponentAt(pluginId, 50, 50, true);
    }

    /**
     * Create component via server API, soft-reload, select (and optionally open properties).
     */
    /**
     * @param {string} pluginId
     * @param {number} pageX
     * @param {number} pageY
     * @param {boolean} openProps
     * @param {string} [region] header | content | footer (default content)
     */
    function addComponentAt(pluginId, pageX, pageY, openProps, region) {
        if (!pluginId || typeof presentationName === "undefined") {
            return;
        }
        let x = Math.round(pageX);
        let y = Math.round(pageY);
        if (isNaN(x)) {
            x = 50;
        }
        if (isNaN(y)) {
            y = 50;
        }
        // Prefer by-render so the body page matches the canvas the user dropped on
        let url = API_BASE + "edit/presentation/by-render/" + encodeURIComponent(renderId)
            + "/pages/" + encodeURIComponent(renderPageNumber0) + "/components/";
        let payload = {
            pluginId: pluginId,
            x: x,
            y: y
        };
        if (region === "header" || region === "footer") {
            payload.pageRole = region;
        }
        $.ajax({
            url: url,
            type: "POST",
            contentType: "application/json; charset=utf-8",
            data: JSON.stringify(payload),
            dataType: "json",
            success: function (data) {
                let newName = data && data.name ? data.name : null;
                if (typeof softReloadEditor === "function") {
                    softReloadEditor(newName);
                } else if (typeof reloadPresentation === "function") {
                    reloadPresentation();
                }
                if (newName) {
                    // After soft reload refreshes list asynchronously; also select now
                    pendingSelectName = newName;
                    if (openProps) {
                        // Defer properties until geometries/list refresh settles
                        setTimeout(function () {
                            openPropertiesForComponent(newName);
                        }, 350);
                    }
                }
            },
            error: function (xhr) {
                if (typeof showAjaxError === "function") {
                    showAjaxError("Could not add component", xhr);
                } else {
                    alert("Could not add component: " + (xhr.responseText || xhr.status));
                }
            }
        });
    }

    function openPropertiesForComponent(name) {
        if (typeof openComponentPropertiesByName === "function") {
            openComponentPropertiesByName(name);
            return;
        }
        // Fallback: geometry-center hit
        let entry = findGeometry(name);
        let x = 1;
        let y = 1;
        if (entry && entry.geometry) {
            x = entry.geometry.x + Math.max(1, Math.floor(entry.geometry.width / 2));
            y = entry.geometry.y + Math.max(1, Math.floor(entry.geometry.height / 2));
        }
        onCtrlLeftClick({
            renderId: renderId,
            pageNumber: renderPageNumber0,
            x: x,
            y: y
        });
    }

    function deleteSelectedComponent() {
        let name = selectedComponentName;
        if (!name) {
            return;
        }
        if (!confirm("Delete component '" + name + "' from this presentation?")) {
            return;
        }
        $.ajax({
            url: API_BASE + "edit/presentation/" + encodeURIComponent(presentationName)
                + "/components/" + encodeURIComponent(name) + "/",
            type: "DELETE",
            dataType: "text",
            success: function () {
                if (typeof setSidePanelOpen === "function") {
                    setSidePanelOpen(false);
                }
                clearSelection();
                if (typeof softReloadEditor === "function") {
                    softReloadEditor(null);
                } else if (typeof reloadPresentation === "function") {
                    reloadPresentation();
                }
            },
            error: function (xhr) {
                alert("Delete failed: " + (xhr.responseText || xhr.status));
            }
        });
    }

    // ── Mouse + overlay drawing ──────────────────────────────────────────

    function onPageMouseMove(pageX, pageY) {
        // While dragging, cursor/hover are owned by the drag outline
        if (dragState && dragState.dragging) {
            return;
        }
        if (pageX === null || pageX === undefined) {
            if (hoverComponentName !== null) {
                hoverComponentName = null;
                lastHoverName = null;
                $("#svgCanvas").css("cursor", "default");
                scheduleRedraw();
            }
            return;
        }
        let hit = hitTest(pageX, pageY);
        let name = hit ? hit.componentName : null;
        if (name !== lastHoverName) {
            lastHoverName = name;
            hoverComponentName = name;
            $("#svgCanvas").css("cursor", name ? "grab" : "default");
            scheduleRedraw();
        }
    }

    function scheduleRedraw() {
        if (redrawScheduled) {
            return;
        }
        redrawScheduled = true;
        requestAnimationFrame(function () {
            redrawScheduled = false;
            if (typeof drawSvg === "function" && typeof image !== "undefined" && image) {
                drawSvg();
            }
        });
    }

    function drawOverlays(gcCtx, sc, off) {
        // Live drag outline (ghost) — follows the pointer while moving a component
        if (dragState && dragState.dragging && dragState.originGeo) {
            let g = {
                x: dragState.originGeo.x + dragState.dx,
                y: dragState.originGeo.y + dragState.dy,
                width: dragState.originGeo.width,
                height: dragState.originGeo.height
            };
            strokePageRect(gcCtx, g, sc, off, "rgba(30, 90, 200, 0.95)", 2, false, true);
            // Dim original position
            strokePageRect(
                gcCtx, dragState.originGeo, sc, off, "rgba(30, 90, 200, 0.35)", 1, false, true);
            return;
        }
        if (selectedComponentName) {
            let sel = findGeometry(selectedComponentName);
            if (sel && sel.geometry && (sel.geometry.width > 0 || sel.geometry.height > 0)) {
                strokePageRect(gcCtx, sel.geometry, sc, off, "rgba(30, 90, 200, 0.95)", 2.5, true);
            }
        }
        if (hoverComponentName && hoverComponentName !== selectedComponentName) {
            let hov = findGeometry(hoverComponentName);
            if (hov && hov.geometry && (hov.geometry.width > 0 || hov.geometry.height > 0)) {
                strokePageRect(gcCtx, hov.geometry, sc, off, "rgba(40, 120, 220, 0.55)", 1.5, false);
            }
        }
    }

    /**
     * Draw a rectangle in page space (same coords as DrawnItem geometry / correctX/Y).
     */
    function strokePageRect(gcCtx, geo, sc, off, color, lineWidth, fill, dashed) {
        let w = Math.max(0, geo.width);
        let h = Math.max(0, geo.height);
        if (w <= 0 && h <= 0) {
            return;
        }
        // Zero-width/height becomes a thin visible edge for debugging incomplete layouts
        if (w <= 0) {
            w = 2;
        }
        if (h <= 0) {
            h = 2;
        }
        let x = (geo.x - off.x) * sc;
        let y = (geo.y - off.y) * sc;
        w = w * sc;
        h = h * sc;
        gcCtx.save();
        gcCtx.strokeStyle = color;
        gcCtx.lineWidth = lineWidth;
        if (dashed) {
            gcCtx.setLineDash([6, 4]);
        } else {
            gcCtx.setLineDash([]);
        }
        gcCtx.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
        if (fill) {
            gcCtx.fillStyle = "rgba(30, 90, 200, 0.08)";
            gcCtx.fillRect(x, y, w, h);
        }
        gcCtx.restore();
    }

    /**
     * mousedown on canvas (edit mode): start potential drag / select.
     * Click without drag still opens properties; drag past threshold moves.
     */
    function handleCanvasMouseDown(e, pageX, pageY, requestData) {
        if (document.body.classList.contains("property-panel-open")) {
            // Property panel open: keep click-to-edit behavior only
            if (typeof onCtrlLeftClick === "function") {
                onCtrlLeftClick(requestData);
            }
            return;
        }
        if (typeof ICON_SIZE === "number" && e.offsetY < ICON_SIZE) {
            return;
        }
        let hit = hitTest(pageX, pageY);
        if (!hit) {
            clearSelection();
            return;
        }
        if (hit.pageRole) {
            selectedPageRole = hit.pageRole;
        }
        selectComponent(hit.componentName, false);
        let geo = hit.geometry || {x: pageX, y: pageY, width: 40, height: 40};
        dragState = {
            drawnName: hit.componentName,
            metadataName: hit.metadataName || hit.componentName,
            pageRole: hit.pageRole || "page",
            startPageX: pageX,
            startPageY: pageY,
            originGeo: {
                x: geo.x,
                y: geo.y,
                width: geo.width,
                height: geo.height
            },
            dx: 0,
            dy: 0,
            dragging: false,
            openPropsOnUp: true,
            requestData: requestData
        };
        if (canvas) {
            canvas.style.cursor = "grabbing";
        }
    }

    /**
     * @returns {boolean} true if the move was consumed by an active drag
     */
    function onCanvasMouseMove(event, pageX, pageY) {
        if (!dragState) {
            return false;
        }
        // When pointer leaves the canvas, derive page coords from client position
        if (pageX === null || pageX === undefined || isNaN(pageX)) {
            if (typeof canvas === "undefined" || !canvas) {
                return true;
            }
            let rect = canvas.getBoundingClientRect();
            let ox = event.clientX - rect.left;
            let oy = event.clientY - rect.top;
            pageX = typeof correctX === "function" ? correctX(ox) : ox;
            pageY = typeof correctY === "function" ? correctY(oy) : oy;
        }
        let dx = Math.round(pageX - dragState.startPageX);
        let dy = Math.round(pageY - dragState.startPageY);
        if (!dragState.dragging
            && (Math.abs(dx) >= DRAG_THRESHOLD_PX || Math.abs(dy) >= DRAG_THRESHOLD_PX)) {
            dragState.dragging = true;
            dragState.openPropsOnUp = false;
        }
        if (dragState.dragging) {
            dragState.dx = dx;
            dragState.dy = dy;
            // Highlight target band under the ghost (pointer position)
            setActiveDropRegion(hitTestPageRegion(pageX, pageY));
            scheduleRedraw();
            return true;
        }
        return false;
    }

    function handleCanvasMouseUp(e) {
        if (!dragState) {
            return;
        }
        let state = dragState;
        dragState = null;
        clearActiveDropRegion();
        if (canvas) {
            canvas.style.cursor = "";
        }
        if (state.dragging && (state.dx !== 0 || state.dy !== 0)) {
            nudgeComponentOnServer(state);
            return;
        }
        // Simple click: open properties for the selected component
        if (state.openPropsOnUp && state.requestData) {
            if (typeof onCtrlLeftClick === "function") {
                onCtrlLeftClick(state.requestData);
            } else {
                openPropertiesForComponent(state.drawnName);
            }
        }
        scheduleRedraw();
    }

    function nudgeComponentOnServer(state) {
        let nameForApi = state.metadataName || state.drawnName;
        // Prefer drawn name for nested resolution (ComponentLookup handles both)
        let pathName = state.drawnName || nameForApi;
        $.ajax({
            url: API_BASE + "edit/presentation/" + encodeURIComponent(presentationName)
                + "/components/" + encodeURIComponent(pathName) + "/nudge/",
            type: "POST",
            contentType: "application/json; charset=utf-8",
            data: JSON.stringify({dx: state.dx, dy: state.dy}),
            dataType: "json",
            success: function (result) {
                let keep = (result && result.name) ? result.name : nameForApi;
                // Also try drawn name for re-select after multi-instance groups
                if (typeof softReloadEditor === "function") {
                    softReloadEditor(keep);
                } else if (typeof reloadPresentation === "function") {
                    reloadPresentation();
                }
            },
            error: function (xhr, status, error) {
                if (typeof showAjaxError === "function") {
                    showAjaxError("Move component failed", xhr, status, error);
                } else {
                    alert("Move failed: " + (xhr.responseText || status));
                }
                scheduleRedraw();
            }
        });
    }

    function wireCanvasDrop() {
        let canvasEl = document.getElementById("svgCanvas");
        if (!canvasEl) {
            return;
        }
        canvasEl.addEventListener("dragenter", function (e) {
            if (isPaletteDrag(e)) {
                e.preventDefault();
                paletteDragActive = true;
                canvasEl.classList.add("canvas-drop-target");
            }
        });
        canvasEl.addEventListener("dragleave", function (e) {
            // Only clear when leaving the canvas itself (not entering a child)
            if (e.target === canvasEl) {
                canvasEl.classList.remove("canvas-drop-target");
                clearActiveDropRegion();
            }
        });
        canvasEl.addEventListener("dragover", function (e) {
            if (isPaletteDrag(e)) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
                paletteDragActive = true;
                canvasEl.classList.add("canvas-drop-target");
                let pageX = typeof correctX === "function" ? correctX(e.offsetX) : e.offsetX;
                let pageY = typeof correctY === "function" ? correctY(e.offsetY) : e.offsetY;
                setActiveDropRegion(hitTestPageRegion(pageX, pageY));
            }
        });
        canvasEl.addEventListener("drop", function (e) {
            e.preventDefault();
            canvasEl.classList.remove("canvas-drop-target");
            clearActiveDropRegion();
            // Ignore drops on the toolbar icon strip
            if (typeof ICON_SIZE === "number" && e.offsetY < ICON_SIZE) {
                return;
            }
            let pluginId = e.dataTransfer.getData("text/lean-component-plugin")
                || e.dataTransfer.getData("text/plain");
            if (!pluginId) {
                return;
            }
            pluginId = String(pluginId).trim();
            // Map canvas pixel → page coordinates (same as hit-test / lookup)
            let pageX = typeof correctX === "function" ? correctX(e.offsetX) : e.offsetX;
            let pageY = typeof correctY === "function" ? correctY(e.offsetY) : e.offsetY;
            if (typeof invalidMouseLocation === "function" && invalidMouseLocation(pageX, pageY)) {
                // Still allow drop slightly outside content: clamp to ≥ 0
                pageX = Math.max(0, pageX);
                pageY = Math.max(0, pageY);
            }
            // Target band for future header/footer drop; body is still the default add target
            let region = hitTestPageRegion(pageX, pageY);
            addComponentAt(pluginId, pageX, pageY, true, region);
        });
        // Clear highlight if palette drag ends without drop
        document.addEventListener("dragend", function () {
            clearActiveDropRegion();
            if (canvasEl) {
                canvasEl.classList.remove("canvas-drop-target");
            }
        });
    }

    function isPaletteDrag(e) {
        if (!e.dataTransfer || !e.dataTransfer.types) {
            return false;
        }
        let types = e.dataTransfer.types;
        // DOMStringList or array
        for (let i = 0; i < types.length; i++) {
            let t = types[i];
            if (t === "text/lean-component-plugin" || t === "text/plain" || t === "Text") {
                return true;
            }
        }
        return false;
    }

    // Keyboard: Delete / Backspace removes selection (when not typing in a form field)
    document.addEventListener("keydown", function (e) {
        if (!selectedComponentName) {
            return;
        }
        let tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
        if (tag === "input" || tag === "textarea" || tag === "select" || e.target.isContentEditable) {
            return;
        }
        if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            deleteSelectedComponent();
        } else if (e.key === "Enter") {
            e.preventDefault();
            openPropertiesForComponent(selectedComponentName);
        } else if (e.key === "Escape") {
            if (typeof setSidePanelOpen === "function") {
                setSidePanelOpen(false);
            }
            clearSelection();
        }
    });

    $(document).ready(function () {
        initEditShell();
        setTimeout(function () {
            loadComponentGeometries();
        }, 200);
    });

    let _origLoadDraw = typeof loadDrawSvgPage === "function" ? loadDrawSvgPage : null;
    if (_origLoadDraw) {
        window.loadDrawSvgPage = function () {
            image = new Image();
            image.onload = function () {
                loadComponentGeometries();
                drawSvg();
            };
            image.onerror = function () {
                console.error("Failed to load SVG for renderId=" + renderId);
            };
            image.src = API_BASE + "render/page/" + renderId + "/SVG/" + renderPageNumber0 + "/";
        };
    }

    window.leanEdit = {
        reloadList: loadPageComponentList,
        reloadGeometries: loadComponentGeometries,
        refresh: refreshEditorState,
        refreshHeaderFooter: loadHeaderFooterState,
        getSelectedName: function () {
            return selectedComponentName;
        },
        /** Component names on the current page (for interaction location pickers). */
        getComponentNames: function () {
            let names = [];
            for (let i = 0; i < pageComponents.length; i++) {
                if (pageComponents[i] && pageComponents[i].name) {
                    names.push(pageComponents[i].name);
                }
            }
            return names;
        },
        /** { name, pluginId } rows for the current page. */
        getPageComponents: function () {
            return pageComponents.slice();
        },
        selectComponent: selectComponent,
        clearSelection: clearSelection,
        hitTest: hitTest,
        getCatalog: function () {
            return componentPluginCatalog;
        },
        getGeometries: function () {
            return componentGeometries;
        },
        onPageMouseMove: onPageMouseMove,
        onCanvasMouseMove: onCanvasMouseMove,
        handleCanvasMouseDown: handleCanvasMouseDown,
        handleCanvasMouseUp: handleCanvasMouseUp,
        isDragging: function () {
            return !!(dragState && dragState.dragging);
        },
        getPageRegions: getPageRegions,
        getActiveDropRegion: getActiveDropRegion,
        drawOverlays: drawOverlays,
        openPropertiesForComponent: openPropertiesForComponent,
        deleteSelectedComponent: deleteSelectedComponent,
        addComponentAt: addComponentAt,
        promptAddComponent: promptAddComponent
    };
})();
