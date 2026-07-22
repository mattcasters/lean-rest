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
      DrawnItem drawnItem = page.lookupDrawnItem(request.getX(), request.getY());
      InteractionLookupResult result = new InteractionLookupResult();
      if (drawnItem != null) {
        // See if we have an action to match this...
        //
        LeanPresentation presentation = rendering.getPresentation();
        LeanInteraction interaction = presentation.findInteraction(null, drawnItem);
        if (interaction != null) {
          // We found an interaction for this drawn item...
          //
          result.setFound(true);
          result.setDrawnItem(drawnItem);
          result.setActions(interaction.getActions());
          result.setMethod(interaction.getMethod());
        }
      }

      return Response.ok()
          .entity(result.toJsonString())
          .encoding("UTF-8")
          .type(MediaType.APPLICATION_JSON)
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
      List<String> names = page.lookupComponentName(request.getX(), request.getY());
      if (names.isEmpty()) {
        throw new LeanException(
            "Unable to find any components on location ("
                + request.getX()
                + ","
                + request.getY()
                + ")");
      }
      LeanComponent component = page.getPage().findComponent(names.get(0));

      // Serialize this to JSON...
      //
      JsonMetadataParser<LeanComponent> parser =
          new JsonMetadataParser<>(LeanComponent.class, leanRest.getMetadataProvider());
      JSONObject jsonObject = parser.getJsonObject(component);

      return Response.ok()
          .entity(jsonObject.toJSONString())
          .encoding("UTF-8")
          .type(MediaType.APPLICATION_JSON)
          .build();
    } catch (Exception e) {
      // Don't log on the server, it can be tedious to see all the failed lookups.
      //
      String errorMessage =
          "Unexpected error retrieving the JSON of a component actions for request: " + request;
      return Response.serverError()
          .status(Response.Status.INTERNAL_SERVER_ERROR)
          .entity(errorMessage + "\n" + Const.getSimpleStackTrace(e))
          .type(MediaType.TEXT_PLAIN)
          .build();
    }
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
  public Response getPageCount(
      @PathParam("renderId") String renderId, @PathParam("pageNumber") int pageNumber) {
    try {
      IRendering rendering = lookupRendering(renderId);
      LeanRenderPage renderPage = lookupRenderPage(rendering, pageNumber);
      LeanPage leanPage = renderPage.getPage();

      List<String> names = new ArrayList<>();
      for (LeanComponent component : leanPage.getComponents()) {
        names.add(component.getName());
      }
      return Response.ok().entity(names).build();
    } catch (Exception e) {
      String errorMessage =
          "Unexpected error getting the components for presentation rendering ID " + renderId;
      return getServerError(errorMessage, e);
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
      IRendering rendering = lookupRendering(request.getRenderId());
      IHopMetadataProvider provider = leanRest.getMetadataProvider();
      IHopMetadataSerializer<LeanConnector> serializer =
          provider.getSerializer(LeanConnector.class);
      LeanConnector connector = serializer.load(request.getConnectorName());
      if (connector == null) {
        throw new LeanException(
            "Connector '" + request.getConnectorName() + "' couldn't be found in the metadata");
      }

      // Describe the output
      //
      IRowMeta rowMeta = connector.describeOutput(rendering.getLayoutResults().getDataContext());
      return Response.ok(new RowMetaResponse(rowMeta).getValueMetaList()).build();
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
