import { invoke } from "@tauri-apps/api/core";

import {
  createDatabase,
  type Database,
  type ExecResult,
  type Param,
  type RawDriver,
  type Row,
} from "./db";

/** The encrypted database in the desktop shell. */
export function nativeDriver(): RawDriver {
  return {
    kind: "native",
    query: (sql: string, params: Param[]) => invoke<Row[]>("db_query", { sql, params }),
    execute: async (sql: string, params: Param[]) => {
      const result = await invoke<{ changes: number; last_insert_rowid: number }>("db_execute", {
        sql,
        params,
      });
      return {
        changes: result.changes,
        lastInsertRowid: result.last_insert_rowid,
      } satisfies ExecResult;
    },
    close: async () => undefined, // the shell owns the connection for the life of the app
  };
}

/** A transaction left open by a reload would block everything; the shell rolls it back. */
export async function openNativeDatabase(): Promise<Database> {
  await invoke<boolean>("db_reset");
  return createDatabase(nativeDriver());
}
