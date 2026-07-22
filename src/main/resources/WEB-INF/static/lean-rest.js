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
const sidePanel = $('#editSidePanel');
let componentJson = {};
let presentationJson = {};

let componentNames = null;
let connectorNames = null;
let themeNames = null;
const HORIZONTAL_ALIGNMENTS = ["LEFT", "RIGHT", "CENTER"];
const VERTICAL_ALIGNMENTS = ["TOP", "BOTTOM", "MIDDLE"];
const AGGREGATION_METHODS = ["SUM", "COUNT", "AVERAGE"]
let oldComponentName = null;
let componentPluginId = null;
let rowIdNumber = 1;
const ICON_SIZE = 32;
let toolbarIcons = [
    {
        "file": "/lean/api/static/images/home.svg",
        "action": () => openUrl("/lean/api/render/main/"),
        "enabled": () => {
            return true;
        }
    },
    {
        "file": "/lean/api/static/images/zoom-in.svg",
        "action": () => zoomIn(),
        "enabled": () => {
            return true
        }
    },
    {
        "file": "/lean/api/static/images/zoom-out.svg",
        "action": () => zoomOut(),
        "enabled": () => {
            return true
        }
    },
    {
        "file": "/lean/api/static/images/zoom-100.svg",
        "action": () => zoom100(),
        "enabled": () => {
            return true
        }
    },
    {
        "file": "/lean/api/static/images/arrow-left.svg",
        "action": () => previousPage(),
        "enabled": () => {
            return renderPageNumber0 > 0
        }
    },
    {
        "file": "/lean/api/static/images/arrow-right.svg",
        "action": () => nextPage(),
        "enabled": () => {
            return renderPageNumber0 < renderPageCount - 1
        }
    },
    {
        "file": "/lean/api/static/images/arrow-up.svg",
        "action": () => viewUp(),
        "enabled": () => {
            return true
        }
    },
    {
        "file": "/lean/api/static/images/arrow-down.svg",
        "action": () => viewDown(),
        "enabled": () => {
            return true
        }
    },
    {
        "file": "/lean/api/static/images/new.svg",
        "action": () => newPresentation(),
        "enabled": () => {
            return false
        }
    },
    {
        "file": "/lean/api/static/images/edit.svg",
        "action": () => editPresentation(),
        "enabled": () => {
            return true
        }
    }
];

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
    alert("TODO: open 'create presentation' page");
}

function editPresentation() {
    alert("TODO: open 'edit presentation' page");
}


/**
 * Load the toolbar icons
 */
function loadIcons() {
    for (let i = 0; i < toolbarIcons.length; i++) {
        let toolbarIcon = toolbarIcons[i];
        let icon = new Image();
        icon.onload = () => {
            console.log("Icon loaded: " + icon.src);
            toolbarIcon.icon = icon;
            toolbarIcon.index = i;
        }
        icon.src = toolbarIcon["file"];
    }
}

function drawIcons(gc, width) {
    for (let i = 0; i < toolbarIcons.length; i++) {
        let toolbarIcon = toolbarIcons[i];
        let icon = toolbarIcon.icon;
        let isEnabled = toolbarIcon.enabled.call(null);
        if (!isEnabled) {
            gc.globalAlpha = .3;
        }
        gc.drawImage(icon, 0, 0, icon.width, icon.height, 1 + i * ICON_SIZE, 0, ICON_SIZE - 2, ICON_SIZE - 2);
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

    gc.translate(0, -ICON_SIZE);
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

    if (invalidMouseLocation(x, y)) {
        return false;
    }

    // First check the cache...
    //
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

function openEditArea(url) {
    sidePanel.width("95%");
    $.ajax({
        url: url,
        type: "GET",
        contentType: "application/json; charset=utf-8",
        dataType: "html",
        success: function (snippet) {
            let editArea = document.getElementById("editArea");
            editArea.innerHTML = snippet;

            // Initialize drop-down boxes
            //
            try {
                let initScript = document.getElementById("initScript");
                eval(initScript.innerHTML);
            } catch (e) {
                alert("Error initializing the " + componentPluginId + " component widget values: " + e);
                throw e;
            }

            try {
                let loadScript = document.getElementById("loadScript");
                eval(loadScript.innerHTML);
            } catch (e) {
                alert("Error loading the " + componentPluginId + " component widget values: " + e);
                throw e;
            }
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
 * @param component
 * @param requestData
 */
function editComponent(component, requestData) {
    oldComponentName = component["name"];

    // Get the edit HTML for the given component ID
    //
    let iComponent = component["component"];

    // The first and only key is the component plugin ID
    //
    componentPluginId = Object.keys(iComponent)[0];

    // Get the HTML to edit the component from the plugin itself.
    //
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

    openEditArea(API_BASE + "edit/component/" + componentPluginId,)


}

function onCtrlLeftClick(requestData) {
    $.ajax({
        url: API_BASE + "render/getComponent/",
        type: "POST",
        data: JSON.stringify(requestData),
        contentType: "application/json; charset=utf-8",
        dataType: "json",
        success: function (component) {
            editComponent(component, requestData);

        },
        error: function (request, status, error) {
            alert(request.responseText);
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

    if (e.ctrlKey) {
        onCtrlLeftClick(requestData);
    } else {
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
    let nextPage = parseInt(renderPageNumber0) + 1;
    if (nextPage >= numberOfPages) {
        return;
    }
    window.open(API_BASE + "render/page/" + renderId + "/HTML/" + nextPage + "/", "_self");
}

function previousPage() {
    let prevPage = parseInt(renderPageNumber0) - 1;
    if (prevPage < 0) {
        return;
    }
    window.open(API_BASE + "render/page/" + renderId + "/HTML/" + prevPage + "/", "_self");
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

function getComponentNames() {
    let names = [];
    $.ajax({
            url: API_BASE + "render/info/components/" + renderId + "/" + renderPageNumber0 + "/",
            type: "GET",
            contentType: "application/json; charset=utf-8",
            dataType: "json",
            success: function (componentNames) {
                // Empty value means: relative to page
                names.push("");
                for (let i = 0; i < componentNames.length; i++) {
                    names.push(componentNames[i]);
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
            success: function (connectorNames) {
                // Empty value means: no connector
                names.push("");
                for (let i = 0; i < connectorNames.length; i++) {
                    names.push(connectorNames[i]);
                }
            },
            async: false
        }
    );
    return names;
}

function getThemeNames() {
    let names = [];
    $.ajax({
            url: API_BASE + "metadata/list/theme/",
            type: "GET",
            contentType: "application/json; charset=utf-8",
            dataType: "json",
            success: function (themeNames) {
                // Empty value means: no theme
                names.push("");
                for (let i = 0; i < themeNames.length; i++) {
                    names.push(themeNames[i]);
                }
            },
            async: false
        }
    );
    return names;
}

function describeConnectorOutput(connectorName) {
    let request = {
        renderId: renderId,
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
                rowMeta = result;
            },
            async: false
        }
    );
    return rowMeta;
}

function getConnectorColumnNames(connectorName) {
    let connectorColumnNames = [];
    if (sourceConnectorName !== null) {
        let rowMeta = describeConnectorOutput(connectorName);
        for (let i = 0; i < rowMeta.length; i++) {
            let v = rowMeta[i];
            connectorColumnNames.push(v['name']);
        }
    }
    return connectorColumnNames;
}

function setSelectOptions(selectId, values) {
    try {
        let list = document.getElementById(selectId);
        for (let i = 0; i < values.length; i++) {
            addOptionToSelect(list, values[i]);
        }
    } catch (e) {
        throw "Error adding select options for select ID '" + selectId + "' and values: " + JSON.stringify(values) + " : " + e;
    }
}

function addOptionToSelect(list, value) {
    let option = document.createElement("option");
    option.value = value;
    option.text = value;
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
 * @returns The ID of the widget {string}
 */
function createSelection(id, value, optionValues) {
    let html = '<select id="' + id + '" name="' + id + '" style="width: 100%">';
    for (let i = 0; i < optionValues.length; i++) {
        let optionValue = optionValues[i];
        let selected = '';
        if (value === optionValue) {
            selected = ' selected="selected"';
        }
        html += '<option value="' + optionValue + '"' + selected + '>' + optionValue + "</option>";
    }
    html += '</select>';
    return html;
}

function createText(id, value) {
    return '<input type="text" id="' + id + '" value="' + value + '">';
}

function createCheckBox(id, value) {
    return '<input type="checkbox" id="' + id + '" checked="' + value + '">';
}

function createButton(id, label) {
    return '<button type="button" id="' + id + '">' + label + '</button>';
}


function createIcon(id, iconFile, label) {
    return '<img src="' + API_BASE + iconFile + '" id="' + id + ' alt="' + label + '" style="width: 16px;height: 16px">';
}

function openPage(newRenderId) {
    // Try to show the same rendered page number:
    //
    window.open(API_BASE + "render/page/" + newRenderId + "/HTML/" + renderPageNumber0 + "/", "_self");
}

function reloadPresentation() {
    // Render the presentation again
    //
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
            alert("Reload of presentation failed: status=" + status + " : " + request.responseText);
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

        // The values in 'component' and iComponent will have been modified.
        // Let's save this in the metadata.
        //
        let modifyComponentRequest = {
            "presentationName": presentationName,
            "oldComponentName": oldComponentName,
            "logicalPageNumber": logicalPageNumber - 1,
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
                reloadPresentation();
            },
            error: function (request, status, error) {
                alert("Save component failed: status=" + status + " : " + request.responseText);
            }
        });
    } catch (e) {
        alert("Error saving the " + componentPluginId + " component widget values: " + e);
    }
}

function closeComponent() {
    sidePanel.width("0px");
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
    document.getElementById(elementId).value = json[jsonId];
}

function getElement(json, elementId, jsonId) {
    if (jsonId === undefined) {
        jsonId = elementId;
    }
    json[jsonId] = document.getElementById(elementId).value;
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
    let layout = componentJson["layout"][name];
    let isEnabled = layout != null;
    if (isEnabled) {
        document.getElementById(name + "Enabled").checked = isEnabled;
        document.getElementById(name + "ObjectName").value = layout["componentName"];
        document.getElementById(name + "Offset").value = "" + layout["offset"];
        document.getElementById(name + "Percentage").value = "" + layout["percentage"];
        document.getElementById(name + "Alignment").value = "" + layout["alignment"];
    }
}

function getLayout(componentJson, name) {
    let layout = null;
    let isEnabled = document.getElementById(name + "Enabled").checked;
    if (isEnabled) {
        layout = {
            "componentName": document.getElementById(name + "ObjectName").value,
            "offset": parseInt(document.getElementById(name + "Offset").value),
            "percentage": parseInt(document.getElementById(name + "Percentage").value),
            "alignment": document.getElementById(name + "Alignment").value
        };
    }
    componentJson["layout"][name] = layout;
}

function createTableRowId(tableId, rowNumber) {
    return tableId + "-" + (rowNumber + 1);
}

function setColumns(json, columnsId, tableId, columnPrefix, connectorColumnNames) {
    let columns = json[columnsId];
    let table = document.getElementById(tableId);

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

    // Column name: selection
    //
    row.insertCell(index++).innerHTML = createSelection(
        createTableColumnId(columnPrefix, "Name", i),
        column["columnName"],
        connectorColumnNames);

    // Header value: a text box
    //
    row.insertCell(index++).innerHTML = createText(
        createTableColumnId(columnPrefix, "Header", i),
        column["headerValue"]
    );
    row.insertCell(index++).innerHTML = createText(
        createTableColumnId(columnPrefix, "Width", i),
        column["width"]
    );
    row.insertCell(index++).innerHTML = createSelection(
        createTableColumnId(columnPrefix, "HorizontalAlignment", i),
        column["horizontalAlignment"],
        HORIZONTAL_ALIGNMENTS
    );
    row.insertCell(index++).innerHTML = createSelection(
        createTableColumnId(columnPrefix, "VerticalAlignment", i),
        column["verticalAlignment"],
        VERTICAL_ALIGNMENTS
    );
    let mask = column["formatMask"];
    row.insertCell(index++).innerHTML = createText(
        createTableColumnId(columnPrefix, "Format", i),
        mask === null ? "" : mask
    );

    let addId = createTableColumnId(columnPrefix, "Add", i);
    row.insertCell(index++).innerHTML = createButton(addId, "add");
    document.getElementById(addId).onclick = () => columnAdd(table, row, columnPrefix, connectorColumnNames);

    let deleteId = createTableColumnId(columnPrefix, "Delete", i);
    row.insertCell(index++).innerHTML = createButton(deleteId, "delete");
    document.getElementById(deleteId).onclick = () => columnDelete(table, row);
}

function columnAdd(table, row, columnsPrefix, connectorColumnNames) {
    let index = row.rowIndex;

    // Simple defaults for the new column
    //
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

    // Column name: selection
    //
    row.insertCell(index++).innerHTML = createSelection(
        createTableColumnId(columnPrefix, "Name", i),
        column["columnName"],
        connectorColumnNames);

    // Header value: a text box
    //
    row.insertCell(index++).innerHTML = createText(
        createTableColumnId(columnPrefix, "Header", i),
        column["headerValue"]
    );
    row.insertCell(index++).innerHTML = createText(
        createTableColumnId(columnPrefix, "Width", i),
        column["width"]
    );
    row.insertCell(index++).innerHTML = createSelection(
        createTableColumnId(columnPrefix, "HorizontalAlignment", i),
        column["horizontalAlignment"],
        HORIZONTAL_ALIGNMENTS
    );
    row.insertCell(index++).innerHTML = createSelection(
        createTableColumnId(columnPrefix, "VerticalAlignment", i),
        column["verticalAlignment"],
        VERTICAL_ALIGNMENTS
    );
    let mask = column["formatMask"];
    row.insertCell(index++).innerHTML = createText(
        createTableColumnId(columnPrefix, "Format", i),
        mask === null ? "" : mask
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
        AGGREGATION_METHODS
    );

    let addId = "columnAdd-" + i;
    row.insertCell(index++).innerHTML = createButton(addId, "add");
    document.getElementById(addId).onclick = () => factAdd(table, row, columnPrefix, connectorColumnNames);

    let deleteId = "columnDelete-" + i;
    row.insertCell(index++).innerHTML = createButton(deleteId, "delete");
    document.getElementById(deleteId).onclick = () => columnDelete(table, row);
}

function factAdd(table, row, columnsPrefix, connectorColumnNames) {
    let index = row.rowIndex;

    // Simple defaults for the new column
    //
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
            let column = getColumnsRow(rows[i]);
            alert("Got column " + i + " : " + JSON.stringify(column));
            columns.push(column);
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
        column["columnName"] = row.cells[index++].value;
        column["headerValue"] = row.cells[index++].value;
        column["width"] = parseInt(row.cells[index++].value);
        column["horizontalAlignment"] = row.cells[index++].value;
        column["verticalAlignment"] = row.cells[index++].value;
        column["formatMask"] = row.cells[index++].value;
        return column;
    } catch (e) {
        throw "Error getting values from row " + row.id + " : " + e;
    }
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
function editPresentation(component, requestData) {
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
    sidePanel.width('0');
}

function addPresentationPage() {
    // presentationJson['pages'].push({});
    alert("Add new page");
}