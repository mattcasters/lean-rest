/**
 * View-mode helpers for lean-rest.
 * Loaded after lean-rest.js when leanMode === 'view'.
 *
 * View is intentionally thin: canvas, zoom, page nav, and Lean interactions.
 * Structural editing lives in lean-edit.js.
 */
(function () {
    if (typeof leanMode === "undefined" || leanMode !== "view") {
        return;
    }
    console.log("Lean view mode ready for presentation:", presentationName);
})();
