package org.lean.rest.resources;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.lean.rest.render.RenderFactory;

@Path("edit/")
public class EditPluginResource extends BaseResource {
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
}
