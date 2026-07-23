package org.lean.rest.render;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.ws.rs.core.Response;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.apache.commons.io.IOUtils;
import org.apache.hop.core.Const;
import org.apache.hop.core.logging.ILoggingObject;
import org.apache.hop.metadata.api.IHopMetadataProvider;
import org.lean.core.exception.LeanException;
import org.lean.core.gui.form.GuiFormHtmlRenderer;
import org.lean.core.gui.form.GuiFormSchema;
import org.lean.core.gui.form.GuiFormSchemaBuilder;
import org.lean.presentation.LeanPresentation;
import org.lean.presentation.layout.LeanLayoutResults;
import org.lean.presentation.layout.LeanRenderPage;
import org.lean.presentation.variable.LeanParameter;
import org.lean.render.context.PresentationRenderContext;
import org.lean.rest.LeanRest;
import org.lean.rest.render.svg.PresentationSvgRendering;

public class RenderFactory {
  public static final IRendering renderPresentation(
      ILoggingObject parent,
      IHopMetadataProvider metadataProvider,
      LeanPresentation presentation,
      List<LeanParameter> parameters)
      throws LeanException {

    PresentationRenderContext renderContext = new PresentationRenderContext(presentation, metadataProvider);
    LeanLayoutResults layoutResults =
        presentation.doLayout(parent, renderContext, metadataProvider, parameters);
    presentation.render(layoutResults, metadataProvider);

    PresentationSvgRendering rendering = new PresentationSvgRendering();
    rendering.setPresentation(presentation);
    rendering.setLayoutResults(layoutResults);
    rendering.setParameters(parameters);
    rendering.setPresentationName(presentation.getName());
    return rendering;
  }

  public static Response renderPage(IRendering rendering, LeanRenderPage page, String renderType)
      throws LeanException {
    switch (renderType.toUpperCase()) {
      case "SVG":
        return renderPageSvg(rendering, page);
      case "HTML":
        return renderPageHtml(rendering, page);
      default:
        return Response.serverError()
            .entity("Render type " + renderType + " is not supported yet.")
            .build();
    }
  }

  private static Response renderPageSvg(IRendering rendering, LeanRenderPage page)
      throws LeanException {
    LeanRest.getInstance()
        .getLog()
        .logBasic(
            "SVG image rendering page "
                + page.getPageNumber()
                + " of rendering "
                + rendering.getId());
    return Response.ok().entity(page.getSvgXml()).encoding("UTF-8").type("image/svg+xml").build();
  }

  private static Response renderPageHtml(IRendering rendering, LeanRenderPage renderPage) {
    return renderPageHtml(rendering, renderPage, "view");
  }

  /**
   * Render the HTML shell for a presentation page.
   *
   * @param mode {@code view} or {@code edit} — selects template and client mode constant
   */
  public static Response renderPageHtml(
      IRendering rendering, LeanRenderPage renderPage, String mode) {
    LeanRest.getInstance()
        .getLog()
        .logBasic(
            "HTML rendering page "
                + renderPage.getPageNumber()
                + " of rendering "
                + rendering.getId()
                + " mode="
                + mode);

    LeanLayoutResults layoutResults = rendering.getLayoutResults();
    boolean edit = mode != null && mode.equalsIgnoreCase("edit");
    String templateFileName = edit ? "handle-presentation-edit.html" : "handle-presentation.html";
    String html = "";

    try (InputStream inputStream =
        rendering.getClass().getClassLoader().getResourceAsStream(templateFileName)) {
      if (inputStream == null) {
        throw new LeanException("Template not found on classpath: " + templateFileName);
      }
      html = IOUtils.toString(inputStream, StandardCharsets.UTF_8);

      // Page number is 1-based in layout results.
      html = html.replace("%PAGE_COUNT%", "" + layoutResults.getRenderPages().size());
      html = html.replace("%PAGE_NUMBER_0%", "" + (renderPage.getPageNumber() - 1));
      html = html.replace("%PAGE_NUMBER%", "" + renderPage.getPageNumber());
      html = html.replace("%PRESENTATION_NAME%", rendering.getPresentationName());
      html = html.replace("%RENDER_ID%", rendering.getId());
      html = html.replace("%LEAN_MODE%", edit ? "edit" : "view");

      String parametersJson = new ObjectMapper().writeValueAsString(rendering.getParameters());
      html = html.replace("%PARAMETER_VALUES%", "" + parametersJson);

      // charset on Content-Type (not Response.encoding, which is Content-Encoding)
      return Response.ok().entity(html).type("text/html; charset=UTF-8").build();
    } catch (Exception e) {
      String errorMessage = "Error reading HTML template file " + templateFileName;
      LeanRest.getInstance().getLog().logError(errorMessage, e);
      return Response.serverError().entity(errorMessage + "\n" + Const.getStackTracker(e)).build();
    }
  }

  public static Response getMainPage(Object object) throws LeanException {
    String filename = "home-page.html";
    try {
      try (InputStream inputStream =
          object.getClass().getClassLoader().getResourceAsStream(filename)) {
        if (inputStream == null) {
          throw new LeanException("Unable to find file " + filename);
        }
        String html = IOUtils.toString(inputStream, StandardCharsets.UTF_8);
        return Response.ok().entity(html).type("text/html; charset=UTF-8").build();
      }
    } catch (Exception e) {
      String errorMessage = "Error reading home page HTML file: " + filename;
      LeanRest.getInstance().getLog().logError(errorMessage, e);
      return Response.serverError().entity(errorMessage + "\n" + Const.getStackTracker(e)).build();
    }
  }

  /**
   * HTML editor page for a component plugin, generated from {@code @LeanWidgetElement} annotations.
   */
  public static Response getComponentPluginPage(Object object, String componentId)
      throws LeanException {
    try {
      GuiFormSchema schema = new GuiFormSchemaBuilder().buildComponentSchema(componentId);
      String html = new GuiFormHtmlRenderer().render(schema);
      return Response.ok().entity(html).type("text/html; charset=UTF-8").build();
    } catch (Exception e) {
      String errorMessage = "Error building form for component plugin: " + componentId;
      LeanRest.getInstance().getLog().logError(errorMessage, e);
      return Response.serverError().entity(errorMessage + "\n" + Const.getStackTracker(e)).build();
    }
  }

  /** JSON form schema for a component plugin (annotation-driven). */
  public static Response getComponentPluginSchema(String componentId) throws LeanException {
    try {
      GuiFormSchema schema = new GuiFormSchemaBuilder().buildComponentSchema(componentId);
      String json = new ObjectMapper().writeValueAsString(schema);
      return Response.ok().entity(json).type("application/json; charset=UTF-8").build();
    } catch (Exception e) {
      String errorMessage = "Error building form schema for component: " + componentId;
      LeanRest.getInstance().getLog().logError(errorMessage, e);
      return Response.serverError().entity(errorMessage + "\n" + Const.getStackTracker(e)).build();
    }
  }

  /** JSON form schema for a connector plugin (annotation-driven). */
  public static Response getConnectorPluginSchema(String connectorId) throws LeanException {
    try {
      GuiFormSchema schema = new GuiFormSchemaBuilder().buildConnectorSchema(connectorId);
      String json = new ObjectMapper().writeValueAsString(schema);
      return Response.ok().entity(json).type("application/json; charset=UTF-8").build();
    } catch (Exception e) {
      String errorMessage = "Error building form schema for connector: " + connectorId;
      LeanRest.getInstance().getLog().logError(errorMessage, e);
      return Response.serverError().entity(errorMessage + "\n" + Const.getStackTracker(e)).build();
    }
  }

  /** HTML editor page for a connector plugin type (annotation-driven). */
  public static Response getConnectorPluginPage(String connectorPluginId) throws LeanException {
    try {
      GuiFormSchema schema = new GuiFormSchemaBuilder().buildConnectorSchema(connectorPluginId);
      String html = new GuiFormHtmlRenderer().renderConnector(schema);
      return Response.ok().entity(html).type("text/html; charset=UTF-8").build();
    } catch (Exception e) {
      String errorMessage =
          "Error building connector edit HTML for plugin: " + connectorPluginId;
      LeanRest.getInstance().getLog().logError(errorMessage, e);
      return Response.serverError().entity(errorMessage + "\n" + Const.getStackTracker(e)).build();
    }
  }
}
