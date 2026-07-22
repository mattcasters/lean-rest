package org.lean.rest.resources;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.core.Response;
import org.lean.rest.render.RenderFactory;

@Path("edit/")
public class EditPluginResource extends BaseResource {
  /**
   * Get the HTML to edit a component
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
}
