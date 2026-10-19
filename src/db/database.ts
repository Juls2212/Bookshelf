// One SQLite file per user, so different accounts on the same device never share data.
import * as SQLite from 'expo-sqlite';

import { migrate } from './schema';
import type { SqlDatabase, SqlExecutor, SqlValue } from './sql';

export type DatabaseOpener = (fileName: string) => Promise<SqlDatabase>;

/** File name for a user's database (user ids are UUIDs; anything else is stripped). */
export function databaseNameFor(userId: string): string {
  const safe = userId.replace(/[^A-Za-z0-9-]/g, '');
  if (!safe) throw new Error('invalid_user_id');
  return `bookshelf_${safe}.db`;
}

// Transactions are SQLiteDatabase subclasses, so one wrapper serves both.
function wrapExecutor(db: SQLite.SQLiteDatabase): SqlExecutor {
  return {
    execAsync: (sql) => db.execAsync(sql),
    runAsync: async (sql, params: SqlValue[] = []) => {
      const result = await db.runAsync(sql, params);
      return { changes: result.changes };
    },
    getAllAsync: <T>(sql: string, params: SqlValue[] = []) => db.getAllAsync<T>(sql, params),
    getFirstAsync: <T>(sql: string, params: SqlValue[] = []) => db.getFirstAsync<T>(sql, params),
  };
}

/** expo-sqlite implementation of the app's SQL interface. */
const openExpoDatabase: DatabaseOpener = async (fileName) => {
  const db = await SQLite.openDatabaseAsync(fileName);
  return {
    ...wrapExecutor(db),
    transaction: async <T>(task: (tx: SqlExecutor) => Promise<T>) => {
      let result: T | undefined;
      // Exclusive: no other query can interleave with the transaction's statements.
      await db.withExclusiveTransactionAsync(async (txn) => {
        result = await task(wrapExecutor(txn));
      });
      return result as T;
    },
    close: () => db.closeAsync(),
  };
};

type DatabaseDeleter = (fileName: string) => Promise<void>;

/**
 * Deletes a user's database file. It must be closed first (closing the last connection also
 * checkpoints and removes the WAL files). A missing file is not an error.
 */
export async function deleteUserDatabase(
  userId: string,
  deleter: DatabaseDeleter = (fileName) => SQLite.deleteDatabaseAsync(fileName),
): Promise<boolean> {
  try {
    await deleter(databaseNameFor(userId));
    return true;
  } catch {
    return false;
  }
}

/** Opens (creating if needed) the user's database, enables WAL and applies migrations. */
export async function openUserDatabase(
  userId: string,
  opener: DatabaseOpener = openExpoDatabase,
): Promise<SqlDatabase> {
  const db = await opener(databaseNameFor(userId));
  await db.execAsync('PRAGMA journal_mode = WAL');
  await migrate(db);
  return db;
}
