package org.lean.rest.resources.requests;

public class ModifyComponentRequest {
  private String presentationName;
  private String oldComponentName;
  private int logicalPageNumber;
  private String leanComponentJson;

  public ModifyComponentRequest() {}

  /**
   * Gets presentationName
   *
   * @return value of presentationName
   */
  public String getPresentationName() {
    return presentationName;
  }

  /**
   * Sets presentationName
   *
   * @param presentationName value of presentationName
   */
  public void setPresentationName(String presentationName) {
    this.presentationName = presentationName;
  }

  /**
   * Gets oldComponentName
   *
   * @return value of oldComponentName
   */
  public String getOldComponentName() {
    return oldComponentName;
  }

  /**
   * Sets oldComponentName
   *
   * @param oldComponentName value of oldComponentName
   */
  public void setOldComponentName(String oldComponentName) {
    this.oldComponentName = oldComponentName;
  }

  /**
   * Gets logicalPageNumber
   *
   * @return value of logicalPageNumber
   */
  public int getLogicalPageNumber() {
    return logicalPageNumber;
  }

  /**
   * Sets logicalPageNumber
   *
   * @param logicalPageNumber value of logicalPageNumber
   */
  public void setLogicalPageNumber(int logicalPageNumber) {
    this.logicalPageNumber = logicalPageNumber;
  }

  /**
   * Gets leanComponentJson
   *
   * @return value of leanComponentJson
   */
  public String getLeanComponentJson() {
    return leanComponentJson;
  }

  /**
   * Sets leanComponentJson
   *
   * @param leanComponentJson value of leanComponentJson
   */
  public void setLeanComponentJson(String leanComponentJson) {
    this.leanComponentJson = leanComponentJson;
  }
}
