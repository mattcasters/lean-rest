package org.lean.rest.resources;

import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.apache.commons.lang3.StringUtils;
import org.lean.core.exception.LeanException;
import org.lean.presentation.LeanPresentation;
import org.lean.presentation.component.LeanComponent;
import org.lean.presentation.component.type.ILeanComponent;
import org.lean.presentation.component.types.composite.LeanCompositeComponent;
import org.lean.presentation.component.types.group.LeanGroupComponent;
import org.lean.presentation.page.LeanPage;

/**
 * Resolve presentation components by real metadata name or by synthetic drawn-item names produced
 * by Group / Composite layout:
 *
 * <pre>
 *   Group-group#1:Composite1
 *   Group-group#1:Composite1-child(Label1)
 * </pre>
 *
 * Returns the <b>template</b> {@link LeanComponent} in the presentation metadata (not the runtime
 * copy), plus enough parent context to replace it on save.
 */
public final class ComponentLookup {

  private ComponentLookup() {}

  public static final class Found {
    public final LeanComponent component;
    /** Logical body page index, or -1 for header/footer. */
    public final int logicalPageNumber;
    public final String pageRole;
    /** Page (or header/footer page) that owns the top-level tree. */
    public final LeanPage page;
    /**
     * Parent {@link LeanComponent} when nested; null if {@link #component} is top-level on the
     * page.
     */
    public final LeanComponent parentComponent;
    /** True when this component is a group's {@code groupComponent} template. */
    public final boolean groupTemplate;
    /** Index in composite children when nested under a composite; -1 otherwise. */
    public final int childIndex;

    public Found(
        LeanComponent component,
        int logicalPageNumber,
        String pageRole,
        LeanPage page,
        LeanComponent parentComponent,
        boolean groupTemplate,
        int childIndex) {
      this.component = component;
      this.logicalPageNumber = logicalPageNumber;
      this.pageRole = pageRole;
      this.page = page;
      this.parentComponent = parentComponent;
      this.groupTemplate = groupTemplate;
      this.childIndex = childIndex;
    }
  }

  /**
   * Find a component by drawn or metadata name on the preferred page, then header/footer, then all
   * body pages.
   */
  public static Found find(
      LeanPresentation presentation, LeanPage preferredPage, String componentName)
      throws LeanException {
    if (StringUtils.isBlank(componentName)) {
      return null;
    }
    if (preferredPage != null) {
      Found f = findOnPage(preferredPage, componentName, indexOf(presentation, preferredPage), roleOf(preferredPage, presentation));
      if (f != null) {
        return f;
      }
    }
    if (presentation == null) {
      return null;
    }
    if (presentation.getHeader() != null) {
      Found f = findOnPage(presentation.getHeader(), componentName, -1, "header");
      if (f != null) {
        return f;
      }
    }
    if (presentation.getFooter() != null) {
      Found f = findOnPage(presentation.getFooter(), componentName, -1, "footer");
      if (f != null) {
        return f;
      }
    }
    List<LeanPage> pages = presentation.getPages();
    if (pages != null) {
      for (int i = 0; i < pages.size(); i++) {
        Found f = findOnPage(pages.get(i), componentName, i, "page");
        if (f != null) {
          return f;
        }
      }
    }
    return null;
  }

  public static Found findOnPage(
      LeanPage page, String componentName, int logicalPageNumber, String pageRole)
      throws LeanException {
    if (page == null || page.getComponents() == null) {
      return null;
    }
    for (LeanComponent top : page.getComponents()) {
      if (top == null) {
        continue;
      }
      // Exact top-level match
      if (componentName.equalsIgnoreCase(top.getName())) {
        return new Found(top, logicalPageNumber, pageRole, page, null, false, -1);
      }
      // Nested template by exact name (e.g. "Label1" inside composite)
      Found deep = findNestedByTemplateName(top, null, false, -1, componentName, logicalPageNumber, pageRole, page);
      if (deep != null) {
        return deep;
      }
      // Synthetic drawn name under this top-level root
      Found drawn =
          matchDrawn(top, top.getName(), null, false, -1, componentName, logicalPageNumber, pageRole, page);
      if (drawn != null) {
        return drawn;
      }
    }
    return null;
  }

  /**
   * Search nested templates by their metadata names (unique enough for simple presentations).
   */
  private static Found findNestedByTemplateName(
      LeanComponent node,
      LeanComponent parent,
      boolean groupTemplate,
      int childIndex,
      String name,
      int logicalPageNumber,
      String pageRole,
      LeanPage page) {
    if (node == null) {
      return null;
    }
    ILeanComponent impl = node.getComponent();
    if (impl instanceof LeanGroupComponent group) {
      LeanComponent template = group.getGroupComponent();
      if (template != null) {
        if (name.equalsIgnoreCase(template.getName())) {
          return new Found(template, logicalPageNumber, pageRole, page, node, true, -1);
        }
        Found f =
            findNestedByTemplateName(
                template, node, true, -1, name, logicalPageNumber, pageRole, page);
        if (f != null) {
          return f;
        }
      }
    }
    if (impl instanceof LeanCompositeComponent composite
        && composite.getChildren() != null) {
      List<LeanComponent> children = composite.getChildren();
      for (int i = 0; i < children.size(); i++) {
        LeanComponent child = children.get(i);
        if (child != null && name.equalsIgnoreCase(child.getName())) {
          return new Found(child, logicalPageNumber, pageRole, page, node, false, i);
        }
        Found f =
            findNestedByTemplateName(
                child, node, false, i, name, logicalPageNumber, pageRole, page);
        if (f != null) {
          return f;
        }
      }
    }
    return null;
  }

  /**
   * Match synthetic runtime names produced by Group/Composite processSourceData.
   *
   * @param meta the template component in metadata
   * @param runtimeName the name this template would have at this nesting level when drawn
   */
  private static Found matchDrawn(
      LeanComponent meta,
      String runtimeName,
      LeanComponent parent,
      boolean groupTemplate,
      int childIndex,
      String drawnName,
      int logicalPageNumber,
      String pageRole,
      LeanPage page) {
    if (meta == null || runtimeName == null) {
      return null;
    }
    if (runtimeName.equals(drawnName)) {
      return new Found(meta, logicalPageNumber, pageRole, page, parent, groupTemplate, childIndex);
    }
    if (!drawnName.startsWith(runtimeName)) {
      return null;
    }

    ILeanComponent impl = meta.getComponent();
    if (impl instanceof LeanGroupComponent group && group.getGroupComponent() != null) {
      LeanComponent template = group.getGroupComponent();
      // runtimeName-group#N:templateName...
      Pattern p =
          Pattern.compile(
              "^"
                  + Pattern.quote(runtimeName)
                  + "-group#(\\d+):"
                  + Pattern.quote(template.getName())
                  + "(.*)$");
      Matcher m = p.matcher(drawnName);
      if (m.matches()) {
        String rowRuntime =
            runtimeName + "-group#" + m.group(1) + ":" + template.getName();
        // rest is empty or continues with -child(...)
        return matchDrawn(
            template,
            rowRuntime,
            meta,
            true,
            -1,
            drawnName,
            logicalPageNumber,
            pageRole,
            page);
      }
    }

    if (impl instanceof LeanCompositeComponent composite
        && composite.getChildren() != null) {
      List<LeanComponent> children = composite.getChildren();
      for (int i = 0; i < children.size(); i++) {
        LeanComponent child = children.get(i);
        if (child == null || child.getName() == null) {
          continue;
        }
        String childRuntime = runtimeName + "-child(" + child.getName() + ")";
        if (drawnName.equals(childRuntime) || drawnName.startsWith(childRuntime)) {
          Found f =
              matchDrawn(
                  child,
                  childRuntime,
                  meta,
                  false,
                  i,
                  drawnName,
                  logicalPageNumber,
                  pageRole,
                  page);
          if (f != null) {
            return f;
          }
        }
      }
    }
    return null;
  }

  /**
   * Replace {@code old} with {@code replacement} in the presentation structure described by {@code
   * found}.
   */
  public static void replace(Found found, LeanComponent replacement) throws LeanException {
    if (found == null || replacement == null) {
      throw new LeanException("Cannot replace null component");
    }
    if (found.parentComponent == null) {
      // Top-level on page
      List<LeanComponent> list = found.page.getComponents();
      int idx = list.indexOf(found.component);
      if (idx < 0) {
        // identity may differ after load — match by name
        for (int i = 0; i < list.size(); i++) {
          if (found.component.getName() != null
              && found.component.getName().equalsIgnoreCase(list.get(i).getName())) {
            idx = i;
            break;
          }
        }
      }
      if (idx < 0) {
        throw new LeanException(
            "Unable to find top-level component '" + found.component.getName() + "' to replace");
      }
      list.set(idx, replacement);
      return;
    }

    ILeanComponent parentImpl = found.parentComponent.getComponent();
    if (found.groupTemplate && parentImpl instanceof LeanGroupComponent group) {
      group.setGroupComponent(replacement);
      return;
    }
    if (!found.groupTemplate && parentImpl instanceof LeanCompositeComponent composite) {
      List<LeanComponent> children = composite.getChildren();
      if (found.childIndex >= 0 && found.childIndex < children.size()) {
        children.set(found.childIndex, replacement);
        return;
      }
      // fallback by name
      for (int i = 0; i < children.size(); i++) {
        if (found.component.getName() != null
            && found.component.getName().equalsIgnoreCase(children.get(i).getName())) {
          children.set(i, replacement);
          return;
        }
      }
      throw new LeanException(
          "Unable to find composite child '" + found.component.getName() + "' to replace");
    }
    throw new LeanException(
        "Unsupported parent type for nested component replace: "
            + (parentImpl != null ? parentImpl.getClass().getSimpleName() : "null"));
  }

  private static int indexOf(LeanPresentation presentation, LeanPage page) {
    if (presentation == null || page == null || presentation.getPages() == null) {
      return -1;
    }
    for (int i = 0; i < presentation.getPages().size(); i++) {
      if (presentation.getPages().get(i) == page) {
        return i;
      }
    }
    return presentation.getPages().isEmpty() ? -1 : 0;
  }

  private static String roleOf(LeanPage page, LeanPresentation presentation) {
    if (page == null) {
      return "page";
    }
    if (page.isHeader()
        || (presentation != null && presentation.getHeader() == page)) {
      return "header";
    }
    if (page.isFooter()
        || (presentation != null && presentation.getFooter() == page)) {
      return "footer";
    }
    return "page";
  }
}
