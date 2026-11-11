import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { openMemoryDatabase } from "../data/memoryDriver";
import { Workspace } from "../data/workspace";
import { ALL_ENTITIES, businessMigrations } from "../modules";
import { saveCompany } from "../modules/company";
import { seedDefaults } from "../modules/seed";

const wasmDir = dirname(createRequire(import.meta.url).resolve("sql.js"));

/** A fresh in-memory company file with the real schema and reference data. */
export async function testWorkspace(
  regime: "ordinario" | "forfettario" = "ordinario",
  clock?: () => Date,
) {
  const db = await openMemoryDatabase((file) => join(wasmDir, file));
  const ws = await Workspace.open({
    db,
    entities: ALL_ENTITIES,
    migrations: businessMigrations,
    ...(clock ? { clock } : {}),
  });
  await saveCompany(
    db,
    { name: "VyrnCore Test", legal_form: "srl", regime, vat_number: "01234567897" },
    ws.ctx.now(),
  );
  await seedDefaults(ws);
  return ws;
}
