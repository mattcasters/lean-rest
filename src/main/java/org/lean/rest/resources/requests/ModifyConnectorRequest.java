package org.lean.rest.resources.requests;

/** Request body for saving a connector metadata element after form edit. */
public class ModifyConnectorRequest {
  /** Previous name (for renames / delete-old). */
  private String oldConnectorName;

  /** Full LeanConnector JSON (name, shared, connector.{pluginId}). */
  private String leanConnectorJson;

  public ModifyConnectorRequest() {}

  public String getOldConnectorName() {
    return oldConnectorName;
  }

  public void setOldConnectorName(String oldConnectorName) {
    this.oldConnectorName = oldConnectorName;
  }

  public String getLeanConnectorJson() {
    return leanConnectorJson;
  }

  public void setLeanConnectorJson(String leanConnectorJson) {
    this.leanConnectorJson = leanConnectorJson;
  }
}
