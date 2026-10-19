// Test-only: the app's SqlDatabase contract over Node's built-in SQLite (node:sqlite, Node 22+),
// so Jest runs the real SQL (migrations, upserts, constraints) in memory. Not used by the app.
import type { DatabaseOpener } from '@/db/database';
import type { SqlDatabase, SqlExecutor, SqlValue } from '@/db/sql';

type Statement = {
  run(...params: SqlValue[]): { changes: number | bigint };
  all(...params: SqlValue[]): unknown[];
  get(...params: SqlValue[]): unknown;
};
type NodeDatabase = { exec(sql: string): void; prepare(sql: string): Statement; close(): void };
type NodeSqlite = { DatabaseSync: new (location: string) => NodeDatabase };

const { DatabaseSync } = jest.requireActual<NodeSqlite>('node:sqlite');

/** node:sqlite returns null-prototype rows; plain objects keep Jest equality simple. */
const plain = <T>(row: unknown): T => ({ ...(row as object) }) as T;

function executor(db: NodeDatabase): SqlExecutor {
  return {
    execAsync: async (sql) => db.exec(sql),
    runAsync: async (sql, params = []) => ({
      changes: Number(db.prepare(sql).run(...params).changes),
    }),
    getAllAsync: async <T>(sql: string, params: SqlValue[] = []) =>
      db
        .prepare(sql)
        .all(...params)
        .map((row) => plain<T>(row)),
    getFirstAsync: async <T>(sql: string, params: SqlValue[] = []) => {
      const row = db.prepare(sql).get(...params);
      return row === undefined ? null : plain<T>(row);
    },
  };
}

/** In-memory database. close() behaves like closing a file: the data stays for a reopen. */
export function createMemoryDatabase(): SqlDatabase & {
  closed: () => boolean;
  reopen: () => void;
} {
  const db = new DatabaseSync(':memory:');
  let closed = false;
  let queue: Promise<unknown> = Promise.resolve();
  const base = executor(db);
  return {
    ...base,
    // Serialized like an exclusive transaction: tasks never interleave.
    transaction: <T>(task: (tx: SqlExecutor) => Promise<T>) => {
      const run = queue.then(async () => {
        db.exec('BEGIN');
        try {
          const result = await task(base);
          db.exec('COMMIT');
          return result;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      });
      queue = run.catch(() => undefined);
      return run;
    },
    close: async () => {
      closed = true;
    },
    closed: () => closed,
    reopen: () => {
      closed = false;
    },
  };
}

type MemoryDatabase = ReturnType<typeof createMemoryDatabase>;

/** Opener keyed by file name: reopening the same name returns the same in-memory database. */
export function createMemoryOpener(): DatabaseOpener & { files: Map<string, MemoryDatabase> } {
  const files = new Map<string, MemoryDatabase>();
  const open: DatabaseOpener = async (fileName) => {
    const existing = files.get(fileName);
    if (existing) {
      existing.reopen();
      return existing;
    }
    const db = createMemoryDatabase();
    files.set(fileName, db);
    return db;
  };
  const opener = Object.assign(open, { files });
  return opener;
}
