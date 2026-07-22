package org.lean.rest.resources.responses;

import java.util.ArrayList;
import java.util.List;
import org.apache.hop.core.row.IRowMeta;
import org.apache.hop.core.row.IValueMeta;

public class RowMetaResponse {
  private List<ValueMetaResponse> valueMetaList;

  public RowMetaResponse() {
    this.valueMetaList = new ArrayList<>();
  }

  public RowMetaResponse(IRowMeta rowMeta) {
    this();
    for (IValueMeta valueMeta : rowMeta.getValueMetaList()) {
      this.valueMetaList.add(new ValueMetaResponse(valueMeta));
    }
  }

  /**
   * Gets valueMetaList
   *
   * @return value of valueMetaList
   */
  public List<ValueMetaResponse> getValueMetaList() {
    return valueMetaList;
  }

  /**
   * Sets valueMetaList
   *
   * @param valueMetaList value of valueMetaList
   */
  public void setValueMetaList(List<ValueMetaResponse> valueMetaList) {
    this.valueMetaList = valueMetaList;
  }

  public static final class ValueMetaResponse {
    private String name;
    private String type;
    private int length;
    private int precision;

    public ValueMetaResponse() {}

    public ValueMetaResponse(IValueMeta v) {
      this();
      this.name = v.getName();
      this.type = v.getTypeDesc();
      this.length = v.getLength();
      this.precision = v.getPrecision();
    }

    /**
     * Gets name
     *
     * @return value of name
     */
    public String getName() {
      return name;
    }

    /**
     * Sets name
     *
     * @param name value of name
     */
    public void setName(String name) {
      this.name = name;
    }

    /**
     * Gets type
     *
     * @return value of type
     */
    public String getType() {
      return type;
    }

    /**
     * Sets type
     *
     * @param type value of type
     */
    public void setType(String type) {
      this.type = type;
    }

    /**
     * Gets length
     *
     * @return value of length
     */
    public int getLength() {
      return length;
    }

    /**
     * Sets length
     *
     * @param length value of length
     */
    public void setLength(int length) {
      this.length = length;
    }

    /**
     * Gets precision
     *
     * @return value of precision
     */
    public int getPrecision() {
      return precision;
    }

    /**
     * Sets precision
     *
     * @param precision value of precision
     */
    public void setPrecision(int precision) {
      this.precision = precision;
    }
  }
}
