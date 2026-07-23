package org.lean.rest.resources;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.DefaultValue;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.apache.commons.lang3.StringUtils;
import org.apache.hop.core.plugins.IPlugin;
import org.apache.hop.core.plugins.PluginRegistry;
import org.apache.hop.metadata.api.IHopMetadataSerializer;
import org.apache.hop.metadata.serializer.json.JsonMetadataParser;
import org.json.simple.JSONObject;
import org.lean.core.LeanAttachment;
import org.lean.core.exception.LeanException;
import org.lean.presentation.LeanPresentation;
import org.lean.presentation.component.LeanComponent;
import org.lean.presentation.component.type.ILeanComponent;
import org.lean.presentation.component.type.LeanComponentPluginType;
import org.lean.presentation.component.types.label.LeanLabelComponent;
import org.lean.presentation.layout.LeanLayout;
import org.lean.presentation.layout.LeanRenderPage;
import org.lean.presentation.page.LeanPage;
import org.lean.presentation.variable.LeanParameter;
import org.lean.rest.render.IRendering;
import org.lean.rest.render.RenderFactory;

/**
 * Entry points for the WYSIWYG presentation editor (edit mode).
 */
@Path("edit/presentation")
public class EditPresentationResource extends BaseResource {

  private static final ObjectMapper MAPPER = new ObjectMapper();

  /**
   * Create a new empty presentation (one landscape page, no components) and save it to metadata.
   * Body: {@code { "name": "...", "description": "...", "width": 1123, "height": 794 }} — only
   * {@code name} is required.
   */
  @POST
  @Path("/create/")
  @jakarta.ws.rs.Consumes(MediaType.APPLICATION_JSON)
  @Produces(MediaType.TEXT_PLAIN)
  public Response createPresentation(Map<String, Object> body) {
    try {
      if (body == null || body.get("name") == null) {
        return getServerError("Request body must include a non-empty \"name\"", false);
      }
      String name = String.valueOf(body.get("name")).trim();
      if (name.isEmpty()) {
        return getServerError("Presentation name must not be empty", false);
      }
      String description =
          body.get("description") != null ? String.valueOf(body.get("description")) : "";
      int width = toInt(body.get("width"), 1123);
      int height = toInt(body.get("height"), 794);
      int margin = toInt(body.get("margin"), 25);

      IHopMetadataSerializer<LeanPresentation> serializer =
          leanRest.getMetadataProvider().getSerializer(LeanPresentation.class);
      if (serializer.exists(name)) {
        return getServerError("A presentation named '" + name + "' already exists", false);
      }

      LeanPresentation presentation = new LeanPresentation();
      presentation.setName(name);
      presentation.setDescription(description);
      presentation.setDefaultThemeName(
          body.get("defaultThemeName") != null
              ? String.valueOf(body.get("defaultThemeName"))
              : "Default");

      LeanPage page = new LeanPage(width, height, margin, margin, margin, margin);
      page.setHeader(false);
      page.setFooter(false);
      presentation.getPages().add(page);

      // Attach default theme from metadata when present so first render has colors
      try {
        org.lean.presentation.theme.LeanTheme theme =
            leanRest
                .getMetadataProvider()
                .getSerializer(org.lean.presentation.theme.LeanTheme.class)
                .load(presentation.getDefaultThemeName());
        if (theme != null) {
          presentation.getThemes().add(theme);
        }
      } catch (Exception ignored) {
        // render path will load/create default as needed
      }

      serializer.save(presentation);
      leanRest.getLog().logBasic("Created presentation '" + name + "'");
      return Response.ok(name).type(MediaType.TEXT_PLAIN).build();
    } catch (Exception e) {
      return getServerError("Error creating presentation", e);
    }
  }

  private static int toInt(Object value, int defaultValue) {
    if (value == null) {
      return defaultValue;
    }
    if (value instanceof Number) {
      return ((Number) value).intValue();
    }
    try {
      return Integer.parseInt(String.valueOf(value).trim());
    } catch (Exception e) {
      return defaultValue;
    }
  }

  private static int defaultDropWidth(String pluginId) {
    if (pluginId == null) {
      return 320;
    }
    if (pluginId.contains("Chart") || pluginId.contains("Crosstab")) {
      return 400;
    }
    if (pluginId.contains("Table")) {
      return 360;
    }
    if (pluginId.contains("Image") || pluginId.contains("Svg") || pluginId.contains("SVG")) {
      return 200;
    }
    return 320;
  }

  private static int defaultDropHeight(String pluginId) {
    if (pluginId == null) {
      return 200;
    }
    if (pluginId.contains("Chart") || pluginId.contains("Crosstab")) {
      return 260;
    }
    if (pluginId.contains("Table")) {
      return 220;
    }
    if (pluginId.contains("Image") || pluginId.contains("Svg") || pluginId.contains("SVG")) {
      return 150;
    }
    return 200;
  }

  /**
   * Open a presentation in edit mode: render it and return the editor HTML shell.
   *
   * @param name presentation metadata name
   * @param page 0-based render page index (default 0)
   * @param reload if true (default), force a fresh layout/render
   */
  @GET
  @Path("/{name}/")
  @Produces(MediaType.TEXT_HTML)
  public Response openEditor(
      @PathParam("name") String name,
      @QueryParam("page") @DefaultValue("0") int page,
      @QueryParam("reload") @DefaultValue("true") boolean reload) {
    try {
      return openEditorInternal(name, page, reload);
    } catch (Exception e) {
      return getServerError("Error opening presentation editor for '" + name + "'", e);
    }
  }

  /**
   * Same as {@link #openEditor} with page in the path: {@code /{name}/page/{page}/}.
   */
  @GET
  @Path("/{name}/page/{page}/")
  @Produces(MediaType.TEXT_HTML)
  public Response openEditorPage(
      @PathParam("name") String name,
      @PathParam("page") int page,
      @QueryParam("reload") @DefaultValue("false") boolean reload) {
    try {
      return openEditorInternal(name, page, reload);
    } catch (Exception e) {
      return getServerError(
          "Error opening presentation editor for '" + name + "' page " + page, e);
    }
  }

  private Response openEditorInternal(String name, int page, boolean reload) throws Exception {
    LeanPresentation presentation = leanRest.loadPresentation(name);
    if (presentation == null) {
      return getServerError("Presentation not found: " + name, false);
    }

    IRendering rendering = leanRest.findRendering(name, Collections.emptyList());
    if (rendering != null && reload) {
      leanRest.removeRendering(rendering);
      rendering = null;
    }
    if (rendering == null) {
      rendering =
          RenderFactory.renderPresentation(
              leanRest.getLoggingObject(),
              leanRest.getMetadataProvider(),
              presentation,
              Collections.<LeanParameter>emptyList());
      leanRest.storeRendering(rendering);
    }

    List<LeanRenderPage> pages = rendering.getLayoutResults().getRenderPages();
    if (pages == null || pages.isEmpty()) {
      return getServerError("Presentation '" + name + "' rendered with no pages", false);
    }
    if (page < 0 || page >= pages.size()) {
      return getServerError(
          "Invalid page " + page + " for presentation '" + name + "' (count=" + pages.size() + ")",
          false);
    }

    return RenderFactory.renderPageHtml(rendering, pages.get(page), "edit");
  }

  /**
   * Header/footer presence and height for the editor rail.
   *
   * <pre>{ "header": { "enabled": true, "height": 50 }, "footer": { "enabled": false, "height": 25 },
   * "portrait": false }</pre>
   */
  @GET
  @Path("/{name}/header-footer/")
  @Produces(MediaType.APPLICATION_JSON)
  public Response getHeaderFooter(@PathParam("name") String name) {
    try {
      LeanPresentation presentation = leanRest.loadPresentation(name);
      if (presentation == null) {
        return getServerError("Presentation not found: " + name, false);
      }
      return Response.ok(MAPPER.writeValueAsString(headerFooterState(presentation)))
          .type(MediaType.APPLICATION_JSON_TYPE)
          .encoding("UTF-8")
          .build();
    } catch (Exception e) {
      return getServerError("Error loading header/footer for presentation '" + name + "'", e);
    }
  }

  /**
   * Enable/disable header and footer and/or set their heights.
   *
   * <p>Body (all fields optional):
   *
   * <pre>
   * {
   *   "header": { "enabled": true, "height": 50 },
   *   "footer": { "enabled": false, "height": 25 }
   * }
   * </pre>
   *
   * Enabling creates a page via {@link LeanPage#getHeaderFooter(boolean, boolean, int)} sized to
   * the presentation's first body page orientation; width matches body usable width.
   */
  @POST
  @Path("/{name}/header-footer/")
  @Consumes(MediaType.APPLICATION_JSON)
  @Produces(MediaType.APPLICATION_JSON)
  public Response updateHeaderFooter(@PathParam("name") String name, Map<String, Object> body) {
    try {
      IHopMetadataSerializer<LeanPresentation> serializer =
          leanRest.getMetadataProvider().getSerializer(LeanPresentation.class);
      LeanPresentation presentation = serializer.load(name);
      if (presentation == null) {
        return getServerError("Presentation not found: " + name, false);
      }

      boolean portrait = isPortrait(presentation);
      int defaultHeaderH = 50;
      int defaultFooterH = 25;

      applyHeaderFooterToggle(
          presentation, true, body != null ? asMap(body.get("header")) : null, portrait, defaultHeaderH);
      applyHeaderFooterToggle(
          presentation, false, body != null ? asMap(body.get("footer")) : null, portrait, defaultFooterH);

      serializer.save(presentation);
      leanRest.getLog().logBasic("Updated header/footer for presentation '" + name + "'");

      return Response.ok(MAPPER.writeValueAsString(headerFooterState(presentation)))
          .type(MediaType.APPLICATION_JSON_TYPE)
          .encoding("UTF-8")
          .build();
    } catch (Exception e) {
      return getServerError("Error updating header/footer for presentation '" + name + "'", e);
    }
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> asMap(Object value) {
    if (value instanceof Map) {
      return (Map<String, Object>) value;
    }
    return null;
  }

  private static Map<String, Object> headerFooterState(LeanPresentation presentation) {
    Map<String, Object> state = new LinkedHashMap<>();
    LeanPage header = presentation.getHeader();
    LeanPage footer = presentation.getFooter();
    Map<String, Object> h = new LinkedHashMap<>();
    h.put("enabled", header != null);
    h.put("height", header != null ? header.getHeight() : 50);
    Map<String, Object> f = new LinkedHashMap<>();
    f.put("enabled", footer != null);
    f.put("height", footer != null ? footer.getHeight() : 25);
    state.put("header", h);
    state.put("footer", f);
    state.put("portrait", isPortrait(presentation));

    // Page metrics + region rectangles (page coordinates) for editor overlays
    LeanPage body =
        presentation.getPages() != null && !presentation.getPages().isEmpty()
            ? presentation.getPages().get(0)
            : null;
    int pageW = body != null ? body.getWidth() : 1123;
    int pageH = body != null ? body.getHeight() : 794;
    int lm = body != null ? body.getLeftMargin() : 25;
    int rm = body != null ? body.getRightMargin() : 25;
    int tm = body != null ? body.getTopMargin() : 25;
    int bm = body != null ? body.getBottomMargin() : 25;
    int headerH = header != null ? header.getHeight() : 0;
    int footerH = footer != null ? footer.getHeight() : 0;
    int usableW = Math.max(0, pageW - lm - rm);

    Map<String, Object> page = new LinkedHashMap<>();
    page.put("width", pageW);
    page.put("height", pageH);
    page.put("leftMargin", lm);
    page.put("rightMargin", rm);
    page.put("topMargin", tm);
    page.put("bottomMargin", bm);
    state.put("page", page);

    // Regions match LeanPresentation.renderHeaderFooter / body offsets
    Map<String, Object> regions = new LinkedHashMap<>();
    regions.put("page", rectMap(0, 0, pageW, pageH));
    if (header != null) {
      regions.put("header", rectMap(lm, tm, usableW, headerH));
    } else {
      regions.put("header", null);
    }
    int contentY = tm + headerH;
    int contentH = Math.max(0, pageH - tm - bm - headerH - footerH);
    regions.put("content", rectMap(lm, contentY, usableW, contentH));
    if (footer != null) {
      regions.put("footer", rectMap(lm, pageH - bm - footerH, usableW, footerH));
    } else {
      regions.put("footer", null);
    }
    state.put("regions", regions);
    return state;
  }

  private static Map<String, Object> rectMap(int x, int y, int width, int height) {
    Map<String, Object> r = new LinkedHashMap<>();
    r.put("x", x);
    r.put("y", y);
    r.put("width", width);
    r.put("height", height);
    return r;
  }

  private static boolean isPortrait(LeanPresentation presentation) {
    if (presentation.getPages() == null || presentation.getPages().isEmpty()) {
      return false;
    }
    LeanPage first = presentation.getPages().get(0);
    return first.getHeight() >= first.getWidth();
  }

  private static void applyHeaderFooterToggle(
      LeanPresentation presentation,
      boolean isHeader,
      Map<String, Object> spec,
      boolean portrait,
      int defaultHeight) {
    if (spec == null) {
      return;
    }
    LeanPage current = isHeader ? presentation.getHeader() : presentation.getFooter();
    boolean enabled;
    if (spec.containsKey("enabled")) {
      Object en = spec.get("enabled");
      enabled = en instanceof Boolean ? (Boolean) en : Boolean.parseBoolean(String.valueOf(en));
    } else {
      enabled = current != null;
    }
    int height = current != null ? current.getHeight() : defaultHeight;
    if (spec.get("height") != null) {
      height = toInt(spec.get("height"), height);
      if (height < 1) {
        height = 1;
      }
    }

    if (!enabled) {
      if (isHeader) {
        presentation.setHeader(null);
      } else {
        presentation.setFooter(null);
      }
      return;
    }

    if (current == null) {
      // Create via LeanPage.getHeaderFooter (matches engine helpers / samples)
      LeanPage created = LeanPage.getHeaderFooter(isHeader, portrait, height);
      // Match usable width of first body page when available
      if (presentation.getPages() != null && !presentation.getPages().isEmpty()) {
        LeanPage body = presentation.getPages().get(0);
        created.setWidth(Math.max(1, body.getWidthBetweenMargins()));
      }
      if (isHeader) {
        presentation.setHeader(created);
      } else {
        presentation.setFooter(created);
      }
    } else {
      current.setHeight(height);
      current.setHeader(isHeader);
      current.setFooter(!isHeader);
    }
  }

  /**
   * Offset-only drag end: add {@code dx}/{@code dy} to the component's left/top layout offsets
   * (and to right/bottom when they encode size via LEFT/TOP page anchors). Does not rewrite
   * relative {@code componentName}, alignment, or percentage.
   *
   * <p>Body: {@code { "dx": 10, "dy": -5 }} — either may be omitted (default 0). {@code
   * componentName} may be a metadata name or a synthetic drawn name (group/composite).
   */
  @POST
  @Path("/{name}/components/{componentName}/nudge/")
  @Consumes(MediaType.APPLICATION_JSON)
  @Produces(MediaType.APPLICATION_JSON)
  public Response nudgeComponent(
      @PathParam("name") String name,
      @PathParam("componentName") String componentName,
      Map<String, Object> body) {
    try {
      int dx = toInt(body != null ? body.get("dx") : null, 0);
      int dy = toInt(body != null ? body.get("dy") : null, 0);
      if (dx == 0 && dy == 0) {
        Map<String, Object> noop = new LinkedHashMap<>();
        noop.put("name", componentName);
        noop.put("dx", 0);
        noop.put("dy", 0);
        noop.put("changed", false);
        return Response.ok(MAPPER.writeValueAsString(noop))
            .type(MediaType.APPLICATION_JSON_TYPE)
            .encoding("UTF-8")
            .build();
      }

      IHopMetadataSerializer<LeanPresentation> serializer =
          leanRest.getMetadataProvider().getSerializer(LeanPresentation.class);
      LeanPresentation presentation = serializer.load(name);
      if (presentation == null) {
        return getServerError("Presentation not found: " + name, false);
      }

      ComponentLookup.Found found = ComponentLookup.find(presentation, null, componentName);
      if (found == null) {
        return getServerError(
            "Component '" + componentName + "' not found in presentation '" + name + "'", false);
      }

      applyOffsetNudge(found.component, dx, dy);
      serializer.save(presentation);

      leanRest
          .getLog()
          .logBasic(
              "nudge: '"
                  + found.component.getName()
                  + "' in '"
                  + name
                  + "' by ("
                  + dx
                  + ","
                  + dy
                  + ")");

      Map<String, Object> result = new LinkedHashMap<>();
      result.put("name", found.component.getName());
      result.put("dx", dx);
      result.put("dy", dy);
      result.put("changed", true);
      result.put("pageRole", found.pageRole);
      result.put("logicalPageNumber", found.logicalPageNumber);
      return Response.ok(MAPPER.writeValueAsString(result))
          .type(MediaType.APPLICATION_JSON_TYPE)
          .encoding("UTF-8")
          .build();
    } catch (Exception e) {
      return getServerError(
          "Error nudging component '" + componentName + "' in presentation '" + name + "'", e);
    }
  }

  /**
   * Adjust layout offsets only. Relative anchors (componentName / percentage / alignment) are
   * preserved. When right/bottom encode absolute size (LEFT/TOP alignment on page), their offsets
   * move with the box so width/height stay constant.
   */
  private static void applyOffsetNudge(LeanComponent component, int dx, int dy) {
    if (component == null) {
      return;
    }
    LeanLayout layout = component.getLayout();
    if (layout == null) {
      layout = new LeanLayout();
      component.setLayout(layout);
    }
    if (dx != 0) {
      if (layout.getLeft() == null) {
        layout.setLeft(new LeanAttachment(null, 0, dx, LeanAttachment.Alignment.LEFT));
      } else {
        layout.getLeft().setOffset(layout.getLeft().getOffset() + dx);
      }
      // Keep absolute-size boxes (right with LEFT alignment) the same width
      if (layout.getRight() != null
          && layout.getRight().getAlignment() == LeanAttachment.Alignment.LEFT) {
        layout.getRight().setOffset(layout.getRight().getOffset() + dx);
      }
    }
    if (dy != 0) {
      if (layout.getTop() == null) {
        layout.setTop(new LeanAttachment(null, 0, dy, LeanAttachment.Alignment.TOP));
      } else {
        layout.getTop().setOffset(layout.getTop().getOffset() + dy);
      }
      if (layout.getBottom() != null
          && layout.getBottom().getAlignment() == LeanAttachment.Alignment.TOP) {
        layout.getBottom().setOffset(layout.getBottom().getOffset() + dy);
      }
    }
  }

  /**
   * Components on a logical presentation page (name + plugin id/name) for the editor left list.
   *
   * @param name presentation metadata name
   * @param logicalIndex 0-based index into {@link LeanPresentation#getPages()}
   */
  @GET
  @Path("/{name}/pages/{logicalIndex}/components/")
  @Produces(MediaType.APPLICATION_JSON)
  public Response listPageComponents(
      @PathParam("name") String name, @PathParam("logicalIndex") int logicalIndex) {
    try {
      LeanPresentation presentation = leanRest.loadPresentation(name);
      if (presentation == null) {
        return getServerError("Presentation not found: " + name, false);
      }
      List<LeanPage> pages = presentation.getPages();
      if (pages == null || logicalIndex < 0 || logicalIndex >= pages.size()) {
        return getServerError(
            "Invalid logical page index "
                + logicalIndex
                + " for presentation '"
                + name
                + "'",
            false);
      }
      LeanPage page = pages.get(logicalIndex);
      List<Map<String, Object>> rows = new ArrayList<>();
      if (page.getComponents() != null) {
        for (LeanComponent component : page.getComponents()) {
          rows.add(toComponentSummary(component));
        }
      }
      return Response.ok(MAPPER.writeValueAsString(rows))
          .type(MediaType.APPLICATION_JSON_TYPE)
          .encoding("UTF-8")
          .build();
    } catch (Exception e) {
      return getServerError(
          "Error listing components for presentation '" + name + "' page " + logicalIndex, e);
    }
  }

  /**
   * Add a new component on a logical page at page-absolute coordinates.
   *
   * <p>Body: {@code { "pluginId": "LeanLabelComponent", "x": 100, "y": 80, "name": "optional" }}.
   * Layout is page-absolute left/top attachments (offsets = drop x/y). Returns {@code { name,
   * pluginId, logicalPageNumber }}.
   */
  @POST
  @Path("/{name}/pages/{logicalIndex}/components/")
  @Consumes(MediaType.APPLICATION_JSON)
  @Produces(MediaType.APPLICATION_JSON)
  public Response addComponentOnLogicalPage(
      @PathParam("name") String name,
      @PathParam("logicalIndex") int logicalIndex,
      Map<String, Object> body) {
    try {
      return addComponentInternal(name, logicalIndex, body);
    } catch (Exception e) {
      return getServerError(
          "Error adding component to presentation '" + name + "' page " + logicalIndex, e);
    }
  }

  /**
   * Add a component on the body page that corresponds to a render (physical) page. Preferred by the
   * palette drop handler when only {@code renderId} is known.
   */
  @POST
  @Path("/by-render/{renderId}/pages/{pageNumber}/components/")
  @Consumes(MediaType.APPLICATION_JSON)
  @Produces(MediaType.APPLICATION_JSON)
  public Response addComponentOnRenderPage(
      @PathParam("renderId") String renderId,
      @PathParam("pageNumber") int pageNumber,
      Map<String, Object> body) {
    try {
      IRendering rendering = leanRest.getRendering(renderId);
      if (rendering == null) {
        return getServerError("Unable to find rendering with ID " + renderId, false);
      }
      List<LeanRenderPage> renderPages = rendering.getLayoutResults().getRenderPages();
      if (pageNumber < 0 || pageNumber >= renderPages.size()) {
        return getServerError("Invalid render page " + pageNumber, false);
      }
      LeanPage renderBody = renderPages.get(pageNumber).getPage();
      LeanPresentation rendered = rendering.getPresentation();
      int logicalIndex = resolveLogicalPageIndex(rendered, renderBody, pageNumber);
      String presentationName = rendering.getPresentationName();
      if (StringUtils.isBlank(presentationName) && rendered != null) {
        presentationName = rendered.getName();
      }
      if (StringUtils.isBlank(presentationName)) {
        return getServerError("Rendering has no presentation name", false);
      }
      return addComponentInternal(presentationName, logicalIndex, body);
    } catch (Exception e) {
      return getServerError(
          "Error adding component on render " + renderId + " page " + pageNumber, e);
    }
  }

  private Response addComponentInternal(String name, int logicalIndex, Map<String, Object> body)
      throws Exception {
    if (body == null || body.get("pluginId") == null || StringUtils.isBlank(String.valueOf(body.get("pluginId")))) {
      return getServerError("Request body must include non-empty \"pluginId\"", false);
    }
    String pluginId = String.valueOf(body.get("pluginId")).trim();
    int x = toInt(body.get("x"), 50);
    int y = toInt(body.get("y"), 50);
    String requestedName =
        body.get("name") != null ? String.valueOf(body.get("name")).trim() : null;
    String pageRole =
        body.get("pageRole") != null
            ? String.valueOf(body.get("pageRole")).trim().toLowerCase()
            : "page";

    IHopMetadataSerializer<LeanPresentation> serializer =
        leanRest.getMetadataProvider().getSerializer(LeanPresentation.class);
    LeanPresentation presentation = serializer.load(name);
    if (presentation == null) {
      return getServerError("Presentation not found: " + name, false);
    }
    List<LeanPage> pages = presentation.getPages();
    if (pages == null || pages.isEmpty()) {
      return getServerError("Presentation '" + name + "' has no body pages", false);
    }
    if (logicalIndex < 0 || logicalIndex >= pages.size()) {
      logicalIndex = 0;
    }
    LeanPage bodyPage = pages.get(logicalIndex);
    LeanPage page;
    if ("header".equals(pageRole)) {
      page = presentation.getHeader();
      if (page == null) {
        return getServerError("Presentation has no header — enable it first", false);
      }
      // Drop coordinates are page-absolute; convert to header-local
      int lm = bodyPage.getLeftMargin();
      int tm = bodyPage.getTopMargin();
      x = Math.max(0, x - lm);
      y = Math.max(0, y - tm);
    } else if ("footer".equals(pageRole)) {
      page = presentation.getFooter();
      if (page == null) {
        return getServerError("Presentation has no footer — enable it first", false);
      }
      int lm = bodyPage.getLeftMargin();
      int footerTop =
          bodyPage.getHeight() - bodyPage.getBottomMargin() - page.getHeight();
      x = Math.max(0, x - lm);
      y = Math.max(0, y - footerTop);
    } else {
      page = bodyPage;
      pageRole = "page";
    }

    PluginRegistry registry = PluginRegistry.getInstance();
    IPlugin plugin = registry.findPluginWithId(LeanComponentPluginType.class, pluginId);
    if (plugin == null) {
      return getServerError("Unknown component plugin id: " + pluginId, false);
    }
    ILeanComponent iComponent = (ILeanComponent) registry.loadClass(plugin);
    if (iComponent == null) {
      return getServerError("Could not instantiate component plugin: " + pluginId, false);
    }
    if (StringUtils.isBlank(iComponent.getPluginId())) {
      iComponent.setPluginId(pluginId);
    }
    // Sensible defaults for empty label text
    if (iComponent instanceof LeanLabelComponent label) {
      if (StringUtils.isBlank(label.getLabel())) {
        label.setLabel(plugin.getName() != null ? plugin.getName() : "Label");
      }
    }
    // Use presentation default theme when unset
    if (StringUtils.isBlank(iComponent.getThemeName())
        && StringUtils.isNotBlank(presentation.getDefaultThemeName())) {
      iComponent.setThemeName(presentation.getDefaultThemeName());
    }

    String baseName =
        StringUtils.isNotBlank(requestedName)
            ? requestedName
            : (plugin.getName() != null ? plugin.getName() : pluginId);
    String componentName = uniqueComponentName(presentation, baseName);

    LeanComponent leanComponent = new LeanComponent(componentName, iComponent);
    LeanLayout layout = new LeanLayout();
    layout.setLeft(new LeanAttachment(null, 0, x, LeanAttachment.Alignment.LEFT));
    layout.setTop(new LeanAttachment(null, 0, y, LeanAttachment.Alignment.TOP));
    // Charts/tables/etc. have no natural size without data — give a default box so they are visible
    // after drop. Labels compute size from text and stay point-sized (left/top only).
    if (!(iComponent instanceof LeanLabelComponent)) {
      int defaultW = defaultDropWidth(pluginId);
      int defaultH = defaultDropHeight(pluginId);
      // right attachment with LEFT alignment: width = offset - x  (page origin geometry)
      layout.setRight(new LeanAttachment(null, 0, x + defaultW, LeanAttachment.Alignment.LEFT));
      layout.setBottom(new LeanAttachment(null, 0, y + defaultH, LeanAttachment.Alignment.TOP));
    }
    leanComponent.setLayout(layout);

    if (page.getComponents() == null) {
      page.setComponents(new ArrayList<>());
    }
    page.getComponents().add(leanComponent);
    serializer.save(presentation);

    leanRest
        .getLog()
        .logBasic(
            "add component: '"
                + componentName
                + "' ("
                + pluginId
                + ") at ("
                + x
                + ","
                + y
                + ") role="
                + pageRole
                + " of '"
                + name
                + "'");

    Map<String, Object> result = new LinkedHashMap<>();
    result.put("name", componentName);
    result.put("pluginId", pluginId);
    result.put("logicalPageNumber", "page".equals(pageRole) ? logicalIndex : -1);
    result.put("pageRole", pageRole);
    result.put("x", x);
    result.put("y", y);
    return Response.ok(MAPPER.writeValueAsString(result))
        .type(MediaType.APPLICATION_JSON_TYPE)
        .encoding("UTF-8")
        .build();
  }

  /** Prefer identity match on the rendered presentation; fall back to clamped page number. */
  private static int resolveLogicalPageIndex(
      LeanPresentation rendered, LeanPage renderBody, int pageNumber) {
    if (rendered != null && rendered.getPages() != null && renderBody != null) {
      for (int i = 0; i < rendered.getPages().size(); i++) {
        if (rendered.getPages().get(i) == renderBody) {
          return i;
        }
      }
    }
    if (rendered == null || rendered.getPages() == null || rendered.getPages().isEmpty()) {
      return 0;
    }
    return Math.max(0, Math.min(pageNumber, rendered.getPages().size() - 1));
  }

  /**
   * Unique component name across all body pages, header, and footer. Uses {@code base}, {@code base
   * 2}, {@code base 3}, …
   */
  private static String uniqueComponentName(LeanPresentation presentation, String base) {
    String seed = StringUtils.isBlank(base) ? "Component" : base.trim();
    Set<String> used = collectComponentNames(presentation);
    if (!usedContainsIgnoreCase(used, seed)) {
      return seed;
    }
    int n = 2;
    while (usedContainsIgnoreCase(used, seed + " " + n)) {
      n++;
    }
    return seed + " " + n;
  }

  private static boolean usedContainsIgnoreCase(Set<String> used, String name) {
    for (String u : used) {
      if (u != null && u.equalsIgnoreCase(name)) {
        return true;
      }
    }
    return false;
  }

  private static Set<String> collectComponentNames(LeanPresentation presentation) {
    Set<String> names = new HashSet<>();
    if (presentation.getPages() != null) {
      for (LeanPage p : presentation.getPages()) {
        addPageComponentNames(names, p);
      }
    }
    addPageComponentNames(names, presentation.getHeader());
    addPageComponentNames(names, presentation.getFooter());
    return names;
  }

  private static void addPageComponentNames(Set<String> names, LeanPage page) {
    if (page == null || page.getComponents() == null) {
      return;
    }
    for (LeanComponent c : page.getComponents()) {
      if (c != null && c.getName() != null) {
        names.add(c.getName());
      }
    }
  }

  /**
   * Components on the logical page that corresponds to a given render (physical) page, plus optional
   * header/footer markers. Preferred by the editor when only {@code renderId} is known.
   */
  @GET
  @Path("/by-render/{renderId}/pages/{pageNumber}/components/")
  @Produces(MediaType.APPLICATION_JSON)
  public Response listComponentsForRenderPage(
      @PathParam("renderId") String renderId, @PathParam("pageNumber") int pageNumber) {
    try {
      IRendering rendering = leanRest.getRendering(renderId);
      if (rendering == null) {
        return getServerError("Unable to find rendering with ID " + renderId, false);
      }
      List<LeanRenderPage> renderPages = rendering.getLayoutResults().getRenderPages();
      if (pageNumber < 0 || pageNumber >= renderPages.size()) {
        return getServerError("Invalid render page " + pageNumber, false);
      }
      LeanPage leanPage = renderPages.get(pageNumber).getPage();
      LeanPresentation presentation = rendering.getPresentation();
      List<Map<String, Object>> rows = new ArrayList<>();

      // Presentation header components (drawn on every physical page)
      if (presentation != null
          && presentation.getHeader() != null
          && presentation.getHeader().getComponents() != null) {
        for (LeanComponent component : presentation.getHeader().getComponents()) {
          Map<String, Object> row = toComponentSummary(component);
          row.put("pageRole", "header");
          rows.add(row);
        }
      }

      // Body page components for this render page
      if (leanPage != null && leanPage.getComponents() != null) {
        String role = "page";
        if (leanPage.isHeader()) {
          role = "header";
        } else if (leanPage.isFooter()) {
          role = "footer";
        }
        for (LeanComponent component : leanPage.getComponents()) {
          Map<String, Object> row = toComponentSummary(component);
          row.put("pageRole", role);
          rows.add(row);
        }
      }

      // Presentation footer components
      if (presentation != null
          && presentation.getFooter() != null
          && presentation.getFooter().getComponents() != null) {
        for (LeanComponent component : presentation.getFooter().getComponents()) {
          Map<String, Object> row = toComponentSummary(component);
          row.put("pageRole", "footer");
          rows.add(row);
        }
      }

      return Response.ok(MAPPER.writeValueAsString(rows))
          .type(MediaType.APPLICATION_JSON_TYPE)
          .encoding("UTF-8")
          .build();
    } catch (Exception e) {
      return getServerError(
          "Error listing components for render " + renderId + " page " + pageNumber, e);
    }
  }

  /**
   * Re-layout and re-render a presentation after metadata mutations. Returns the new render id and
   * page count so the editor can soft-refresh the canvas without a full navigation.
   */
  @POST
  @Path("/{name}/render/")
  @Produces(MediaType.APPLICATION_JSON)
  public Response reRender(@PathParam("name") String name) {
    try {
      LeanPresentation presentation = leanRest.loadPresentation(name);
      if (presentation == null) {
        return getServerError("Presentation not found: " + name, false);
      }
      IRendering existing = leanRest.findRendering(name, Collections.emptyList());
      if (existing != null) {
        leanRest.removeRendering(existing);
      }
      IRendering rendering =
          RenderFactory.renderPresentation(
              leanRest.getLoggingObject(),
              leanRest.getMetadataProvider(),
              presentation,
              Collections.<LeanParameter>emptyList());
      leanRest.storeRendering(rendering);
      Map<String, Object> body = new LinkedHashMap<>();
      body.put("renderId", rendering.getId());
      int pageCount =
          rendering.getLayoutResults() != null
                  && rendering.getLayoutResults().getRenderPages() != null
              ? rendering.getLayoutResults().getRenderPages().size()
              : 0;
      body.put("pageCount", pageCount);
      return Response.ok(MAPPER.writeValueAsString(body))
          .type(MediaType.APPLICATION_JSON_TYPE)
          .encoding("UTF-8")
          .build();
    } catch (Exception e) {
      return getServerError("Error re-rendering presentation '" + name + "'", e);
    }
  }

  /**
   * Render a single component in isolation (SVG) for the property editor preview pane.
   *
   * <p>Builds a fresh in-memory presentation: one page (no header/footer), size from {@code width}
   * / {@code height} (component geometry on the page when provided by the client), hooks up
   * presentation + shared metadata connectors and themes, then renders only that component.
   */
  @GET
  @Path("/{name}/components/{componentName}/preview.svg")
  @Produces("image/svg+xml")
  public Response previewComponent(
      @PathParam("name") String name,
      @PathParam("componentName") String componentName,
      @QueryParam("width") @DefaultValue("0") int width,
      @QueryParam("height") @DefaultValue("0") int height) {
    try {
      LeanPresentation source = leanRest.loadPresentation(name);
      if (source == null) {
        return getServerError("Presentation not found: " + name, false);
      }
      FoundComponent found = findComponentAnywhere(source, componentName);
      if (found == null) {
        return getServerError(
            "Component '" + componentName + "' not found in presentation '" + name + "'", false);
      }

      int pageW = width > 0 ? width : 400;
      int pageH = height > 0 ? height : 300;
      // Minimal padding — fullPage layout should nearly fill the frame
      pageW = Math.max(40, pageW + 4);
      pageH = Math.max(40, pageH + 4);

      var metadataProvider = leanRest.getMetadataProvider();
      List<org.lean.presentation.connector.LeanConnector> connectors =
          collectConnectorsForPreview(source, found.component, metadataProvider);
      List<org.lean.presentation.theme.LeanTheme> themes =
          collectThemesForPreview(source, metadataProvider);

      // Pass source presentation so series colors (getStableColor) match full-page order
      String svg =
          found.component.getSvgXml(
              pageW, pageH, connectors, themes, metadataProvider, source);
      return Response.ok(svg).type("image/svg+xml").encoding("UTF-8").build();
    } catch (Exception e) {
      return getServerError(
          "Error rendering preview for component '"
              + componentName
              + "' in presentation '"
              + name
              + "'",
          e);
    }
  }

  /**
   * Gather connectors the component may need: all presentation-local ones (copied), plus any
   * sourceConnectorName resolved from shared metadata if not already present.
   */
  private List<org.lean.presentation.connector.LeanConnector> collectConnectorsForPreview(
      LeanPresentation source,
      LeanComponent component,
      org.apache.hop.metadata.api.IHopMetadataProvider metadataProvider) {
    List<org.lean.presentation.connector.LeanConnector> connectors = new ArrayList<>();
    java.util.Set<String> names = new java.util.HashSet<>();

    if (source.getConnectors() != null) {
      for (org.lean.presentation.connector.LeanConnector c : source.getConnectors()) {
        if (c == null || c.getName() == null) {
          continue;
        }
        connectors.add(new org.lean.presentation.connector.LeanConnector(c));
        names.add(c.getName());
      }
    }

    // Component may reference a shared metadata connector not embedded on the presentation
    String sourceName = null;
    if (component.getComponent() != null) {
      sourceName = component.getComponent().getSourceConnectorName();
    }
    if (sourceName != null && !sourceName.isBlank() && !names.contains(sourceName)) {
      try {
        org.lean.presentation.connector.LeanConnector shared =
            metadataProvider
                .getSerializer(org.lean.presentation.connector.LeanConnector.class)
                .load(sourceName);
        if (shared != null) {
          connectors.add(new org.lean.presentation.connector.LeanConnector(shared));
          names.add(sourceName);
        }
      } catch (Exception e) {
        leanRest
            .getLog()
            .logBasic(
                "preview: could not load shared connector '" + sourceName + "': " + e.getMessage());
      }
    }
    return connectors;
  }

  /** Presentation themes + default theme from metadata if missing; never empty. */
  private List<org.lean.presentation.theme.LeanTheme> collectThemesForPreview(
      LeanPresentation source,
      org.apache.hop.metadata.api.IHopMetadataProvider metadataProvider) {
    List<org.lean.presentation.theme.LeanTheme> themes = new ArrayList<>();
    java.util.Set<String> names = new java.util.HashSet<>();
    if (source.getThemes() != null) {
      for (org.lean.presentation.theme.LeanTheme t : source.getThemes()) {
        if (t != null) {
          themes.add(t);
          if (t.getName() != null) {
            names.add(t.getName());
          }
        }
      }
    }
    String defaultThemeName = source.getDefaultThemeName();
    if (defaultThemeName != null
        && !defaultThemeName.isBlank()
        && !names.contains(defaultThemeName)) {
      try {
        org.lean.presentation.theme.LeanTheme loaded =
            metadataProvider
                .getSerializer(org.lean.presentation.theme.LeanTheme.class)
                .load(defaultThemeName);
        if (loaded != null) {
          themes.add(loaded);
          names.add(defaultThemeName);
        }
      } catch (Exception ignored) {
        // fall through to built-in default
      }
    }
    if (themes.isEmpty()) {
      themes.add(org.lean.presentation.theme.LeanTheme.getDefault());
    }
    return themes;
  }

  /**
   * Load a component by name for the property form (name-based, no canvas hit-test required).
   */
  @GET
  @Path("/{name}/components/{componentName}/")
  @Produces(MediaType.APPLICATION_JSON)
  public Response getComponentByName(
      @PathParam("name") String name, @PathParam("componentName") String componentName) {
    try {
      LeanPresentation presentation = leanRest.loadPresentation(name);
      if (presentation == null) {
        return getServerError("Presentation not found: " + name, false);
      }
      FoundComponent found = findComponentAnywhere(presentation, componentName);
      if (found == null) {
        return getServerError(
            "Component '" + componentName + "' not found in presentation '" + name + "'", false);
      }
      JsonMetadataParser<LeanComponent> parser =
          new JsonMetadataParser<>(LeanComponent.class, leanRest.getMetadataProvider());
      JSONObject componentJson = parser.getJsonObject(found.component);
      JSONObject wrapper = new JSONObject();
      wrapper.put("logicalPageNumber", found.logicalPageNumber);
      wrapper.put("pageRole", found.pageRole);
      wrapper.put("component", componentJson);

      // Prefer layout errors already captured on the cached presentation render
      attachCachedLayoutError(wrapper, name, found.component.getName());

      return Response.ok(wrapper.toJSONString())
          .type(MediaType.APPLICATION_JSON_TYPE)
          .encoding("UTF-8")
          .build();
    } catch (Exception e) {
      return getServerError(
          "Error loading component '" + componentName + "' from presentation '" + name + "'", e);
    }
  }

  /**
   * Layout feedback for the property panel: attachment summaries, resolved geometry, and pages
   * where the component appears after full presentation layout.
   */
  @GET
  @Path("/{name}/components/{componentName}/layout-info")
  @Produces(MediaType.APPLICATION_JSON)
  public Response componentLayoutInfo(
      @PathParam("name") String name, @PathParam("componentName") String componentName) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("componentName", componentName);
    out.put("presentationName", name);
    List<String> warnings = new ArrayList<>();
    try {
      LeanPresentation source = leanRest.loadPresentation(name);
      if (source == null) {
        out.put("ok", false);
        out.put("warnings", List.of("Presentation not found: " + name));
        return Response.ok(MAPPER.writeValueAsString(out))
            .type("application/json; charset=UTF-8")
            .build();
      }
      FoundComponent found = findComponentAnywhere(source, componentName);
      if (found == null || found.component == null) {
        out.put("ok", false);
        out.put("warnings", List.of("Component not found: " + componentName));
        return Response.ok(MAPPER.writeValueAsString(out))
            .type("application/json; charset=UTF-8")
            .build();
      }
      LeanComponent component = found.component;
      LeanLayout layout = component.getLayout();
      Map<String, Object> attachments = new LinkedHashMap<>();
      for (String side : new String[] {"left", "right", "top", "bottom"}) {
        LeanAttachment att =
            layout == null
                ? null
                : switch (side) {
                  case "left" -> layout.getLeft();
                  case "right" -> layout.getRight();
                  case "top" -> layout.getTop();
                  case "bottom" -> layout.getBottom();
                  default -> null;
                };
        if (att == null) {
          continue;
        }
        Map<String, Object> a = new LinkedHashMap<>();
        a.put("enabled", true);
        String rel = att.getComponentName();
        a.put("relativeTo", rel != null && !rel.isBlank() ? rel : null);
        a.put("alignment", att.getAlignment() != null ? att.getAlignment().name() : null);
        a.put("offset", att.getOffset());
        a.put("percentage", att.getPercentage());
        a.put("summary", summarizeAttachment(side, att));
        attachments.put(side, a);
        if (rel != null && !rel.isBlank() && rel.equals(component.getName())) {
          warnings.add(capitalize(side) + " attachment references this component itself.");
        }
      }
      out.put("attachments", attachments);

      // Prefer live rendering if present; otherwise layout once
      IRendering existing = leanRest.findRendering(name, Collections.emptyList());
      org.lean.presentation.layout.LeanLayoutResults layoutResults =
          existing != null ? existing.getLayoutResults() : null;
      if (layoutResults == null) {
        var metadataProvider = leanRest.getMetadataProvider();
        org.apache.hop.core.logging.LoggingObject loggingObject =
            new org.apache.hop.core.logging.LoggingObject("layoutInfo");
        org.lean.render.context.PresentationRenderContext renderContext =
            new org.lean.render.context.PresentationRenderContext(source, metadataProvider);
        layoutResults =
            source.doLayout(loggingObject, renderContext, metadataProvider, Collections.emptyList());
      }

      List<Integer> pages = new ArrayList<>();
      org.lean.core.LeanGeometry firstGeo = null;
      if (layoutResults != null && layoutResults.getRenderPages() != null) {
        List<LeanRenderPage> rps = layoutResults.getRenderPages();
        out.put("pageCount", rps.size());
        for (int i = 0; i < rps.size(); i++) {
          LeanRenderPage rp = rps.get(i);
          if (rp.getLayoutResults() == null) {
            continue;
          }
          for (var lr : rp.getLayoutResults()) {
            if (lr.getComponent() != null
                && componentName.equals(lr.getComponent().getName())
                && lr.getGeometry() != null) {
              pages.add(i);
              if (firstGeo == null) {
                firstGeo = lr.getGeometry();
              }
              break;
            }
          }
        }
      }
      out.put("pages", pages);
      if (firstGeo != null) {
        Map<String, Object> geo = new LinkedHashMap<>();
        geo.put("x", firstGeo.getX());
        geo.put("y", firstGeo.getY());
        geo.put("width", firstGeo.getWidth());
        geo.put("height", firstGeo.getHeight());
        out.put("resolved", geo);
        if (firstGeo.getWidth() <= 0 || firstGeo.getHeight() <= 0) {
          warnings.add(
              "Resolved size is "
                  + firstGeo.getWidth()
                  + "x"
                  + firstGeo.getHeight()
                  + " px (zero width/height usually means conflicting left/right or top/bottom).");
        }
      } else {
        warnings.add("Component has no layout result on any page (check relative references).");
      }
      int pageCount = out.get("pageCount") instanceof Integer ? (Integer) out.get("pageCount") : 0;
      if (pages.size() == 1 && pageCount > 1 && pages.get(0) == pageCount - 1) {
        warnings.add(
            "Component is only on the last page ("
                + pageCount
                + "). A multi-page table may have pushed it there — "
                + "relative layout should place non-flowing siblings on page 1.");
      } else if (!pages.isEmpty() && pages.get(0) > 0) {
        warnings.add(
            "Component first appears on page "
                + (pages.get(0) + 1)
                + " of "
                + pageCount
                + " (not page 1).");
      }
      // Relative targets that span many pages
      for (Object attObj : attachments.values()) {
        @SuppressWarnings("unchecked")
        Map<String, Object> a = (Map<String, Object>) attObj;
        Object rel = a.get("relativeTo");
        if (rel instanceof String relName && !relName.isBlank() && layoutResults != null) {
          int targetPages = 0;
          for (LeanRenderPage rp : layoutResults.getRenderPages()) {
            if (rp.getLayoutResults() == null) {
              continue;
            }
            for (var lr : rp.getLayoutResults()) {
              if (lr.getComponent() != null && relName.equals(lr.getComponent().getName())) {
                targetPages++;
                break;
              }
            }
          }
          if (targetPages > 1) {
            warnings.add(
                "Reference \""
                    + relName
                    + "\" spans "
                    + targetPages
                    + " pages. Relative layout uses the first part's geometry.");
          }
        }
      }
      out.put("warnings", warnings);
      out.put("ok", true);
      return Response.ok(MAPPER.writeValueAsString(out))
          .type("application/json; charset=UTF-8")
          .build();
    } catch (Exception e) {
      warnings.add("layout-info failed: " + e.getMessage());
      out.put("ok", false);
      out.put("warnings", warnings);
      try {
        return Response.ok(MAPPER.writeValueAsString(out))
            .type("application/json; charset=UTF-8")
            .build();
      } catch (Exception e2) {
        return getServerError("layout-info failed", e);
      }
    }
  }

  private static String capitalize(String s) {
    if (s == null || s.isEmpty()) {
      return s;
    }
    return Character.toUpperCase(s.charAt(0)) + s.substring(1);
  }

  private static String summarizeAttachment(String side, LeanAttachment att) {
    if (att == null) {
      return capitalize(side) + ": (not set)";
    }
    String edge = att.getAlignment() != null ? att.getAlignment().name().toLowerCase() : "default";
    String target =
        att.getComponentName() != null && !att.getComponentName().isBlank()
            ? "\"" + att.getComponentName() + "\""
            : "page";
    StringBuilder sb = new StringBuilder();
    sb.append(capitalize(side)).append(": ").append(edge).append(" edge of ").append(target);
    if (att.getOffset() != 0) {
      sb.append(att.getOffset() > 0 ? " + " : " - ").append(Math.abs(att.getOffset())).append(" px");
    }
    if (att.getPercentage() != 0) {
      sb.append(" + ").append(att.getPercentage()).append("%");
    }
    return sb.toString();
  }

  /**
   * Diagnose layout/render for a single component: re-runs isolated layout and returns any error
   * with full cause chain (for the property-panel error box). Always 200 with JSON.
   */
  @GET
  @Path("/{name}/components/{componentName}/diagnostics")
  @Produces(MediaType.APPLICATION_JSON)
  public Response diagnoseComponent(
      @PathParam("name") String name, @PathParam("componentName") String componentName) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("componentName", componentName);
    out.put("presentationName", name);
    try {
      LeanPresentation source = leanRest.loadPresentation(name);
      if (source == null) {
        out.put("ok", false);
        out.put("summary", "Presentation not found: " + name);
        out.put("detail", out.get("summary"));
        return Response.ok(MAPPER.writeValueAsString(out))
            .type(MediaType.APPLICATION_JSON_TYPE)
            .encoding("UTF-8")
            .build();
      }
      FoundComponent found = findComponentAnywhere(source, componentName);
      if (found == null) {
        out.put("ok", false);
        out.put("summary", "Component not found: " + componentName);
        out.put("detail", out.get("summary"));
        return Response.ok(MAPPER.writeValueAsString(out))
            .type(MediaType.APPLICATION_JSON_TYPE)
            .encoding("UTF-8")
            .build();
      }

      // 1) Cached render of the full presentation (same state as the canvas)
      String cachedSummary = null;
      String cachedDetail = null;
      IRendering existing = leanRest.findRendering(name, Collections.emptyList());
      if (existing != null && existing.getLayoutResults() != null) {
        for (LeanRenderPage rp : existing.getLayoutResults().getRenderPages()) {
          if (rp == null) {
            continue;
          }
          String s =
              lookupPageError(
                  rp, found.component.getName(), componentName, false);
          String d =
              lookupPageError(
                  rp, found.component.getName(), componentName, true);
          if (s != null) {
            cachedSummary = s;
            cachedDetail = d != null ? d : s;
            break;
          }
        }
      }

      // 2) Isolated layout (same path as component preview) for a fresh diagnosis
      var metadataProvider = leanRest.getMetadataProvider();
      List<org.lean.presentation.connector.LeanConnector> connectors =
          collectConnectorsForPreview(source, found.component, metadataProvider);
      List<org.lean.presentation.theme.LeanTheme> themes =
          collectThemesForPreview(source, metadataProvider);

      String isolatedSummary = null;
      String isolatedDetail = null;
      try {
        // Reuse getSvgXml path: layout+render; inspect placeholder errors via a small layout run
        org.apache.hop.core.logging.LoggingObject loggingObject =
            new org.apache.hop.core.logging.LoggingObject("componentDiagnostics");
        LeanPresentation mini = new LeanPresentation();
        mini.setName("diagnostics:" + componentName);
        mini.setHeader(null);
        mini.setFooter(null);
        mini.setPages(new ArrayList<>());
        mini.setConnectors(new ArrayList<>());
        mini.setThemes(new ArrayList<>());
        for (org.lean.presentation.connector.LeanConnector c : connectors) {
          if (c != null) {
            mini.getConnectors().add(new org.lean.presentation.connector.LeanConnector(c));
          }
        }
        if (themes != null) {
          for (org.lean.presentation.theme.LeanTheme t : themes) {
            if (t != null) {
              mini.getThemes().add(t);
            }
          }
        }
        if (mini.getThemes().isEmpty()) {
          mini.getThemes().add(org.lean.presentation.theme.LeanTheme.getDefault());
        }
        mini.setDefaultThemeName(
            source.getDefaultThemeName() != null
                ? source.getDefaultThemeName()
                : mini.getThemes().get(0).getName());
        LeanPage page = new LeanPage(400, 300, 0, 0, 0, 0);
        page.setHeader(false);
        page.setFooter(false);
        LeanComponent previewComponent = new LeanComponent(found.component);
        previewComponent.setLayout(LeanLayout.fullPage());
        page.getComponents().add(previewComponent);
        mini.getPages().add(page);

        org.lean.render.context.PresentationRenderContext renderContext =
            new org.lean.render.context.PresentationRenderContext(mini, metadataProvider);
        renderContext.setThemes(new ArrayList<>(mini.getThemes()));
        org.lean.presentation.layout.LeanLayoutResults results =
            mini.doLayout(
                loggingObject, renderContext, metadataProvider, Collections.emptyList());
        mini.render(results, metadataProvider, renderContext);

        if (results.getRenderPages() != null) {
          for (LeanRenderPage rp : results.getRenderPages()) {
            String s = lookupPageError(rp, previewComponent.getName(), componentName, false);
            String d = lookupPageError(rp, previewComponent.getName(), componentName, true);
            if (s != null) {
              isolatedSummary = s;
              isolatedDetail = d != null ? d : s;
              break;
            }
          }
        }
      } catch (Exception isoEx) {
        isolatedSummary = LeanPresentation.summarizeException(isoEx);
        isolatedDetail = LeanPresentation.formatExceptionDetail(isoEx);
      }

      String summary = isolatedSummary != null ? isolatedSummary : cachedSummary;
      String detail = isolatedDetail != null ? isolatedDetail : cachedDetail;
      boolean ok = summary == null || summary.isBlank();
      out.put("ok", ok);
      if (!ok) {
        out.put("summary", summary);
        out.put("detail", detail != null ? detail : summary);
      } else {
        out.put("summary", null);
        out.put("detail", null);
      }
      // Source connector for quick context
      if (found.component.getComponent() != null) {
        out.put("sourceConnectorName", found.component.getComponent().getSourceConnectorName());
      }
      return Response.ok(MAPPER.writeValueAsString(out))
          .type(MediaType.APPLICATION_JSON_TYPE)
          .encoding("UTF-8")
          .build();
    } catch (Exception e) {
      try {
        out.put("ok", false);
        out.put("summary", LeanPresentation.summarizeException(e));
        out.put("detail", LeanPresentation.formatExceptionDetail(e));
        return Response.ok(MAPPER.writeValueAsString(out))
            .type(MediaType.APPLICATION_JSON_TYPE)
            .encoding("UTF-8")
            .build();
      } catch (Exception encodeEx) {
        return getServerError("Error diagnosing component '" + componentName + "'", e);
      }
    }
  }

  private void attachCachedLayoutError(JSONObject wrapper, String presentationName, String componentName) {
    try {
      IRendering existing = leanRest.findRendering(presentationName, Collections.emptyList());
      if (existing == null || existing.getLayoutResults() == null) {
        return;
      }
      for (LeanRenderPage rp : existing.getLayoutResults().getRenderPages()) {
        String s = lookupPageError(rp, componentName, componentName, false);
        String d = lookupPageError(rp, componentName, componentName, true);
        if (s != null) {
          wrapper.put("layoutError", s);
          wrapper.put("layoutErrorDetail", d != null ? d : s);
          return;
        }
      }
    } catch (Exception ignored) {
      // diagnostics is best-effort
    }
  }

  private static String lookupPageError(
      LeanRenderPage page, String metadataName, String drawnName, boolean detail) {
    if (page == null) {
      return null;
    }
    Map<String, String> map =
        detail ? page.getComponentLayoutErrorDetails() : page.getComponentLayoutErrors();
    if (map != null) {
      if (metadataName != null && map.containsKey(metadataName)) {
        return map.get(metadataName);
      }
      if (drawnName != null && map.containsKey(drawnName)) {
        return map.get(drawnName);
      }
    }
    if (page.getLayoutResults() != null) {
      for (org.lean.presentation.LeanComponentLayoutResult lr : page.getLayoutResults()) {
        if (lr == null || lr.getComponent() == null || lr.getDataMap() == null) {
          continue;
        }
        String n = lr.getComponent().getName();
        if (n == null) {
          continue;
        }
        if (!n.equals(metadataName) && !n.equals(drawnName)) {
          continue;
        }
        Object key =
            detail
                ? lr.getDataMap().get(LeanPresentation.DATA_LAYOUT_ERROR_DETAIL)
                : lr.getDataMap().get(LeanPresentation.DATA_LAYOUT_ERROR);
        if (key == null && detail) {
          key = lr.getDataMap().get(LeanPresentation.DATA_LAYOUT_ERROR);
        }
        if (key != null) {
          return String.valueOf(key);
        }
      }
    }
    return null;
  }

  /**
   * Delete a component from a presentation by name. Removes from the page (or header/footer) where
   * it is found, saves metadata, and returns the presentation name.
   */
  @DELETE
  @Path("/{name}/components/{componentName}/")
  @Produces(MediaType.TEXT_PLAIN)
  public Response deleteComponent(
      @PathParam("name") String name, @PathParam("componentName") String componentName) {
    try {
      IHopMetadataSerializer<LeanPresentation> serializer =
          leanRest.getMetadataProvider().getSerializer(LeanPresentation.class);
      LeanPresentation presentation = serializer.load(name);
      if (presentation == null) {
        throw new LeanException("Presentation not found: " + name);
      }
      FoundComponent found = findComponentAnywhere(presentation, componentName);
      if (found == null) {
        throw new LeanException(
            "Component '" + componentName + "' not found in presentation '" + name + "'");
      }
      boolean removed = found.page.getComponents().remove(found.component);
      if (!removed) {
        // try by name match if instance identity differs
        found.page
            .getComponents()
            .removeIf(c -> componentName.equalsIgnoreCase(c.getName()));
      }
      // Drop layout references to the deleted component from siblings
      for (LeanComponent sibling : new ArrayList<>(found.page.getComponents())) {
        if (sibling.getLayout() != null) {
          sibling.getLayout().replaceReferences(componentName, null);
        }
      }
      serializer.save(presentation);
      leanRest
          .getLog()
          .logBasic(
              "delete component: removed '"
                  + componentName
                  + "' from presentation '"
                  + name
                  + "'");
      return Response.ok().entity(name).type(MediaType.TEXT_PLAIN).build();
    } catch (Exception e) {
      return getServerError(
          "Error deleting component '" + componentName + "' from presentation '" + name + "'", e);
    }
  }

  private Map<String, Object> toComponentSummary(LeanComponent component) {
    Map<String, Object> row = new LinkedHashMap<>();
    row.put("name", component.getName());
    String pluginId = null;
    if (component.getComponent() != null) {
      pluginId = component.getComponent().getPluginId();
    }
    row.put("pluginId", pluginId != null ? pluginId : "");
    row.put("pluginName", resolvePluginName(pluginId));
    return row;
  }

  private String resolvePluginName(String pluginId) {
    if (pluginId == null || pluginId.isBlank()) {
      return "";
    }
    try {
      IPlugin plugin =
          PluginRegistry.getInstance()
              .findPluginWithId(LeanComponentPluginType.class, pluginId);
      if (plugin != null && plugin.getName() != null) {
        return plugin.getName();
      }
    } catch (Exception ignored) {
      // fall through
    }
    return pluginId;
  }

  private static final class FoundComponent {
    final LeanPage page;
    final LeanComponent component;
    final int logicalPageNumber;
    final String pageRole;

    FoundComponent(LeanPage page, LeanComponent component, int logicalPageNumber, String pageRole) {
      this.page = page;
      this.component = component;
      this.logicalPageNumber = logicalPageNumber;
      this.pageRole = pageRole;
    }
  }

  private FoundComponent findComponentAnywhere(LeanPresentation presentation, String componentName)
      throws LeanException {
    ComponentLookup.Found found = ComponentLookup.find(presentation, null, componentName);
    if (found == null) {
      return null;
    }
    return new FoundComponent(
        found.page, found.component, found.logicalPageNumber, found.pageRole);
  }
}
