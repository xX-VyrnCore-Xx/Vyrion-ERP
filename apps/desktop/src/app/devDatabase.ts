import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";

import type { Database } from "../data/db";
import { openMemoryDatabase } from "../data/memoryDriver";

/** Browser development only: an in-memory database that is lost on reload. */
export function openDevDatabase(): Promise<Database> {
  return openMemoryDatabase(() => wasmUrl);
}
