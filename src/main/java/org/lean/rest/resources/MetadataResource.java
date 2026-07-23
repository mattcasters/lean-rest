package org.lean.rest.resources;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.SecurityContext;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.apache.hop.core.Const;
import org.apache.hop.core.database.DatabaseMeta;
import org.apache.hop.core.database.DatabasePluginType;
import org.apache.hop.core.exception.HopException;
import org.apache.hop.core.logging.ILogChannel;
import org.apache.hop.core.plugins.IPlugin;
import org.apache.hop.core.plugins.PluginRegistry;
import org.apache.hop.metadata.api.HopMetadata;
import org.apache.hop.metadata.api.IHopMetadata;
import org.apache.hop.metadata.api.IHopMetadataProvider;
import org.apache.hop.metadata.api.IHopMetadataSerializer;
import org.apache.hop.metadata.serializer.json.JsonMetadataParser;
import org.lean.core.LeanDatabaseConnection;
import org.lean.core.exception.LeanException;
import org.lean.presentation.LeanPresentation;
import org.lean.presentation.component.LeanComponent;
import org.lean.presentation.connector.LeanConnector;
import org.lean.presentation.page.LeanPage;
import org.lean.rest.LeanRest;
import org.lean.rest.resources.requests.ModifyComponentRequest;
import org.lean.rest.resources.requests.ModifyConnectorRequest;
import org.lean.rest.resources.responses.PresentationResponse;

@Path("/metadata")
public class MetadataResource extends BaseResource {

  private final LeanRest leanRest = LeanRest.getInstance();

  /**
   * List all the type keys
   *
   * @return A list with all the type keys in the metadata
   */
  @GET
  @Path("/types")
  @Produces(MediaType.APPLICATION_JSON)
  public Response getTypes(@Context SecurityContext securityContext) {
    try {
      List<String> types = new ArrayList<>();
      IHopMetadataProvider provider = leanRest.getMetadataProvider();
      List<Class<IHopMetadata>> metadataClasses = provider.getMetadataClasses();
      for (Class<IHopMetadata> metadataClass : metadataClasses) {
        HopMetadata metadata = metadataClass.getAnnotation(HopMetadata.class);
        types.add(metadata.key());
      }
      // Pre-serialize JSON (avoids Jersey FilteringJacksonJaxbJsonProvider NPE)
      String json = new ObjectMapper().writeValueAsString(types);
      return Response.ok(json).type(MediaType.APPLICATION_JSON_TYPE).encoding("UTF-8").build();
    } catch (Exception e) {
      return getServerError("Error listing metadata types", e);
    }
  }

  /**
   * List all the element names for a given type
   *
   * @param key the metadata key to use
   * @return A list with all the metadata element names
   * @throws HopException
   */
  @GET
  @Path("/list/{key}/")
  @Produces(MediaType.APPLICATION_JSON)
  public Response listNames(@PathParam("key") String key) {
    try {
      IHopMetadataProvider provider = leanRest.getMetadataProvider();
      Class<IHopMetadata> metadataClass = provider.getMetadataClassForKey(key);
      IHopMetadataSerializer<IHopMetadata> serializer = provider.getSerializer(metadataClass);
      String json = new ObjectMapper().writeValueAsString(serializer.listObjectNames());
      return Response.ok(json).type(MediaType.APPLICATION_JSON_TYPE).encoding("UTF-8").build();
    } catch (Exception e) {
      return getServerError("Error listing metadata names for key " + key, e);
    }
  }

  /**
   * Get a metadata element with a given type and name as Hop metadata JSON (via {@link
   * JsonMetadataParser}, not raw Jackson entity binding).
   *
   * @param key The key of the metadata type
   * @param name The name to look up
   * @return The metadata element JSON
   */
  @GET
  @Path("/{key}/{name}")
  @Produces(MediaType.APPLICATION_JSON)
  public Response getElement(@PathParam("key") String key, @PathParam("name") String name) {
    try {
      IHopMetadataProvider provider = leanRest.getMetadataProvider();
      Class<IHopMetadata> metadataClass = provider.getMetadataClassForKey(key);
      IHopMetadataSerializer<IHopMetadata> serializer = provider.getSerializer(metadataClass);
      IHopMetadata metadata = serializer.load(name);
      if (metadata == null) {
        return getServerError("Metadata not found: key=" + key + " name=" + name, false);
      }
      JsonMetadataParser<IHopMetadata> parser =
          new JsonMetadataParser<>(metadataClass, provider);
      org.json.simple.JSONObject json = parser.getJsonObject(metadata);
      return Response.ok()
          .entity(json.toJSONString())
          .type(MediaType.APPLICATION_JSON_TYPE)
          .encoding("UTF-8")
          .build();
    } catch (Exception e) {
      return getServerError("Error loading metadata key=" + key + " name=" + name, e);
    }
  }

  /**
   * Delete a metadata element by type key and name.
   *
   * @param key metadata type key
   * @param name element name
   */
  @DELETE
  @Path("/{key}/{name}")
  @Produces(MediaType.TEXT_PLAIN)
  public Response deleteElement(@PathParam("key") String key, @PathParam("name") String name) {
    try {
      IHopMetadataProvider provider = leanRest.getMetadataProvider();
      Class<IHopMetadata> metadataClass = provider.getMetadataClassForKey(key);
      IHopMetadataSerializer<IHopMetadata> serializer = provider.getSerializer(metadataClass);
      if (!serializer.exists(name)) {
        return getServerError("Metadata not found: key=" + key + " name=" + name, false);
      }
      serializer.delete(name);
      leanRest.getLog().logBasic("Deleted metadata key='" + key + "' name='" + name + "'");
      return Response.ok().entity(name).type(MediaType.TEXT_PLAIN).build();
    } catch (Exception e) {
      return getServerError("Error deleting metadata key=" + key + " name=" + name, e);
    }
  }

  /**
   * Hop database plugin type codes for the database-connection admin form: {@code [{ id, name },
   * ...]}.
   */
  @GET
  @Path("/database-types")
  @Produces(MediaType.APPLICATION_JSON)
  public Response listDatabaseTypes() {
    try {
      PluginRegistry registry = PluginRegistry.getInstance();
      List<IPlugin> plugins = new ArrayList<>(registry.getPlugins(DatabasePluginType.class));
      plugins.sort(
          Comparator.comparing(
              p -> p.getName() != null ? p.getName() : p.getIds()[0],
              String.CASE_INSENSITIVE_ORDER));
      List<Map<String, String>> rows = new ArrayList<>();
      for (IPlugin plugin : plugins) {
        Map<String, String> row = new LinkedHashMap<>();
        String id = plugin.getIds() != null && plugin.getIds().length > 0 ? plugin.getIds()[0] : "";
        row.put("id", id);
        row.put("name", plugin.getName() != null ? plugin.getName() : id);
        rows.add(row);
      }
      // Fallback if plugin registry is empty (rare in tests)
      if (rows.isEmpty()) {
        for (String code :
            new String[] {
              "POSTGRESQL", "MYSQL", "H2", "ORACLE", "MSSQL", "MSSQLNATIVE", "GENERIC"
            }) {
          Map<String, String> row = new LinkedHashMap<>();
          row.put("id", code);
          row.put("name", code);
          rows.add(row);
        }
      }
      String json = new ObjectMapper().writeValueAsString(rows);
      return Response.ok(json).type(MediaType.APPLICATION_JSON_TYPE).encoding("UTF-8").build();
    } catch (Exception e) {
      return getServerError("Error listing database types", e);
    }
  }

  /**
   * Test a {@link LeanDatabaseConnection} JSON document (does not save). Body is the same shape as
   * metadata save.
   */
  @POST
  @Path("/database-connection/test/")
  @Consumes(MediaType.APPLICATION_JSON)
  @Produces(MediaType.TEXT_PLAIN)
  public Response testDatabaseConnection(String jsonBody) {
    try {
      if (jsonBody == null || jsonBody.isBlank()) {
        return getServerError("Request body must be a database connection JSON document", false);
      }
      IHopMetadataProvider provider = leanRest.getMetadataProvider();
      JsonMetadataParser<LeanDatabaseConnection> parser =
          new JsonMetadataParser<>(LeanDatabaseConnection.class, provider);
      LeanDatabaseConnection connection =
          parser.loadJsonObject(
              LeanDatabaseConnection.class, new JsonFactory().createParser(jsonBody));
      if (connection == null) {
        return getServerError("Could not parse database connection JSON", false);
      }
      DatabaseMeta meta = connection.createDatabaseMeta();
      org.apache.hop.core.variables.Variables vars = new org.apache.hop.core.variables.Variables();
      vars.initializeFrom(null);
      String message = meta.testConnection(vars);
      if (message != null && message.toLowerCase().contains("error")) {
        return getServerError(message, false);
      }
      return Response.ok(message != null ? message : "Connection OK: " + connection.getName())
          .type(MediaType.TEXT_PLAIN)
          .build();
    } catch (Exception e) {
      return getServerError("Error testing database connection", e);
    }
  }

  /**
   * Save a metadata element.
   *
   * <p>Body is raw JSON (not {@link IHopMetadata}): Jackson cannot instantiate the abstract
   * interface. We resolve the concrete class from the metadata key and parse with {@link
   * JsonMetadataParser}, matching how connector/component save paths work.
   *
   * @param key metadata type key (e.g. {@code presentation}, {@code theme})
   * @param jsonBody JSON document for the element
   * @return saved element name
   */
  @POST
  @Path("/{key}/")
  @Consumes(MediaType.APPLICATION_JSON)
  @Produces(MediaType.TEXT_PLAIN)
  public Response saveElement(@PathParam("key") String key, String jsonBody) {
    try {
      if (jsonBody == null || jsonBody.isBlank()) {
        return getServerError("Request body must be a JSON metadata document", false);
      }
      IHopMetadataProvider provider = leanRest.getMetadataProvider();
      Class<IHopMetadata> metadataClass = provider.getMetadataClassForKey(key);
      IHopMetadataSerializer<IHopMetadata> serializer = provider.getSerializer(metadataClass);
      JsonMetadataParser<IHopMetadata> parser =
          new JsonMetadataParser<>(metadataClass, provider);
      com.fasterxml.jackson.core.JsonParser jsonParser =
          new JsonFactory().createParser(jsonBody);
      IHopMetadata metadata = parser.loadJsonObject(metadataClass, jsonParser);
      if (metadata == null || metadata.getName() == null || metadata.getName().isBlank()) {
        return getServerError("JSON must include a non-empty name", false);
      }
      serializer.save(metadata);
      leanRest.getLog().logBasic("Saved metadata key='" + key + "' name='" + metadata.getName() + "'");
      return Response.ok().entity(metadata.getName()).type(MediaType.TEXT_PLAIN).build();
    } catch (Exception e) {
      return getServerError("Error saving metadata for key " + key, e);
    }
  }

  /**
   * List presentation details.
   *
   * @return
   * @throws HopException
   */
  @GET
  @Path("/presentations/")
  @Produces(MediaType.APPLICATION_JSON)
  public Response listPresentations() throws HopException {
    IHopMetadataProvider provider = leanRest.getMetadataProvider();
    IHopMetadataSerializer<LeanPresentation> serializer =
        provider.getSerializer(LeanPresentation.class);
    List<PresentationResponse> list = new ArrayList<>();
    List<String> names = serializer.listObjectNames();
    for (String name : names) {
      LeanPresentation presentation = serializer.load(name);
      list.add(new PresentationResponse(presentation.getName(), presentation.getDescription()));
    }
    try {
      String json = new ObjectMapper().writeValueAsString(list);
      return Response.ok()
          .entity(json)
          .type(MediaType.APPLICATION_JSON_TYPE)
          .encoding("UTF-8")
          .build();
    } catch (Exception e) {
      return Response.serverError()
          .entity("Error listing presentation metadata details " + Const.getStackTracker(e))
          .type(MediaType.TEXT_PLAIN)
          .encoding("UTF-8")
          .build();
    }
  }

  /**
   * Modify a component on a page in a presentation.
   *
   * @param request the component modification request
   * @return The name of the presentation that's been modified or an error.
   */
  @POST
  @Path("modify/component/")
  @Consumes(MediaType.APPLICATION_JSON)
  @Produces(MediaType.TEXT_PLAIN)
  public Response modifyComponent(ModifyComponentRequest request) {
    try {
      ILogChannel log = leanRest.getLog();

      IHopMetadataProvider provider = leanRest.getMetadataProvider();
      IHopMetadataSerializer<LeanPresentation> serializer =
          provider.getSerializer(LeanPresentation.class);
      LeanPresentation presentation = serializer.load(request.getPresentationName());
      if (presentation == null) {
        throw new LeanException("Couldn't find presentation " + request.getPresentationName());
      }

      String pageRole =
          request.getPageRole() == null || request.getPageRole().isBlank()
              ? "page"
              : request.getPageRole().trim().toLowerCase();

      LeanPage preferredPage = null;
      if ("header".equals(pageRole)) {
        preferredPage = presentation.getHeader();
        if (preferredPage == null) {
          throw new LeanException(
              "Presentation " + request.getPresentationName() + " has no header page");
        }
      } else if ("footer".equals(pageRole)) {
        preferredPage = presentation.getFooter();
        if (preferredPage == null) {
          throw new LeanException(
              "Presentation " + request.getPresentationName() + " has no footer page");
        }
      } else if (request.getLogicalPageNumber() >= 0
          && request.getLogicalPageNumber() < presentation.getPages().size()) {
        preferredPage = presentation.getPages().get(request.getLogicalPageNumber());
      }

      // Resolve top-level or nested (group/composite) components by metadata or drawn name
      ComponentLookup.Found found =
          ComponentLookup.find(presentation, preferredPage, request.getOldComponentName());
      if (found == null) {
        throw new LeanException(
            "Unable to find component to replace '"
                + request.getOldComponentName()
                + "' on logical page number "
                + request.getLogicalPageNumber()
                + " (role="
                + pageRole
                + ") of presentation "
                + request.getPresentationName()
                + " (also searched nested group/composite templates).");
      }

      // De-serialize the component JSON
      //
      JsonMetadataParser<LeanComponent> parser =
          new JsonMetadataParser<>(LeanComponent.class, leanRest.getMetadataProvider());

      JsonFactory jsonFactory = new JsonFactory();
      com.fasterxml.jackson.core.JsonParser jsonParser =
          jsonFactory.createParser(request.getLeanComponentJson());

      LeanComponent leanComponent = parser.loadJsonObject(LeanComponent.class, jsonParser);
      ComponentLookup.replace(found, leanComponent);

      serializer.save(presentation);

      log.logBasic(
          "modify/component: modified presentation " + request.getPresentationName() + " saved.");

      return Response.ok().entity(request.getPresentationName()).build();
    } catch (Exception e) {
      return getServerError(
          "Error modifying component in presentation " + request.getPresentationName(), e);
    }
  }

  /**
   * List shared connector metadata with plugin type for the admin table (icons, tooltips).
   *
   * <p>Returns {@code [{ "name", "pluginId", "shared" }, ...]} sorted by name.
   */
  @GET
  @Path("/connectors/summary/")
  @Produces(MediaType.APPLICATION_JSON)
  public Response listConnectorSummaries() {
    try {
      IHopMetadataProvider provider = leanRest.getMetadataProvider();
      IHopMetadataSerializer<LeanConnector> serializer =
          provider.getSerializer(LeanConnector.class);
      List<Map<String, Object>> rows = new ArrayList<>();
      for (String name : serializer.listObjectNames()) {
        if (name == null || name.isBlank()) {
          continue;
        }
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("name", name);
        String pluginId = null;
        boolean shared = false;
        try {
          LeanConnector connector = serializer.load(name);
          if (connector != null) {
            shared = connector.isShared();
            if (connector.getConnector() != null) {
              pluginId = connector.getConnector().getPluginId();
            }
          }
        } catch (Exception loadEx) {
          leanRest
              .getLog()
              .logBasic(
                  "connectors/summary: could not load '" + name + "': " + loadEx.getMessage());
        }
        row.put("pluginId", pluginId);
        row.put("shared", shared);
        rows.add(row);
      }
      rows.sort(
          Comparator.comparing(
              r -> String.valueOf(r.get("name")), String.CASE_INSENSITIVE_ORDER));
      String json = new ObjectMapper().writeValueAsString(rows);
      return Response.ok(json).type(MediaType.APPLICATION_JSON_TYPE).encoding("UTF-8").build();
    } catch (Exception e) {
      return getServerError("Error listing connector summaries", e);
    }
  }

  /**
   * Load a connector as Hop metadata JSON (plugin id as nested map key), suitable for the generated
   * form editor.
   */
  @GET
  @Path("/connector-json/{name}")
  @Produces(MediaType.APPLICATION_JSON)
  public Response getConnectorJson(@PathParam("name") String name) {
    try {
      IHopMetadataProvider provider = leanRest.getMetadataProvider();
      IHopMetadataSerializer<LeanConnector> serializer =
          provider.getSerializer(LeanConnector.class);
      LeanConnector connector = serializer.load(name);
      if (connector == null) {
        throw new LeanException("Connector not found: " + name);
      }
      JsonMetadataParser<LeanConnector> parser =
          new JsonMetadataParser<>(LeanConnector.class, provider);
      org.json.simple.JSONObject json = parser.getJsonObject(connector);
      return Response.ok()
          .entity(json.toJSONString())
          .type(MediaType.APPLICATION_JSON_TYPE)
          .encoding("UTF-8")
          .build();
    } catch (Exception e) {
      return getServerError("Error loading connector JSON for " + name, e);
    }
  }

  /**
   * Save a connector metadata element (create or update). Supports rename by deleting the old name
   * when {@code oldConnectorName} differs from the JSON name.
   */
  @POST
  @Path("modify/connector/")
  @Consumes(MediaType.APPLICATION_JSON)
  @Produces(MediaType.TEXT_PLAIN)
  public Response modifyConnector(ModifyConnectorRequest request) {
    try {
      ILogChannel log = leanRest.getLog();
      IHopMetadataProvider provider = leanRest.getMetadataProvider();
      IHopMetadataSerializer<LeanConnector> serializer =
          provider.getSerializer(LeanConnector.class);

      JsonMetadataParser<LeanConnector> parser =
          new JsonMetadataParser<>(LeanConnector.class, provider);
      JsonFactory jsonFactory = new JsonFactory();
      com.fasterxml.jackson.core.JsonParser jsonParser =
          jsonFactory.createParser(request.getLeanConnectorJson());
      LeanConnector connector = parser.loadJsonObject(LeanConnector.class, jsonParser);
      if (connector == null || connector.getName() == null || connector.getName().isBlank()) {
        throw new LeanException("Connector JSON must include a non-empty name");
      }

      String oldName = request.getOldConnectorName();
      if (oldName != null
          && !oldName.isBlank()
          && !oldName.equals(connector.getName())
          && serializer.exists(oldName)) {
        serializer.delete(oldName);
        log.logBasic("modify/connector: deleted renamed connector '" + oldName + "'");
      }

      serializer.save(connector);
      log.logBasic("modify/connector: saved connector '" + connector.getName() + "'");
      return Response.ok().entity(connector.getName()).build();
    } catch (Exception e) {
      return getServerError("Error saving connector metadata", e);
    }
  }
}
