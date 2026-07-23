package org.lean.rest.resources;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
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
    String lower = path.toLowerCase();
    // Always declare charset for text so UTF-8 source (arrows, middots, …) is not
    // misread as ISO-8859-1 (classic "Â·" / "â†'" mojibake).
    if (lower.endsWith(".svg")) {
      status.type("image/svg+xml; charset=UTF-8");
    } else if (lower.endsWith(".html")) {
      status.type("text/html; charset=UTF-8");
    } else if (lower.endsWith(".json")) {
      status.type("application/json; charset=UTF-8");
    } else if (lower.endsWith(".js")) {
      status.type("application/javascript; charset=UTF-8");
    } else if (lower.endsWith(".css")) {
      status.type("text/css; charset=UTF-8");
    } else if (lower.endsWith(".png")) {
      status.type("image/png");
    } else if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
      status.type("image/jpeg");
    } else if (lower.endsWith(".gif")) {
      status.type("image/gif");
    } else if (lower.endsWith(".ico")) {
      status.type("image/x-icon");
    } else if (lower.endsWith(".woff2")) {
      status.type("font/woff2");
    } else if (lower.endsWith(".woff")) {
      status.type("font/woff");
    }
    return status.build();
  }
}
