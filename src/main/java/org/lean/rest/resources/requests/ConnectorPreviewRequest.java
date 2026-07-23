package org.lean.rest.resources.requests;

/**
 * Request body for {@code POST edit/connector/preview/}: sample input/output rows from form state
 * (possibly unsaved).
 */
public class ConnectorPreviewRequest {

  /**
   * Full Hop-format connector JSON ({@code name}, {@code shared}, {@code connector.{PluginId}}),
   * same shape as {@code metadata/modify/connector}.
   */
  private String leanConnectorJson;

  /** Optional sample size (default 20, hard max 100). */
  private Integer maxRows;

  /**
   * Optional active presentation render id so presentation-local connectors participate in the data
   * context.
   */
  private String renderId;

  public ConnectorPreviewRequest() {}

  public String getLeanConnectorJson() {
    return leanConnectorJson;
  }

  public void setLeanConnectorJson(String leanConnectorJson) {
    this.leanConnectorJson = leanConnectorJson;
  }

  public Integer getMaxRows() {
    return maxRows;
  }

  public void setMaxRows(Integer maxRows) {
    this.maxRows = maxRows;
  }

  public String getRenderId() {
    return renderId;
  }

  public void setRenderId(String renderId) {
    this.renderId = renderId;
  }
}
