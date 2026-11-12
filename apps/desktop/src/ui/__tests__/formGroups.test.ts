import { describe, expect, it } from "vitest";

import type { FieldDef } from "../../data/entity";
import { sectionsFor } from "../formGroups";

const f = (name: string): FieldDef => ({ name, label: name, type: "text" });

describe("form sections", () => {
  it("splits a known entity into titled sections and keeps the field order of each", () => {
    const fields = ["notes", "name", "kind", "email", "city", "vat_number"].map(f);
    const sections = sectionsFor("party", fields);
    expect(sections.map((s) => s.title)).toEqual([
      "Dati principali",
      "Dati fiscali",
      "Contatti",
      "Indirizzo",
      "Note",
    ]);
    expect(sections[0]?.fields.map((x) => x.name)).toEqual(["name", "kind"]);
  });

  it("never drops a field: the ones not listed go in a last section", () => {
    const sections = sectionsFor("party", ["name", "brand_new_field"].map(f));
    expect(sections.at(-1)).toMatchObject({ title: "Altro" });
    expect(sections.at(-1)?.fields.map((x) => x.name)).toEqual(["brand_new_field"]);
    const all = sections.flatMap((s) => s.fields.map((x) => x.name));
    expect(all.sort()).toEqual(["brand_new_field", "name"]);
  });

  it("leaves the other entities as one plain block", () => {
    const fields = ["a", "b"].map(f);
    expect(sectionsFor("ticket", fields)).toEqual([{ title: null, fields }]);
  });
});
