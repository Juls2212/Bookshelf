// Minimal SQL interface the app depends on. expo-sqlite implements it in the app
// (see database.ts); tests use an in-memory SQLite with the same contract.
export type SqlValue = string | number | null;

export interface SqlExecutor {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: SqlValue[]): Promise<{ changes: number }>;
  getAllAsync<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: SqlValue[]): Promise<T | null>;
}

export interface SqlDatabase extends SqlExecutor {
  /** Runs `task` in one exclusive transaction: everything commits or nothing does. */
  transaction<T>(task: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
