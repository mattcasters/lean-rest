package org.lean.rest.resources;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.apache.commons.lang3.StringUtils;
import org.apache.hop.metadata.api.IHopMetadataProvider;
import org.apache.hop.metadata.serializer.json.JsonMetadataParser;
import org.lean.core.exception.LeanException;
import org.lean.presentation.LeanPresentation;
import org.lean.presentation.connector.LeanConnector;
import org.lean.presentation.connector.preview.ConnectorPreviewResult;
import org.lean.presentation.connector.preview.ConnectorPreviewSupport;
import org.lean.presentation.datacontext.IDataContext;
import org.lean.presentation.datacontext.PresentationDataContext;
import org.lean.rest.render.IRendering;
import org.lean.rest.render.RenderFactory;
import org.lean.rest.resources.requests.ConnectorPreviewRequest;

@Path("edit/")
public class EditPluginResource extends BaseResource {

  private static final ObjectMapper MAPPER = new ObjectMapper();

  /**
   * Get the HTML to edit a component (annotation-generated when available, else static HTML).
   *
   * @param componentId The ID of the component to edit
   * @return
   */
  @GET
  @Path("/component/{componentId}/")
  public Response editComponent(@PathParam("componentId") String componentId) {
    try {
      return RenderFactory.getComponentPluginPage(this, componentId);
    } catch (Exception e) {
      String errorMessage =
          "Unexpected error retrieving the HTML to edit component ID: " + componentId;
      return getServerError(errorMessage, e);
    }
  }

  /**
   * JSON form schema for a component plugin, derived from {@code @LeanWidgetElement} annotations.
   */
  @GET
  @Path("/schema/component/{componentId}/")
  @Produces(MediaType.APPLICATION_JSON)
  public Response componentSchema(@PathParam("componentId") String componentId) {
    try {
      return RenderFactory.getComponentPluginSchema(componentId);
    } catch (Exception e) {
      String errorMessage =
          "Unexpected error retrieving the form schema for component ID: " + componentId;
      return getServerError(errorMessage, e);
    }
  }

  /** JSON form schema for a connector plugin. */
  @GET
  @Path("/schema/connector/{connectorId}/")
  @Produces(MediaType.APPLICATION_JSON)
  public Response connectorSchema(@PathParam("connectorId") String connectorId) {
    try {
      return RenderFactory.getConnectorPluginSchema(connectorId);
    } catch (Exception e) {
      String errorMessage =
          "Unexpected error retrieving the form schema for connector ID: " + connectorId;
      return getServerError(errorMessage, e);
    }
  }

  /**
   * HTML form to edit a connector of the given plugin type (e.g. {@code SqlConnector}).
   * Client supplies {@code connectorJson} before evaluating load/save scripts.
   */
  @GET
  @Path("/connector/{connectorPluginId}/")
  public Response editConnector(@PathParam("connectorPluginId") String connectorPluginId) {
    try {
      return RenderFactory.getConnectorPluginPage(connectorPluginId);
    } catch (Exception e) {
      String errorMessage =
          "Unexpected error retrieving the HTML to edit connector plugin: " + connectorPluginId;
      return getServerError(errorMessage, e);
    }
  }

  /**
   * Sample input/output rows for the connector data studio from current form state (may be
   * unsaved).
   *
   * <p>Always returns HTTP 200 with a structured body ({@code ok}, {@code input}, {@code output},
   * {@code error}) for application outcomes. Malformed requests return 400/500.
   */
  @POST
  @Path("/connector/preview/")
  @Consumes(MediaType.APPLICATION_JSON)
  @Produces(MediaType.APPLICATION_JSON)
  public Response previewConnector(ConnectorPreviewRequest request) {
    try {
      if (request == null || StringUtils.isBlank(request.getLeanConnectorJson())) {
        return Response.status(Response.Status.BAD_REQUEST)
            .entity("{\"ok\":false,\"error\":{\"summary\":\"leanConnectorJson is required\"}}")
            .type(MediaType.APPLICATION_JSON_TYPE)
            .build();
      }

      IHopMetadataProvider provider = leanRest.getMetadataProvider();
      JsonMetadataParser<LeanConnector> parser =
          new JsonMetadataParser<>(LeanConnector.class, provider);
      LeanConnector connector =
          parser.loadJsonObject(
              LeanConnector.class,
              new JsonFactory().createParser(request.getLeanConnectorJson()));
      if (connector == null || connector.getConnector() == null) {
        ConnectorPreviewResult empty = new ConnectorPreviewResult();
        empty.setOk(false);
        empty.setMaxRows(ConnectorPreviewSupport.clampMaxRows(request.getMaxRows()));
        empty.setError(
            new ConnectorPreviewResult.PreviewError(
                "Could not parse connector JSON",
                "leanConnectorJson must be a full Hop connector object with a plugin payload"));
        return Response.ok(MAPPER.writeValueAsString(empty))
            .type(MediaType.APPLICATION_JSON_TYPE)
            .encoding("UTF-8")
            .build();
      }

      IDataContext dataContext = buildPreviewDataContext(request.getRenderId(), provider, connector);
      int maxRows = ConnectorPreviewSupport.clampMaxRows(request.getMaxRows());
      ConnectorPreviewResult result =
          ConnectorPreviewSupport.preview(dataContext, connector, maxRows);

      return Response.ok(MAPPER.writeValueAsString(result))
          .type(MediaType.APPLICATION_JSON_TYPE)
          .encoding("UTF-8")
          .build();
    } catch (Exception e) {
      // Unexpected parse/infrastructure errors — still prefer structured 200 when possible
      try {
        ConnectorPreviewResult fail = new ConnectorPreviewResult();
        fail.setOk(false);
        fail.setMaxRows(
            ConnectorPreviewSupport.clampMaxRows(
                request != null ? request.getMaxRows() : null));
        fail.setError(
            new ConnectorPreviewResult.PreviewError(
                LeanPresentation.summarizeException(e),
                LeanPresentation.formatExceptionDetail(e)));
        return Response.ok(MAPPER.writeValueAsString(fail))
            .type(MediaType.APPLICATION_JSON_TYPE)
            .encoding("UTF-8")
            .build();
      } catch (Exception serializeEx) {
        return getServerError("Error previewing connector", e);
      }
    }
  }

  /**
   * Build a data context that can resolve shared metadata connectors and, when {@code renderId} is
   * set, presentation-local connectors. The connector under edit is injected into a presentation
   * copy so transforms that need sibling connectors (and rename-in-progress names) resolve when
   * possible.
   */
  private IDataContext buildPreviewDataContext(
      String renderId, IHopMetadataProvider provider, LeanConnector underEdit)
      throws LeanException {
    LeanPresentation presentation = null;

    if (StringUtils.isNotBlank(renderId)) {
      IRendering rendering = leanRest.getRendering(renderId);
      if (rendering != null) {
        // Prefer layout data context when available (same as describe path)
        if (rendering.getLayoutResults() != null
            && rendering.getLayoutResults().getDataContext() != null) {
          // Still wrap presentation so we can inject the unsaved connector
          presentation = rendering.getPresentation();
        } else if (rendering.getPresentation() != null) {
          presentation = rendering.getPresentation();
        }
      }
    }

    // Work on a shallow presentation shell with copied connector list
    LeanPresentation shell = new LeanPresentation();
    shell.setName(presentation != null ? presentation.getName() : "_connector_preview");
    shell.setDescription(
        presentation != null ? presentation.getDescription() : "connector preview");
    if (presentation != null && presentation.getConnectors() != null) {
      for (LeanConnector c : presentation.getConnectors()) {
        if (c != null) {
          shell.getConnectors().add(new LeanConnector(c));
        }
      }
    }

    // Inject / replace the unsaved connector by name so context lookup sees form state
    if (underEdit.getName() != null && !underEdit.getName().isBlank()) {
      shell.getConnectors().removeIf(c -> underEdit.getName().equals(c.getName()));
      shell.getConnectors().add(new LeanConnector(underEdit));
    }

    return new PresentationDataContext(shell, provider);
  }
}
