package org.lean.rest.resources;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.io.InputStream;
import org.lean.rest.LeanRest;

@Path("")
public class StaticResourcesResource {
  private static final LeanRest leanRest = LeanRest.getInstance();

  @GET
  @Path("static/{path}")
  public Response staticResources(@PathParam("path") final String path) {
    return loadFile("static/", path);
  }

  @GET
  @Path("static/images/{path}")
  public Response staticImages(@PathParam("path") final String path) {
    return loadFile("static/images/", path);
  }

  @GET
  @Path("static/edit/{path}")
  public Response editPages(@PathParam("path") final String path) {
    return loadFile("static/edit/", path);
  }

  private Response loadFile(String base, String path) {
    InputStream resource =
        leanRest.getClass().getResourceAsStream(String.format("/WEB-INF/" + base + "/%s", path));
    if (resource == null) {
      leanRest
          .getLog()
          .logError("File " + base + path + " could not be found as a static resource.");
      return Response.status(Response.Status.NOT_FOUND).build();
    }
    Response.ResponseBuilder status = Response.ok().entity(resource);
    if (path.toLowerCase().endsWith(".svg")) {
      status.type("image/svg+xml");
    } else if (path.toLowerCase().endsWith(".html")) {
      status.type(MediaType.TEXT_HTML_TYPE);
    } else if (path.toLowerCase().endsWith(".json")) {
      status.type(MediaType.APPLICATION_JSON_TYPE);
    }
    return status.build();
  }
}
