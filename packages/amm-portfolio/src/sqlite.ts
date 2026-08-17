import BetterSqlite3 from "better-sqlite3";
import { createRequire } from "node:module";

export interface SqliteStatement {
  get(...values: unknown[]): unknown;
  all(...values: unknown[]): unknown[];
  run(...values: unknown[]): unknown;
}

export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): unknown;
  pragma(sql: string): unknown;
  transaction(operation: () => void): () => void;
  close(): void;
}

interface SqliteConstructor {
  new(path: string): SqliteDatabase;
}

export function createSqliteDatabase(path: string): SqliteDatabase {
  if (process.versions.bun) {
    // Bun 1.2 cannot safely load better-sqlite3's N-API binding. Its native
    // driver implements the small synchronous interface used by this package.
    const runtimeModule: unknown = createRequire(import.meta.url)("bun:sqlite");
    if (typeof runtimeModule !== "object" || runtimeModule === null || !("Database" in runtimeModule)) {
      throw new Error("bun:sqlite Database export is unavailable");
    }
    const RuntimeDatabase = runtimeModule.Database as SqliteConstructor;
    return new RuntimeDatabase(path);
  }
  return new BetterSqlite3(path);
}
