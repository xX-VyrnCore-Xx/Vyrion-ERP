import { describe, expect, it } from "vitest";

import type { FieldDef } from "../../data/entity";
import { layoutFields, naturalSpan } from "../formLayout";

const f = (
  name: string,
  type: FieldDef["type"] = "text",
  extra: Partial<FieldDef> = {},
): FieldDef => ({
  name,
  label: name,
  type,
  ...extra,
});
const spans = (fields: FieldDef[]) =>
  layoutFields(fields).map((p) => Number(/sm:col-span-(\d+)/.exec(p.className)?.[1]));

describe("form layout", () => {
  it("gives a field its width from what it holds", () => {
    expect(naturalSpan(f("name"))).toBe(12);
    expect(naturalSpan(f("anything", "longtext"))).toBe(12);
    expect(naturalSpan(f("zip"))).toBe(4);
    expect(naturalSpan(f("when", "date"))).toBe(4);
    expect(naturalSpan(f("code", "text", { maxLength: 6 }))).toBe(4);
    expect(naturalSpan(f("kind", "select"))).toBe(6);
  });

  it("fills every row to twelve columns, so none ends with a hole", () => {
    const rows = [
      [f("name")],
      [f("kind", "select"), f("legal", "select")],
      [f("sdi_code"), f("pec")],
      [f("zip"), f("city")],
      [f("province"), f("country")],
      [f("a", "money"), f("b", "money"), f("c", "money")],
      [f("lonely", "date")],
    ];
    for (const row of rows) expect(spans(row).reduce((a, b) => a + b, 0)).toBe(12);
    expect(spans([f("sdi_code"), f("pec")])).toEqual([4, 8]);
    expect(spans([f("zip"), f("city")])).toEqual([4, 8]);
  });

  it("wraps to a new row when the next field does not fit, and stays whole on a phone", () => {
    const placed = layoutFields([f("a", "select"), f("b", "select"), f("c", "select")]);
    expect(placed).toHaveLength(3);
    expect(spans([f("a", "select"), f("b", "select"), f("c", "select")])).toEqual([6, 6, 12]);
    for (const p of placed) expect(p.className.startsWith("col-span-12 ")).toBe(true);
  });
});
