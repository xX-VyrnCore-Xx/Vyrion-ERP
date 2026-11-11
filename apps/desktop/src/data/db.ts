/**
 * The database as the rest of the app sees it. One implementation talks to the encrypted
 * SQLite engine in the Tauri shell; another is an in-memory SQLite used in tests and in
 * browser development. Both run the very same SQL.
 */

export type Param = string | number | boolean | null;
export type Row = Record<string, string | number | null>;

export interface ExecResult {
  changes: number;
  lastInsertRowid: number;
}

/** What can run statements: the database itself, or a transaction on it. */
export interface SqlRunner {
  query<T extends Row = Row>(sql: string, params?: Param[]): Promise<T[]>;
  execute(sql: string, params?: Param[]): Promise<ExecResult>;
}

export interface Database extends SqlRunner {
  readonly kind: "native" | "memory";
  /**
   * Runs `fn` atomically. Statements issued through the `tx` it receives are part of the
   * transaction; if `fn` throws, everything is rolled back. Do not call `db.query` from
   * inside `fn`: use `tx`, otherwise the call waits for a transaction that waits for it.
   */
  transaction<T>(fn: (tx: SqlRunner) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** The minimal surface a driver provides. Everything else is built on top of it. */
export interface RawDriver {
  readonly kind: "native" | "memory";
  query(sql: string, params: Param[]): Promise<Row[]>;
  execute(sql: string, params: Param[]): Promise<ExecResult>;
  close(): Promise<void>;
}

/** A tiny async mutex: the single connection must not interleave two callers' statements. */
class Mutex {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(job: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => (release = resolve));
    await previous;
    try {
      return await job();
    } finally {
      release();
    }
  }
}

export function createDatabase(driver: RawDriver): Database {
  const mutex = new Mutex();
  const runner = (): SqlRunner => ({
    query: <T extends Row = Row>(sql: string, params: Param[] = []) =>
      driver.query(sql, params) as Promise<T[]>,
    execute: (sql, params = []) => driver.execute(sql, params),
  });

  return {
    kind: driver.kind,
    query: <T extends Row = Row>(sql: string, params: Param[] = []) =>
      mutex.run(() => driver.query(sql, params) as Promise<T[]>),
    execute: (sql, params = []) => mutex.run(() => driver.execute(sql, params)),
    transaction: (fn) =>
      mutex.run(async () => {
        await driver.execute("BEGIN IMMEDIATE", []);
        try {
          const result = await fn(runner());
          await driver.execute("COMMIT", []);
          return result;
        } catch (error) {
          try {
            await driver.execute("ROLLBACK", []);
          } catch {
            // The original error is the one worth reporting.
          }
          throw error;
        }
      }),
    close: () => mutex.run(() => driver.close()),
  };
}
