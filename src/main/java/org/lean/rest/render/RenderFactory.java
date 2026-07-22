package org.lean.rest.render;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.apache.commons.io.IOUtils;
import org.apache.hop.core.Const;
import org.apache.hop.core.logging.ILoggingObject;
import org.apache.hop.metadata.api.IHopMetadataProvider;
import org.lean.core.exception.LeanException;
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
    LeanRest.getInstance()
        .getLog()
        .logBasic(
            "HTML rendering page "
                + renderPage.getPageNumber()
                + " of rendering "
                + rendering.getId());

    LeanLayoutResults layoutResults = rendering.getLayoutResults();
    String templateFileName = "handle-presentation.html";
    String html = "";

    // Let's load the HTML as a template from file
    //
    try (InputStream inputStream =
        rendering.getClass().getClassLoader().getResourceAsStream(templateFileName)) {
      html = IOUtils.toString(inputStream, StandardCharsets.UTF_8);

      // Set some variables...
      // Page number is 1-based.
      //
      html = html.replace("%PAGE_COUNT%", "" + layoutResults.getRenderPages().size());
      html = html.replace("%PAGE_NUMBER_0%", "" + (renderPage.getPageNumber() - 1));
      html = html.replace("%PAGE_NUMBER%", "" + renderPage.getPageNumber());
      html = html.replace("%PRESENTATION_NAME%", rendering.getPresentationName());
      html = html.replace("%RENDER_ID%", rendering.getId());

      // The parameters as JSON
      //
      String parametersJson = new ObjectMapper().writeValueAsString(rendering.getParameters());
      html = html.replace("%PARAMETER_VALUES%", "" + parametersJson);

      return Response.ok().entity(html).encoding("UTF-8").type(MediaType.TEXT_HTML).build();
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
        return Response.ok().entity(html).encoding("UTF-8").type(MediaType.TEXT_HTML).build();
      }
    } catch (Exception e) {
      String errorMessage = "Error reading home page HTML file: " + filename;
      LeanRest.getInstance().getLog().logError(errorMessage, e);
      return Response.serverError().entity(errorMessage + "\n" + Const.getStackTracker(e)).build();
    }
  }

  public static Response getComponentPluginPage(Object object, String componentId)
      throws LeanException {
    String filename = "plugins/component/" + componentId + ".html";
    try {
      try (InputStream inputStream =
          object.getClass().getClassLoader().getResourceAsStream(filename)) {
        if (inputStream == null) {
          throw new LeanException("Unable to find file " + filename);
        }
        String html = IOUtils.toString(inputStream, StandardCharsets.UTF_8);
        return Response.ok().entity(html).encoding("UTF-8").type(MediaType.TEXT_HTML).build();
      }
    } catch (Exception e) {
      String errorMessage = "Error reading plugin editing page HTML file: " + filename;
      LeanRest.getInstance().getLog().logError(errorMessage, e);
      return Response.serverError().entity(errorMessage + "\n" + Const.getStackTracker(e)).build();
    }
  }
}
