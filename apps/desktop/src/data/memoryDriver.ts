import initSqlJs, { type Database as SqlJsDatabase, type SqlValue } from "sql.js";

import { createDatabase, type Database, type Param, type RawDriver, type Row } from "./db";

type Locate = (file: string) => string;

/**
 * An in-memory SQLite (the real engine, compiled to WebAssembly). Used by the tests and
 * when the app runs in a plain browser during development: it never persists anything.
 */
export async function memoryDriver(locateFile?: Locate): Promise<RawDriver> {
  const SQL = await initSqlJs(locateFile ? { locateFile } : {});
  const db: SqlJsDatabase = new SQL.Database();
  db.run("PRAGMA foreign_keys = ON");

  const bind = (params: Param[]): SqlValue[] =>
    params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p));

  return {
    kind: "memory",
    async query(sql, params) {
      const statement = db.prepare(sql);
      try {
        statement.bind(bind(params));
        const rows: Row[] = [];
        while (statement.step()) rows.push(statement.getAsObject() as Row);
        return rows;
      } finally {
        statement.free();
      }
    },
    async execute(sql, params) {
      db.run(sql, bind(params));
      const changes = db.getRowsModified();
      const rowid = db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0];
      return { changes, lastInsertRowid: Number(rowid ?? 0) };
    },
    async close() {
      db.close();
    },
  };
}

export async function openMemoryDatabase(locateFile?: Locate): Promise<Database> {
  return createDatabase(await memoryDriver(locateFile));
}
