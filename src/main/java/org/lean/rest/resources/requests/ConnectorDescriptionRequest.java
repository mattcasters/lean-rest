package org.lean.rest.resources.requests;

public class ConnectorDescriptionRequest {
  private String renderId;
  private String connectorName;

  public ConnectorDescriptionRequest() {}

  /**
   * Gets renderId
   *
   * @return value of renderId
   */
  public String getRenderId() {
    return renderId;
  }

  /**
   * Sets renderId
   *
   * @param renderId value of renderId
   */
  public void setRenderId(String renderId) {
    this.renderId = renderId;
  }

  /**
   * Gets connectorName
   *
   * @return value of connectorName
   */
  public String getConnectorName() {
    return connectorName;
  }

  /**
   * Sets connectorName
   *
   * @param connectorName value of connectorName
   */
  public void setConnectorName(String connectorName) {
    this.connectorName = connectorName;
  }
}
