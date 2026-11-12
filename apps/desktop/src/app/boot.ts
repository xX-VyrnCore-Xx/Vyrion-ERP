import type { Database } from "../data/db";
import { openNativeDatabase } from "../data/nativeDriver";
import { Workspace } from "../data/workspace";
import { inDesktop } from "../lib/native";
import { ALL_ENTITIES, businessMigrations } from "../modules";
import { seedDefaults } from "../modules/seed";

export interface Booted {
  ws: Workspace;
  /** True when running in a browser without the desktop shell: data is not saved. */
  volatile: boolean;
}

async function openDatabase(): Promise<{ db: Database; volatile: boolean }> {
  if (inDesktop()) return { db: await openNativeDatabase(), volatile: false };
  if (import.meta.env.DEV) {
    const { openDevDatabase } = await import("./devDatabase");
    return { db: await openDevDatabase(), volatile: true };
  }
  throw new Error("Vyrion ERP funziona solo nell'applicazione desktop.");
}

export async function boot(): Promise<Booted> {
  const { db, volatile } = await openDatabase();
  const ws = await Workspace.open({ db, entities: ALL_ENTITIES, migrations: businessMigrations });
  await seedDefaults(ws);
  // Development only: `?demo` fills the in-memory database with sample data.
  if (import.meta.env.DEV && volatile && window.location.search.includes("demo")) {
    const { seedDemo } = await import("./demoData");
    await seedDemo(ws);
  }
  return { ws, volatile };
}
