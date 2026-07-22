package org.lean.rest.resources.requests;

import java.util.ArrayList;
import java.util.List;
import org.lean.presentation.variable.LeanParameter;

public class RenderPresentationRequest {
  private String presentationName;
  private List<LeanParameter> parameters;
  private boolean reload;

  public RenderPresentationRequest() {
    this.parameters = new ArrayList<>();
  }

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
   * Gets parameters
   *
   * @return value of parameters
   */
  public List<LeanParameter> getParameters() {
    return parameters;
  }

  /**
   * Sets parameters
   *
   * @param parameters value of parameters
   */
  public void setParameters(List<LeanParameter> parameters) {
    this.parameters = parameters;
  }

  /**
   * Gets reload
   *
   * @return value of reload
   */
  public boolean isReload() {
    return reload;
  }

  /**
   * Sets reload
   *
   * @param reload value of reload
   */
  public void setReload(boolean reload) {
    this.reload = reload;
  }
}
