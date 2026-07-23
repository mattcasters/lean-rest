package org.lean.rest.resources;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.ArrayList;
import java.util.List;
import org.apache.hop.core.Const;
import org.apache.hop.core.row.IRowMeta;
import org.apache.hop.metadata.api.IHopMetadataProvider;
import org.apache.hop.metadata.api.IHopMetadataSerializer;
import org.apache.hop.metadata.serializer.json.JsonMetadataParser;
import org.json.simple.JSONObject;
import org.lean.core.draw.DrawnItem;
import org.lean.core.exception.LeanException;
import org.lean.presentation.LeanPresentation;
import org.lean.presentation.component.LeanComponent;
import org.lean.presentation.connector.LeanConnector;
import org.lean.presentation.datacontext.IDataContext;
import org.lean.presentation.datacontext.PresentationDataContext;
import org.lean.presentation.interaction.LeanInteraction;
import org.lean.presentation.layout.LeanRenderPage;
import org.lean.presentation.page.LeanPage;
import org.lean.rest.interaction.InteractionLookupResult;
import org.lean.rest.render.IRendering;
import org.lean.rest.render.RenderFactory;
import org.lean.rest.resources.requests.ActionsRequest;
import org.lean.rest.resources.requests.ConnectorDescriptionRequest;
import org.lean.rest.resources.requests.RenderPresentationRequest;
import org.lean.rest.resources.responses.RowMetaResponse;

@Path("render/")
public class RenderResource extends BaseResource {
  /**
   * Conveniently renders a main presentation
   *
   * @return
   */
  @GET
  @Path("/main/")
  public Response getMainPage() {
    try {
      return RenderFactory.getMainPage(this);
    } catch (Exception e) {
      String errorMessage = "Unexpected error retrieving the main page";
      return getServerError(errorMessage, e);
    }
  }

  /**
   * Render returns a unique ID to a rendering. The rendering contains the layout results, the SVG,
   * the drawn areas and everything else that is needed to visualize a presentation for the
   * requested render type.
   *
   * @param request The rendering details like parameters, and so on.
   * @return The response in the form of the UUID of the rendering.
   */
  @POST
  @Path("/presentation")
  @Consumes(MediaType.APPLICATION_JSON)
  @Produces(MediaType.TEXT_PLAIN)
  public Response renderPresentation(RenderPresentationRequest request) {
    try {
      // Check the cache first. Render if needed.
      //
      IRendering rendering =
          leanRest.findRendering(request.getPresentationName(), request.getParameters());
      if (rendering != null && request.isReload()) {
        leanRest.removeRendering(rendering);
        rendering = null;
      }
      if (rendering == null) {
        LeanPresentation presentation = leanRest.loadPresentation(request.getPresentationName());
        rendering =
            RenderFactory.renderPresentation(
                leanRest.getLoggingObject(),
                leanRest.getMetadataProvider(),
                presentation,
                request.getParameters());

        leanRest.storeRendering(rendering);
      }

      return Response.ok().entity(rendering.getId()).type(MediaType.TEXT_PLAIN).build();
    } catch (Exception e) {
      String errorMessage =
          "Unexpected error rendering presentation '" + request.getPresentationName() + "'";
      return getServerError(errorMessage, e);
    }
  }

  /**
   * Get the amount of rendered pages.
   *
   * @param renderId The rendering ID
   * @return
   */
  @GET
  @Path("/info/pages/{renderId}")
  public Response getPageCount(@PathParam("renderId") String renderId) {
    try {
      IRendering rendering = lookupRendering(renderId);
      int pageCount = rendering.getLayoutResults().getRenderPages().size();
      return Response.ok().entity(pageCount).build();
    } catch (Exception e) {
      String errorMessage =
          "Unexpected error retrieving the number of pages for render ID " + renderId;
      return getServerError(errorMessage, e);
    }
  }

  /**
   * Expose a page of a rendering in a certain way
   *
   * @param renderId The rendering ID
   * @param renderType The type of rendering to do: SVG, HTML, PDF, ...
   * @param pageNumber The page number
   * @return
   */
  @GET
  @Path("/page/{renderId}/{renderType}/{pageNumber}/")
  public Response getRenderPageSvg(
      @PathParam("renderId") String renderId,
      @PathParam("renderType") String renderType,
      @PathParam("pageNumber") int pageNumber) {

    try {
      IRendering rendering = lookupRendering(renderId);
      LeanRenderPage page = lookupRenderPage(rendering, pageNumber);
      return RenderFactory.renderPage(rendering, page, renderType);
    } catch (Exception e) {
      String errorMessage =
          "Unexpected error retrieving page " + pageNumber + " for render ID " + renderId;
      return getServerError(errorMessage, e);
    }
  }

  private LeanRenderPage lookupRenderPage(IRendering rendering, int pageNumber)
      throws LeanException {
    List<LeanRenderPage> renderPages = rendering.getLayoutResults().getRenderPages();
    if (pageNumber < 0 || pageNumber >= renderPages.size()) {
      throw new LeanException(
          "Invalid page number requested: "
              + pageNumber
              + ".  Available pages: "
              + renderPages.size());
    }
    LeanRenderPage page = renderPages.get(pageNumber);
    return page;
  }

  @POST
  @Consumes(MediaType.APPLICATION_JSON)
  @Produces(MediaType.APPLICATION_JSON)
  @Path("/lookupActions/")
  public Response lookupActions(ActionsRequest request) {
    try {
      IRendering rendering = lookupRendering(request.getRenderId());
      LeanRenderPage page = lookupRenderPage(rendering, request.getPageNumber());
      InteractionLookupResult result = new InteractionLookupResult();
      LeanPresentation presentation = rendering.getPresentation();

      // Top-most hit first, then other items under the cursor (stacked ComponentItems)
      List<DrawnItem> hits = page.lookupDrawnItems(request.getX(), request.getY());
      // Also try each component envelope under the point so whole-component interactions
      // match even when only a child item was registered as the top hit.
      java.util.LinkedHashSet<String> componentNames = new java.util.LinkedHashSet<>();
      for (DrawnItem hit : hits) {
        if (hit.getComponentName() != null) {
          componentNames.add(hit.getComponentName());
        }
      }
      List<DrawnItem> candidates = new ArrayList<>(hits);
      for (String name : componentNames) {
        DrawnItem envelope = page.lookupComponentDrawnItem(name);
        if (envelope != null && !candidates.contains(envelope)) {
          candidates.add(envelope);
        }
      }

      for (DrawnItem drawnItem : candidates) {
        LeanInteraction interaction = presentation.findInteraction(null, drawnItem);
        if (interaction == null) {
          continue;
        }
        // Outline: for whole-component interactions use the component envelope geometry
        DrawnItem outlineItem = drawnItem;
        if (interaction.getLocation() != null
            && DrawnItem.DrawnItemType.Component.name()
                .equals(interaction.getLocation().getItemType())
            && drawnItem.getComponentName() != null) {
          DrawnItem envelope =
              page.lookupComponentDrawnItem(drawnItem.getComponentName());
          if (envelope != null) {
            outlineItem = envelope;
          }
        }
        result.setFound(true);
        result.setDrawnItem(outlineItem);
        result.setActions(interaction.getActions());
        result.setMethod(interaction.getMethod());
        break;
      }

      return Response.ok()
          .entity(result.toJsonString())
          .type("application/json; charset=UTF-8")
          .build();
    } catch (Exception e) {
      // Don't log on the server, it can be tedious to see all the failed lookups.
      //
      String errorMessage =
          "Unexpected error retrieving the possible actions for request: " + request;
      return Response.serverError()
          .status(Response.Status.INTERNAL_SERVER_ERROR)
          .entity(errorMessage + "\n" + Const.getSimpleStackTrace(e))
          .type(MediaType.TEXT_PLAIN)
          .build();
    }
  }

  @POST
  @Consumes(MediaType.APPLICATION_JSON)
  @Path("/getComponent/")
  public Response getComponent(ActionsRequest request) {
    try {
      IRendering rendering = lookupRendering(request.getRenderId());
      LeanRenderPage page = lookupRenderPage(rendering, request.getPageNumber());
      // Prefer the top-most Component drawn item at this point (last in drawn order).
      // lookupComponentName returns all hits from bottom→top; take the last name.
      String componentName = null;
      if (page.getDrawnItems() != null) {
        for (int i = page.getDrawnItems().size() - 1; i >= 0; i--) {
          DrawnItem item = page.getDrawnItems().get(i);
          if (item.getType() != DrawnItem.DrawnItemType.Component) {
            continue;
          }
          if (item.getGeometry() != null
              && item.getGeometry().contains(request.getX(), request.getY())) {
            componentName = item.getComponentName();
            break;
          }
        }
      }
      if (componentName == null) {
        List<String> names = page.lookupComponentName(request.getX(), request.getY());
        if (!names.isEmpty()) {
          componentName = names.get(names.size() - 1);
        }
      }
      if (componentName == null) {
        // Empty click (no component under the cursor) — not an error
        return Response.ok("{\"empty\":true}")
            .type(MediaType.APPLICATION_JSON)
            .encoding("UTF-8")
            .build();
      }
      LeanPresentation presentation = rendering.getPresentation();

      // Drawn names may be synthetic (Group-group#1:Composite-child(Label)); resolve to template
      ComponentLookup.Found found =
          ComponentLookup.find(presentation, page.getPage(), componentName);
      if (found == null) {
        // Drawn item name could not be resolved — treat as empty click for the editor
        return Response.ok("{\"empty\":true}")
            .type(MediaType.APPLICATION_JSON)
            .encoding("UTF-8")
            .build();
      }

      // Serialize component to Hop metadata JSON...
      //
      JsonMetadataParser<LeanComponent> parser =
          new JsonMetadataParser<>(LeanComponent.class, leanRest.getMetadataProvider());
      JSONObject componentJson = parser.getJsonObject(found.component);

      JSONObject wrapper = new JSONObject();
      wrapper.put("logicalPageNumber", found.logicalPageNumber);
      wrapper.put("pageRole", found.pageRole);
      wrapper.put("component", componentJson);
      // Help the client label nested edits
      wrapper.put("drawnName", componentName);
      wrapper.put("metadataName", found.component.getName());
      if (found.parentComponent != null) {
        wrapper.put("nested", true);
        wrapper.put("parentName", found.parentComponent.getName());
      } else {
        wrapper.put("nested", false);
      }

      // Attach layout/render error from the current render page when present
      String metaName = found.component.getName();
      String layoutError = lookupLayoutError(page, metaName, componentName, false);
      String layoutErrorDetail = lookupLayoutError(page, metaName, componentName, true);
      if (layoutError != null) {
        wrapper.put("layoutError", layoutError);
      }
      if (layoutErrorDetail != null) {
        wrapper.put("layoutErrorDetail", layoutErrorDetail);
      }

      return Response.ok()
          .entity(wrapper.toJSONString())
          .encoding("UTF-8")
          .type(MediaType.APPLICATION_JSON)
          .build();
    } catch (Exception e) {
      // Don't log on the server, it can be tedious to see all the failed lookups.
      //
      String errorMessage =
          "Unexpected error retrieving the JSON of a component for request: " + request;
      return Response.serverError()
          .status(Response.Status.INTERNAL_SERVER_ERROR)
          .entity(errorMessage + "\n" + Const.getSimpleStackTrace(e))
          .type(MediaType.TEXT_PLAIN)
          .build();
    }
  }

  /**
   * Look up a short or detailed layout error for a component on a render page (by metadata or drawn
   * name).
   */
  private static String lookupLayoutError(
      LeanRenderPage page, String metadataName, String drawnName, boolean detail) {
    if (page == null) {
      return null;
    }
    java.util.Map<String, String> map =
        detail ? page.getComponentLayoutErrorDetails() : page.getComponentLayoutErrors();
    if (map == null || map.isEmpty()) {
      // Fall back to layout-result data maps (body components)
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
    if (metadataName != null && map.containsKey(metadataName)) {
      return map.get(metadataName);
    }
    if (drawnName != null && map.containsKey(drawnName)) {
      return map.get(drawnName);
    }
    return null;
  }

  /**
   * Locate a component by name: prefer the render page's body page, then other body pages, then
   * presentation header/footer (including nested group/composite templates).
   */
  private static ComponentLookup.Found findComponentOnPresentation(
      LeanPresentation presentation, LeanPage renderLeanPage, String componentName)
      throws LeanException {
    return ComponentLookup.find(presentation, renderLeanPage, componentName);
  }

  /**
   * Get the component names for a presentation.
   *
   * @param renderId The rendering ID
   * @param pageNumber The rendered page number
   * @return
   */
  @GET
  @Path("/info/components/{renderId}/{pageNumber}")
  public Response getPageComponentNames(
      @PathParam("renderId") String renderId, @PathParam("pageNumber") int pageNumber) {
    try {
      IRendering rendering = lookupRendering(renderId);
      LeanRenderPage renderPage = lookupRenderPage(rendering, pageNumber);
      LeanPage leanPage = renderPage.getPage();
      LeanPresentation presentation = rendering.getPresentation();

      List<String> names = new ArrayList<>();
      if (leanPage != null && leanPage.getComponents() != null) {
        for (LeanComponent component : leanPage.getComponents()) {
          names.add(component.getName());
        }
      }
      // Header/footer components are drawn on every render page but stored on the presentation
      if (presentation != null) {
        if (presentation.getHeader() != null && presentation.getHeader().getComponents() != null) {
          for (LeanComponent component : presentation.getHeader().getComponents()) {
            if (component.getName() != null && !names.contains(component.getName())) {
              names.add(component.getName());
            }
          }
        }
        if (presentation.getFooter() != null && presentation.getFooter().getComponents() != null) {
          for (LeanComponent component : presentation.getFooter().getComponents()) {
            if (component.getName() != null && !names.contains(component.getName())) {
              names.add(component.getName());
            }
          }
        }
      }
      String json = new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(names);
      return Response.ok(json).type(MediaType.APPLICATION_JSON_TYPE).encoding("UTF-8").build();
    } catch (Exception e) {
      String errorMessage =
          "Unexpected error getting the components for presentation rendering ID " + renderId;
      return getServerError(errorMessage, e);
    }
  }

  /**
   * Component-level drawn geometries for the WYSIWYG editor overlay (hover / selection borders).
   *
   * <p>Built from {@link DrawnItem}s on the requested <b>render page</b> (multi-page tables have a
   * different part geometry per page). Prefer {@link DrawnItem.DrawnItemType#Component} bounds; if
   * those are missing or zero-sized, fall back to the union of {@code ComponentItem} ink (cells,
   * labels, series). Also resolves {@code pageRole} (page / header / footer) for edit routing.
   */
  @GET
  @Path("/info/component-geometries/{renderId}/{pageNumber}")
  @Produces(MediaType.APPLICATION_JSON)
  public Response getComponentGeometries(
      @PathParam("renderId") String renderId, @PathParam("pageNumber") int pageNumber) {
    try {
      IRendering rendering = lookupRendering(renderId);
      LeanRenderPage renderPage = lookupRenderPage(rendering, pageNumber);
      LeanPresentation presentation = rendering.getPresentation();

      // Accumulate per-component component bounds and component-item ink on this render page
      java.util.Map<String, org.lean.core.LeanGeometry> componentBounds =
          new java.util.LinkedHashMap<>();
      java.util.Map<String, org.lean.core.LeanGeometry> itemUnion = new java.util.LinkedHashMap<>();
      java.util.Map<String, String> pluginByName = new java.util.LinkedHashMap<>();

      if (renderPage.getDrawnItems() != null) {
        for (DrawnItem item : renderPage.getDrawnItems()) {
          if (item.getGeometry() == null || item.getComponentName() == null) {
            continue;
          }
          String name = item.getComponentName();
          if (item.getComponentPluginId() != null) {
            pluginByName.putIfAbsent(name, item.getComponentPluginId());
          }
          if (item.getType() == DrawnItem.DrawnItemType.Component) {
            // Last Component item for this name on this page (should be one after layout fix)
            componentBounds.put(name, item.getGeometry());
          } else if (item.getType() == DrawnItem.DrawnItemType.ComponentItem) {
            itemUnion.put(name, unionGeometry(itemUnion.get(name), item.getGeometry()));
          }
        }
      }

      List<java.util.Map<String, Object>> rows = new ArrayList<>();
      java.util.LinkedHashSet<String> names = new java.util.LinkedHashSet<>();
      names.addAll(componentBounds.keySet());
      names.addAll(itemUnion.keySet());

      for (String name : names) {
        org.lean.core.LeanGeometry geo = componentBounds.get(name);
        if (geo == null || geo.getWidth() <= 0 || geo.getHeight() <= 0) {
          org.lean.core.LeanGeometry fromItems = itemUnion.get(name);
          if (fromItems != null
              && fromItems.getWidth() > 0
              && fromItems.getHeight() > 0) {
            geo = fromItems;
          }
        }
        if (geo == null) {
          continue;
        }
        // Skip zero-area highlights (unusable for hover)
        if (geo.getWidth() <= 0 && geo.getHeight() <= 0) {
          continue;
        }

        java.util.Map<String, Object> row = new java.util.LinkedHashMap<>();
        row.put("componentName", name);
        row.put("pluginId", pluginByName.getOrDefault(name, ""));
        java.util.Map<String, Object> geoMap = new java.util.LinkedHashMap<>();
        geoMap.put("x", geo.getX());
        geoMap.put("y", geo.getY());
        geoMap.put("width", Math.max(0, geo.getWidth()));
        geoMap.put("height", Math.max(0, geo.getHeight()));
        row.put("geometry", geoMap);

        ComponentLookup.Found found =
            findComponentOnPresentation(presentation, renderPage.getPage(), name);
        if (found != null) {
          row.put("pageRole", found.pageRole);
          row.put("logicalPageNumber", found.logicalPageNumber);
          row.put("metadataName", found.component.getName());
        } else {
          row.put("pageRole", "page");
          row.put("logicalPageNumber", -1);
        }

        // Surface layout/render failures for the property panel / hover diagnostics
        String errorName =
            found != null && found.component != null && found.component.getName() != null
                ? found.component.getName()
                : name;
        String layoutError = lookupLayoutError(renderPage, errorName, name, false);
        String layoutErrorDetail = lookupLayoutError(renderPage, errorName, name, true);
        if (layoutError != null) {
          row.put("layoutError", layoutError);
        }
        if (layoutErrorDetail != null) {
          row.put("layoutErrorDetail", layoutErrorDetail);
        }
        rows.add(row);
      }

      String json = new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(rows);
      return Response.ok(json).type(MediaType.APPLICATION_JSON_TYPE).encoding("UTF-8").build();
    } catch (Exception e) {
      return getServerError(
          "Error listing component geometries for render " + renderId + " page " + pageNumber, e);
    }
  }

  /** Axis-aligned union of two geometries (null-safe). */
  private static org.lean.core.LeanGeometry unionGeometry(
      org.lean.core.LeanGeometry a, org.lean.core.LeanGeometry b) {
    if (a == null) {
      return b == null ? null : new org.lean.core.LeanGeometry(b);
    }
    if (b == null) {
      return new org.lean.core.LeanGeometry(a);
    }
    int x1 = Math.min(a.getX(), b.getX());
    int y1 = Math.min(a.getY(), b.getY());
    int x2 = Math.max(a.getX() + a.getWidth(), b.getX() + b.getWidth());
    int y2 = Math.max(a.getY() + a.getHeight(), b.getY() + b.getHeight());
    return new org.lean.core.LeanGeometry(x1, y1, Math.max(0, x2 - x1), Math.max(0, y2 - y1));
  }

  /**
   * Connector names available to a presentation rendering: presentation-local first, then shared
   * metadata connectors.
   */
  @GET
  @Path("/info/connectors/{renderId}")
  @Produces(MediaType.APPLICATION_JSON)
  public Response getPresentationConnectorNames(@PathParam("renderId") String renderId) {
    try {
      IRendering rendering = lookupRendering(renderId);
      List<String> names = new ArrayList<>();
      if (rendering.getPresentation() != null
          && rendering.getPresentation().getConnectors() != null) {
        for (LeanConnector c : rendering.getPresentation().getConnectors()) {
          if (c.getName() != null && !names.contains(c.getName())) {
            names.add(c.getName());
          }
        }
      }
      IHopMetadataProvider provider = leanRest.getMetadataProvider();
      IHopMetadataSerializer<LeanConnector> serializer =
          provider.getSerializer(LeanConnector.class);
      for (String n : serializer.listObjectNames()) {
        if (!names.contains(n)) {
          names.add(n);
        }
      }
      String json = new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(names);
      return Response.ok(json).type(MediaType.APPLICATION_JSON_TYPE).encoding("UTF-8").build();
    } catch (Exception e) {
      return getServerError("Error listing connectors for rendering " + renderId, e);
    }
  }

  /**
   * Describe the output of a connector in a presentation rendering.
   *
   * @param request the request object which contains all the contextual information needed.
   * @return The row metadata describing the connector output.
   */
  @POST
  @Path("/connector/describe/")
  @Consumes(MediaType.APPLICATION_JSON)
  @Produces(MediaType.APPLICATION_JSON)
  public Response describeConnectorOutput(ConnectorDescriptionRequest request) {
    try {
      IHopMetadataProvider provider = leanRest.getMetadataProvider();
      IHopMetadataSerializer<LeanConnector> serializer =
          provider.getSerializer(LeanConnector.class);

      IRendering rendering = null;
      if (request.getRenderId() != null && !request.getRenderId().isBlank()) {
        rendering = leanRest.getRendering(request.getRenderId());
      }

      LeanConnector connector = null;
      IDataContext dataContext = null;

      if (rendering != null) {
        if (rendering.getPresentation() != null) {
          connector = rendering.getPresentation().getConnector(request.getConnectorName());
        }
        if (rendering.getLayoutResults() != null) {
          dataContext = rendering.getLayoutResults().getDataContext();
        }
      }

      if (connector == null) {
        connector = serializer.load(request.getConnectorName());
      }
      if (connector == null) {
        throw new LeanException(
            "Connector '"
                + request.getConnectorName()
                + "' couldn't be found in the presentation or metadata");
      }

      // Fallback when renderId is missing/expired: describe from metadata alone
      if (dataContext == null) {
        LeanPresentation presentation =
            rendering != null ? rendering.getPresentation() : null;
        if (presentation == null) {
          presentation = new LeanPresentation();
          presentation.setName("_describe");
        }
        dataContext = new PresentationDataContext(presentation, provider);
      }

      IRowMeta rowMeta = connector.describeOutput(dataContext);
      String json =
          new com.fasterxml.jackson.databind.ObjectMapper()
              .writeValueAsString(new RowMetaResponse(rowMeta).getValueMetaList());
      return Response.ok(json).type(MediaType.APPLICATION_JSON_TYPE).encoding("UTF-8").build();
    } catch (Exception e) {
      return getServerError(
          "Error getting row metadata from connector " + request.getConnectorName(), e);
    }
  }

  private IRendering lookupRendering(String renderId) throws LeanException {
    IRendering rendering = leanRest.getRendering(renderId);
    if (rendering == null) {
      throw new LeanException("Unable to find rendering with ID " + renderId);
    }
    return rendering;
  }
}
