package org.lean.rest;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import org.apache.commons.io.FileUtils;
import org.apache.commons.io.IOUtils;
import org.apache.commons.lang3.StringUtils;
import org.apache.hop.core.Const;
import org.apache.hop.core.database.Database;
import org.apache.hop.core.database.DatabaseMeta;
import org.apache.hop.core.encryption.HopTwoWayPasswordEncoder;
import org.apache.hop.core.exception.HopException;
import org.apache.hop.core.logging.LogChannel;
import org.apache.hop.core.logging.LoggingObject;
import org.apache.hop.core.variables.IVariables;
import org.apache.hop.core.variables.Variables;
import org.apache.hop.metadata.api.IHopMetadata;
import org.apache.hop.metadata.api.IHopMetadataProvider;
import org.apache.hop.metadata.api.IHopMetadataSerializer;
import org.apache.hop.metadata.serializer.json.JsonMetadataProvider;
import org.lean.core.AggregationMethod;
import org.lean.core.LeanAttachment;
import org.lean.core.LeanColorRGB;
import org.lean.core.LeanDatabaseConnection;
import org.lean.core.LeanDimension;
import org.lean.core.LeanEnvironment;
import org.lean.core.LeanFact;
import org.lean.core.LeanFont;
import org.lean.core.LeanHorizontalAlignment;
import org.lean.core.LeanVerticalAlignment;
import org.lean.core.exception.LeanException;
import org.lean.presentation.LeanPresentation;
import org.lean.presentation.component.LeanComponent;
import org.lean.presentation.component.types.chart.LeanLineChartComponent;
import org.lean.presentation.component.types.label.LeanLabelComponent;
import org.lean.presentation.connector.LeanConnector;
import org.lean.presentation.connector.types.sampledata.LeanSampleDataConnector;
import org.lean.presentation.connector.types.sql.LeanSqlConnector;
import org.lean.presentation.layout.LeanLayout;
import org.lean.presentation.layout.LeanLayoutBuilder;
import org.lean.presentation.layout.LeanLayoutResults;
import org.lean.presentation.layout.LeanRenderPage;
import org.lean.presentation.page.LeanPage;
import org.lean.presentation.theme.LeanTheme;
import org.lean.presentation.variable.LeanParameter;
import org.lean.presentation.variable.LeanParameterMapping;
import org.lean.render.IRenderContext;
import org.lean.render.context.PresentationRenderContext;
import org.lean.rest.render.IRendering;

public class LeanRest {
  public static final String CONNECTOR_STEEL_WHEELS_NAME = "SteelWheels";

  private static LeanRest leanRest;
  private final LoggingObject loggingObject;
  private final IVariables variables;
  private final IHopMetadataProvider metadataProvider;
  private final LogChannel log;
  private final String metadataPath;
  private final boolean corsAllowOrigin;

  private IHopMetadataSerializer<LeanPresentation> presentationSerializer;
  private IHopMetadataSerializer<LeanDatabaseConnection> dbConnSerializer;
  private IHopMetadataSerializer<LeanTheme> themeSerializer;
  private IHopMetadataSerializer<IHopMetadata> metadataSerializer;

  private final Map<String, IRendering> renderCache;

  public LeanRest() {
    loggingObject = new LoggingObject("Lean Rest");
    log = new LogChannel("Lean Rest Server");
    renderCache = new HashMap<>();
    System.out.println("Initializing the LEAN environment.");
    try {
      LeanEnvironment.init();
    } catch (Exception e) {
      log.logError("Could not initialize the Lean environment", e);
    }
    log.logBasic("Starting the Lean REST services application.");
    Properties props = new Properties();
    String propertyPath;
    try {
      if (StringUtils.isEmpty(System.getProperty("LEAN_REST_CONFIG_PATH"))) {
        propertyPath = "/config";
      } else {
        propertyPath = System.getProperty("LEAN_REST_CONFIG_PATH");
      }
      String configFileName = propertyPath + "/leanrest.properties";
      log.logBasic("Finding configuration file: " + configFileName);

      File configFile = new File(configFileName);
      if (configFile.exists()) {
        log.logBasic("Found configuration file: " + configFileName);
        try (InputStream inputStream = new FileInputStream(configFile)) {
          props.load(inputStream);
          log.logBasic("Loaded configuration file: " + configFileName);
        }
      } else {
        log.logBasic("Unable to find config file " + configFileName);
        try (InputStream inputStream = getClass().getResourceAsStream("/leanrest.properties")) {
          if (inputStream == null) {
            throw new IOException("Unable to find configuration leanrest.properties");
          }
          props.load(inputStream);
        }
      }
    } catch (IOException e) {
      log.logError("Error initializing Lean Rest: ", e);
    }
    log.logBasic("Loading settings from configuration file.");

    metadataPath = props.getProperty("metadata.path");
    variables = Variables.getADefaultVariableSpace();
    metadataProvider =
        new JsonMetadataProvider(new HopTwoWayPasswordEncoder(), metadataPath, variables);
    corsAllowOrigin = Const.toBoolean(props.getProperty("cors.allow.origin"));

    log.logBasic("Found " + metadataProvider.getMetadataClasses().size() + " metadata types.");

    try {
      presentationSerializer = metadataProvider.getSerializer(LeanPresentation.class);
      dbConnSerializer = metadataProvider.getSerializer(LeanDatabaseConnection.class);
      themeSerializer = metadataProvider.getSerializer(LeanTheme.class);

      // createConnections();
      // createExecutionDetailsPresentation();
      // importPresentations();
    } catch (Exception e) {
      log.logError("Error creating presentation serializer: ", e);
    }
  }

  private void createExecutionDetailsPresentation() throws Exception {

    IHopMetadataSerializer<LeanConnector> serializer =
        metadataProvider.getSerializer(LeanConnector.class);

    // Create a presentation to list the available presentations
    //
    LeanPresentation presentation = new LeanPresentation();
    presentation.setName("execution-details");
    presentation.setDefaultThemeName(LeanTheme.getDefault().getName());

    // Map some parameters
    //
    LeanParameterMapping parameterMapping = new LeanParameterMapping();
    parameterMapping.setConnectorName("hop-execution-details");
    parameterMapping.setMappings(
        Arrays.asList(
            new LeanParameterMapping.FieldToParameterMapping("executionId", "EXECUTION_ID"),
            new LeanParameterMapping.FieldToParameterMapping("name", "EXECUTION_NAME"),
            new LeanParameterMapping.FieldToParameterMapping("executionType", "EXECUTION_TYPE"),
            new LeanParameterMapping.FieldToParameterMapping("filename", "EXECUTION_FILENAME"),
            new LeanParameterMapping.FieldToParameterMapping("loggingText", "EXECUTION_LOGGING")));

    presentation.getParameterMappings().add(parameterMapping);

    // Now these variables are available in all components
    //

    // Add one page
    LeanPage page = LeanPage.getA4(false);
    presentation.getPages().add(page);

    // Italic font
    //
    LeanFont italicFont = new LeanFont(LeanTheme.getDefault().getDefaultFont());
    italicFont.setItalic(true);

    // Add a few label components
    //
    int verticalMargin = 5;
    int horizontalMargin = 15;
    LeanLabelComponent idLabelComponent = new LeanLabelComponent("Execution ID: ");
    LeanComponent idLabel = new LeanComponent("label-execution-id", idLabelComponent);
    idLabel.setLayout(LeanLayout.topLeftPage());
    page.getComponents().add(idLabel);

    // ID
    //
    LeanLabelComponent idValueComponent = new LeanLabelComponent("${EXECUTION_ID}");
    LeanComponent idValue = new LeanComponent("value-execution-id", idValueComponent);
    idValue.setLayout(new LeanLayoutBuilder().beside(idLabel.getName(), horizontalMargin).build());
    page.getComponents().add(idValue);

    LeanLabelComponent nameLabelComponent = new LeanLabelComponent("Name: ");
    LeanComponent nameLabel = new LeanComponent("label-execution-name", nameLabelComponent);
    nameLabel.setLayout(
        new LeanLayoutBuilder().below(idLabel.getName(), verticalMargin).left().build());
    page.getComponents().add(nameLabel);

    // Name
    //
    LeanLabelComponent nameValueComponent = new LeanLabelComponent("${EXECUTION_NAME}");
    LeanComponent nameValue = new LeanComponent("value-execution-name", nameValueComponent);
    nameValue.setLayout(
        new LeanLayoutBuilder()
            .left(
                new LeanAttachment(
                    idLabel.getName(), 0, horizontalMargin, LeanAttachment.Alignment.RIGHT))
            .top(
                new LeanAttachment(
                    idLabel.getName(), 0, verticalMargin, LeanAttachment.Alignment.BOTTOM))
            .build());
    page.getComponents().add(nameValue);

    // Filename
    //
    LeanLabelComponent filenameLabelComponent = new LeanLabelComponent("Filename: ");
    LeanComponent filenameLabel =
        new LeanComponent("label-execution-filename", filenameLabelComponent);
    filenameLabel.setLayout(
        new LeanLayoutBuilder().below(nameLabel.getName(), verticalMargin).left().build());
    page.getComponents().add(filenameLabel);

    LeanLabelComponent filenameValueComponent = new LeanLabelComponent("${EXECUTION_FILENAME}");
    LeanComponent filenameValue =
        new LeanComponent("value-execution-filename", filenameValueComponent);
    filenameValue.setLayout(
        new LeanLayoutBuilder()
            .left(
                new LeanAttachment(
                    idLabel.getName(), 0, horizontalMargin, LeanAttachment.Alignment.RIGHT))
            .top(
                new LeanAttachment(
                    nameLabel.getName(), 0, verticalMargin, LeanAttachment.Alignment.BOTTOM))
            .build());
    page.getComponents().add(filenameValue);

    // Type
    //
    LeanLabelComponent typeLabelComponent = new LeanLabelComponent("Type: ");
    LeanComponent typeLabel = new LeanComponent("label-execution-type", typeLabelComponent);
    typeLabel.setLayout(
        new LeanLayoutBuilder().below(filenameLabel.getName(), verticalMargin).left().build());
    page.getComponents().add(typeLabel);

    LeanLabelComponent typeValueComponent = new LeanLabelComponent("${EXECUTION_TYPE}");
    LeanComponent typeValue = new LeanComponent("value-execution-type", typeValueComponent);
    typeValue.setLayout(
        new LeanLayoutBuilder()
            .left(
                new LeanAttachment(
                    idLabel.getName(), 0, horizontalMargin, LeanAttachment.Alignment.RIGHT))
            .top(
                new LeanAttachment(
                    filenameLabel.getName(), 0, verticalMargin, LeanAttachment.Alignment.BOTTOM))
            .build());
    page.getComponents().add(typeValue);

    // Execution duration trend
    //
    LeanLineChartComponent lineChartComponent =
        new LeanLineChartComponent("hop-list-execution-durations");
    lineChartComponent
        .getHorizontalDimensions()
        .add(
            new LeanDimension(
                "nr", "Execution", LeanHorizontalAlignment.CENTER, LeanVerticalAlignment.MIDDLE));
    lineChartComponent
        .getFacts()
        .add(
            new LeanFact(
                "duration",
                "ms",
                LeanHorizontalAlignment.CENTER,
                LeanVerticalAlignment.MIDDLE,
                AggregationMethod.SUM,
                "###,##0"));
    lineChartComponent.setDrawingCurvedTrendLine(true);
    lineChartComponent.setDotSize(3);
    lineChartComponent.setShowingLegend(true);
    lineChartComponent.setShowingHorizontalLabels(false);
    lineChartComponent.setShowingVerticalLabels(true);
    lineChartComponent.setLineWidth("1");
    lineChartComponent.setTitle("Execution duration trend (ms) for ${EXECUTION_NAME}");
    LeanComponent lineChart = new LeanComponent("execution-duration-trend", lineChartComponent);
    lineChart.setLayout(
        new LeanLayoutBuilder()
            .below(typeLabel.getName(), 2 * verticalMargin)
            .right(new LeanAttachment(null, 0, 600, LeanAttachment.Alignment.LEFT))
            .bottom(
                new LeanAttachment(typeLabel.getName(), 0, 400, LeanAttachment.Alignment.BOTTOM))
            .build());
    page.getComponents().add(lineChart);

    // Save the presentation
    presentationSerializer.save(presentation);
  }

  private void importPresentations() throws Exception {
    for (String filename :
        List.of("import/combo-test.json", "import/grouped-composite-test.json")) {
      try (InputStream inputStream = getClass().getClassLoader().getResourceAsStream(filename)) {
        String json = IOUtils.toString(inputStream, StandardCharsets.UTF_8);
        LeanPresentation presentation = LeanPresentation.fromJsonString(json);
        if (presentationSerializer.exists(presentation.getName())) {
          presentationSerializer.delete(presentation.getName());
        }
        presentationSerializer.save(presentation);
      }
    }
  }

  public static LeanRest getInstance() {
    if (leanRest == null) {
      leanRest = new LeanRest();
    }
    return leanRest;
  }

  public LeanPresentation loadPresentation(String presentationName)
      throws LeanException, HopException {
    LeanPresentation presentation = presentationSerializer.load(presentationName);
    if (presentation == null) {
      throw new LeanException("Unable to find presentation '" + presentationName + "'");
    }
    return presentation;
  }

  private List<LeanRenderPage> renderPresentation(String presentationName)
      throws LeanException, HopException {
    LeanPresentation presentation = loadPresentation(presentationName);
    IRenderContext renderContext = new PresentationRenderContext(presentation, metadataProvider);
    LeanLayoutResults layout =
        presentation.doLayout(
            loggingObject, renderContext, metadataProvider, Collections.emptyList());
    presentation.render(layout, metadataProvider);
    return layout.getRenderPages();
  }

  public String getPresentationSVG(String presentationName, int pageNumber)
      throws HopException, LeanException {
    log.logBasic("Loading presentation " + presentationName);

    List<LeanRenderPage> renderPages = renderPresentation(presentationName);
    return renderPages.get(pageNumber).getSvgXml();
  }

  public List<String> getComponentsAt(String presentationName, int pageNb, String posXY)
      throws HopException, LeanException {
    int posX = Integer.parseInt(posXY.split(",")[0]);
    int posY = Integer.parseInt(posXY.split(",")[1]);

    List<LeanRenderPage> renderPages = renderPresentation(presentationName);
    LeanRenderPage renderPage = renderPages.get(pageNb);

    return renderPage.lookupComponentName(posX, posY);
  }

  private void createConnections() throws HopException {
    LeanDatabaseConnection connection2 =
        new LeanDatabaseConnection(
            "logging", "POSTGRESQL", "localhost", "5432", "logging", "postgres", "postgres");
    String h2DatabaseName =
        System.getProperty("java.io.tmpdir") + File.separator + CONNECTOR_STEEL_WHEELS_NAME;

    LeanDatabaseConnection swConnection =
        new LeanDatabaseConnection(
            CONNECTOR_STEEL_WHEELS_NAME, "H2", null, null, h2DatabaseName, null, null);

    try {
      dbConnSerializer.save(connection2);
      dbConnSerializer.save(swConnection);
    } catch (HopException e) {
      log.logError("Error saving dummy connections: " + e.getMessage());
    }

    try {
      // Delete old database
      //
      File[] files =
          new File(System.getProperty("java.io.tmpdir"))
              .listFiles(
                  pathname ->
                      pathname.toString().endsWith(".db")
                          && pathname.toString().contains(CONNECTOR_STEEL_WHEELS_NAME));
      for (File file : files) {
        FileUtils.forceDelete(file);
      }

      // Read the script
      //
      List<String> lines =
          Files.readAllLines(
              Paths.get(getClass().getClassLoader().getResource("steelwheels.script").getPath()));

      DatabaseMeta databaseMeta = swConnection.createDatabaseMeta();
      databaseMeta.setForcingIdentifiersToUpperCase(true);
      try (Database database =
          new Database(new LoggingObject(swConnection.getName()), variables, databaseMeta)) {
        database.connect();
        for (String line : lines) {
          database.execStatement(line);
        }
      }

      // Also create some Lean connectors
      //
      LeanSqlConnector territoriesConnector =
          new LeanSqlConnector(
              "SteelWheels",
              "select coalesce(territory, 'UNKNOWN') as territory, count(*) as cnt "
                  + "from customer_w_ter "
                  + "group by territory "
                  + "order by 1 asc; ");
      LeanConnector territories = new LeanConnector("territories", territoriesConnector);
      metadataProvider.getSerializer(LeanConnector.class).save(territories);

      LeanSampleDataConnector sampleDataConnector = new LeanSampleDataConnector(100);
      LeanConnector sampleData = new LeanConnector("Sample Data", sampleDataConnector);
      metadataProvider.getSerializer(LeanConnector.class).save(sampleData);

    } catch (Exception e) {
      throw new HopException("Error saving connections", e);
    }
    log.logDetailed("Steel Wheels database created");
  }

  private void createTestThemes() throws HopException {

    LeanFont theme1Font = new LeanFont("Arial", "14", false, false);
    LeanFont title1Font = new LeanFont("Arial", "20", true, true);
    LeanColorRGB t1C1 = new LeanColorRGB(255, 200, 200);
    LeanColorRGB t1C2 = new LeanColorRGB(250, 210, 210);
    LeanColorRGB t1C3 = new LeanColorRGB(180, 180, 180);
    LeanColorRGB t1C4 = new LeanColorRGB(200, 100, 100);

    LeanTheme theme1 = new LeanTheme();
    theme1.setName("First Theme");
    theme1.setDefaultFont(theme1Font);
    theme1.setDefaultColor(t1C1);
    theme1.setBorderColor(t1C2);
    theme1.setTitleFont(title1Font);
    theme1.setBorderColor(t1C3);
    theme1.setTitleColor(t1C4);
    theme1.setColors(Arrays.asList(t1C1, t1C2, t1C3, t1C4));

    LeanFont theme2Font = new LeanFont("Arial", "14", false, false);
    LeanFont title2Font = new LeanFont("Arial", "20", true, true);
    LeanColorRGB t2C1 = new LeanColorRGB(200, 200, 244);
    LeanColorRGB t2C2 = new LeanColorRGB(200, 210, 255);
    LeanColorRGB t2C3 = new LeanColorRGB(180, 180, 250);
    LeanColorRGB t2C4 = new LeanColorRGB(100, 100, 250);

    LeanTheme theme2 = new LeanTheme();
    theme2.setName("Second Theme");
    theme2.setDefaultFont(theme2Font);
    theme2.setDefaultColor(t2C1);
    theme2.setBorderColor(t2C2);
    theme2.setTitleFont(title2Font);
    theme2.setBorderColor(t2C3);
    theme2.setTitleColor(t2C4);
    theme2.setColors(Arrays.asList(t2C1, t2C2, t2C3, t2C4));

    try {
      themeSerializer.save(theme1);
      themeSerializer.save(theme2);
    } catch (HopException e) {
      throw new HopException("Error saving test themes", e);
    }
  }

  public void storeRendering(IRendering rendering) {
    renderCache.put(rendering.getId(), rendering);
  }

  public void removeRendering(IRendering rendering) {
    renderCache.remove(rendering.getId());
  }

  public IRendering getRendering(String id) {
    return renderCache.get(id);
  }

  public IRendering findRendering(String presentationName, List<LeanParameter> parameters) {
    for (IRendering rendering : renderCache.values()) {
      if (presentationName.equals(rendering.getPresentationName())) {
        // Verify that the parameters are all the same with the same values.
        //
        if (rendering.getParameters().size() != parameters.size()) {
          return null; // different rendering
        }
        for (int i = 0; i < parameters.size(); i++) {
          if (!parameters.get(i).equals(rendering.getParameters().get(i))) {
            return null;
          }
        }
        return rendering;
      }
    }
    return null;
  }

  /**
   * Sets leanRest
   *
   * @param leanRest value of leanRest
   */
  public static void setLeanUtil(LeanRest leanRest) {
    LeanRest.leanRest = leanRest;
  }

  /**
   * Gets loggingObject
   *
   * @return value of loggingObject
   */
  public LoggingObject getLoggingObject() {
    return loggingObject;
  }

  /**
   * Gets variables
   *
   * @return value of variables
   */
  public IVariables getVariables() {
    return variables;
  }

  /**
   * Gets metadataProvider
   *
   * @return value of metadataProvider
   */
  public IHopMetadataProvider getMetadataProvider() {
    return metadataProvider;
  }

  /**
   * Gets log
   *
   * @return value of log
   */
  public LogChannel getLog() {
    return log;
  }

  /**
   * Gets metadataPath
   *
   * @return value of metadataPath
   */
  public String getMetadataPath() {
    return metadataPath;
  }

  /**
   * Gets presentationSerializer
   *
   * @return value of presentationSerializer
   */
  public IHopMetadataSerializer<LeanPresentation> getPresentationSerializer() {
    return presentationSerializer;
  }

  /**
   * Sets presentationSerializer
   *
   * @param presentationSerializer value of presentationSerializer
   */
  public void setPresentationSerializer(
      IHopMetadataSerializer<LeanPresentation> presentationSerializer) {
    this.presentationSerializer = presentationSerializer;
  }

  /**
   * Gets dbConnSerializer
   *
   * @return value of dbConnSerializer
   */
  public IHopMetadataSerializer<LeanDatabaseConnection> getDbConnSerializer() {
    return dbConnSerializer;
  }

  /**
   * Sets dbConnSerializer
   *
   * @param dbConnSerializer value of dbConnSerializer
   */
  public void setDbConnSerializer(IHopMetadataSerializer<LeanDatabaseConnection> dbConnSerializer) {
    this.dbConnSerializer = dbConnSerializer;
  }

  /**
   * Gets themeSerializer
   *
   * @return value of themeSerializer
   */
  public IHopMetadataSerializer<LeanTheme> getThemeSerializer() {
    return themeSerializer;
  }

  /**
   * Sets themeSerializer
   *
   * @param themeSerializer value of themeSerializer
   */
  public void setThemeSerializer(IHopMetadataSerializer<LeanTheme> themeSerializer) {
    this.themeSerializer = themeSerializer;
  }

  /**
   * Gets metadataSerializer
   *
   * @return value of metadataSerializer
   */
  public IHopMetadataSerializer<IHopMetadata> getMetadataSerializer() {
    return metadataSerializer;
  }

  /**
   * Sets metadataSerializer
   *
   * @param metadataSerializer value of metadataSerializer
   */
  public void setMetadataSerializer(IHopMetadataSerializer<IHopMetadata> metadataSerializer) {
    this.metadataSerializer = metadataSerializer;
  }

  /**
   * Gets corsAllowOrigin
   *
   * @return value of corsAllowOrigin
   */
  public boolean isCorsAllowOrigin() {
    return corsAllowOrigin;
  }
}
