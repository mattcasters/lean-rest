package org.lean.rest;

import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerResponseContext;
import jakarta.ws.rs.container.ContainerResponseFilter;
import jakarta.ws.rs.ext.Provider;

@Provider
public class LeanCorsFilter implements ContainerResponseFilter {

  private static final LeanRest leanRest = LeanRest.getInstance();

  @Override
  public void filter(
      ContainerRequestContext requestContext, ContainerResponseContext responseContext) {
    if (leanRest.isCorsAllowOrigin()) {
      responseContext.getHeaders().add("Access-Control-Allow-Origin", "*");
    }
  }
}
