import type { Database } from "./db";
import { AppError } from "./errors";

export interface Migration {
  id: number;
  name: string;
  statements: string[];
}

export class MigrationError extends AppError {
  constructor(message: string) {
    super(message, "migration");
  }
}

async function checksum(statements: string[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(statements));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Brings the database to the latest schema. Each migration runs in its own transaction and
 * is recorded with a checksum; an already-applied migration whose text changed, or a
 * database that has migrations this version of the app does not know, is refused rather
 * than guessed at.
 */
export async function runMigrations(db: Database, migrations: Migration[]): Promise<number[]> {
  migrations.forEach((m, index) => {
    if (m.id !== index + 1) {
      throw new MigrationError(
        `Le migrazioni devono essere numerate da 1 senza salti (trovata ${m.id})`,
      );
    }
  });

  await db.execute(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       id INTEGER PRIMARY KEY,
       name TEXT NOT NULL,
       checksum TEXT NOT NULL,
       applied_at TEXT NOT NULL
     )`,
  );
  const applied = await db.query<{ id: number; checksum: string }>(
    "SELECT id, checksum FROM schema_migrations ORDER BY id",
  );

  const known = new Map(migrations.map((m) => [m.id, m]));
  for (const row of applied) {
    const migration = known.get(row.id);
    if (!migration) {
      throw new MigrationError(
        "Questo database è stato creato da una versione più recente dell'applicazione. Aggiorna Vyrion ERP.",
      );
    }
    if ((await checksum(migration.statements)) !== row.checksum) {
      throw new MigrationError(
        `La migrazione ${row.id} (${migration.name}) è stata modificata dopo essere stata applicata`,
      );
    }
  }

  const done = new Set(applied.map((r) => r.id));
  const appliedNow: number[] = [];
  for (const migration of migrations) {
    if (done.has(migration.id)) continue;
    const sum = await checksum(migration.statements);
    await db.transaction(async (tx) => {
      for (const statement of migration.statements) await tx.execute(statement);
      await tx.execute(
        "INSERT INTO schema_migrations (id, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
        [migration.id, migration.name, sum, new Date().toISOString()],
      );
    });
    appliedNow.push(migration.id);
  }
  return appliedNow;
}
