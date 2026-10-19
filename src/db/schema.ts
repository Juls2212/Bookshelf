// Local schema, versioned with PRAGMA user_version. Dates are ISO 8601 UTC strings.
// Never edit an applied migration: append a new one.
import type { SqlDatabase } from './sql';

type Migration = { version: number; statements: string[] };

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    statements: [
      // Same columns as the remote user_books table, plus local-only sync columns.
      `CREATE TABLE IF NOT EXISTS books (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        author TEXT,
        genre TEXT,
        page_count INTEGER,
        cover_path TEXT,
        cover_source TEXT CHECK (cover_source IS NULL OR cover_source IN ('camera', 'gallery')),
        reading_status TEXT NOT NULL DEFAULT 'to_read'
          CHECK (reading_status IN ('to_read', 'reading', 'finished')),
        current_page INTEGER NOT NULL DEFAULT 0,
        rating INTEGER,
        notes TEXT,
        lent_to TEXT,
        lent_at TEXT,
        status_changed_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        local_cover_uri TEXT,
        sync_state TEXT NOT NULL DEFAULT 'synced' CHECK (sync_state IN ('synced', 'pending')),
        local_updated_at TEXT
      )`,
      'CREATE INDEX IF NOT EXISTS books_visible_idx ON books (deleted_at, updated_at)',
      `CREATE TABLE IF NOT EXISTS sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity TEXT NOT NULL CHECK (entity IN ('book')),
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete', 'cover_upload')),
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error_code TEXT,
        next_attempt_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (entity, entity_id, operation)
      )`,
      `CREATE TABLE IF NOT EXISTS sync_meta (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT
      )`,
    ],
  },
  {
    version: 2,
    statements: [
      // Permanent failures stop retrying but stay visible (retryFailed() clears them).
      'ALTER TABLE sync_queue ADD COLUMN failed INTEGER NOT NULL DEFAULT 0',
      'CREATE INDEX IF NOT EXISTS sync_queue_due_idx ON sync_queue (failed, next_attempt_at)',
    ],
  },
  {
    version: 3,
    statements: [
      // Offline copy of the user's profile (same columns as the remote profiles table).
      `CREATE TABLE IF NOT EXISTS profile (
        id TEXT PRIMARY KEY NOT NULL,
        display_name TEXT,
        theme TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('system', 'light', 'dark')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_state TEXT NOT NULL DEFAULT 'synced' CHECK (sync_state IN ('synced', 'pending')),
        local_updated_at TEXT
      )`,
      // SQLite cannot alter a CHECK constraint: rebuild sync_queue to accept 'profile'.
      'DROP TABLE IF EXISTS sync_queue_v3',
      `CREATE TABLE sync_queue_v3 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity TEXT NOT NULL CHECK (entity IN ('book', 'profile')),
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete', 'cover_upload')),
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error_code TEXT,
        next_attempt_at TEXT,
        created_at TEXT NOT NULL,
        failed INTEGER NOT NULL DEFAULT 0,
        UNIQUE (entity, entity_id, operation)
      )`,
      `INSERT INTO sync_queue_v3 (id, entity, entity_id, operation, attempts, last_error_code,
         next_attempt_at, created_at, failed)
       SELECT id, entity, entity_id, operation, attempts, last_error_code, next_attempt_at,
         created_at, failed FROM sync_queue`,
      'DROP TABLE sync_queue',
      'ALTER TABLE sync_queue_v3 RENAME TO sync_queue',
      'CREATE INDEX IF NOT EXISTS sync_queue_due_idx ON sync_queue (failed, next_attempt_at)',
    ],
  },
  {
    version: 4,
    statements: [
      // Offline copy of the user's reading preferences (remote reading_preferences table).
      // favorite_genres is a JSON array of genre keys; booleans are 0/1. updated_at is the
      // server's, null until the row has been synced once.
      `CREATE TABLE IF NOT EXISTS reading_preferences (
        user_id TEXT PRIMARY KEY NOT NULL,
        favorite_genres TEXT NOT NULL DEFAULT '[]',
        prioritize_unread INTEGER NOT NULL DEFAULT 1 CHECK (prioritize_unread IN (0, 1)),
        consider_mood INTEGER NOT NULL DEFAULT 1 CHECK (consider_mood IN (0, 1)),
        prefer_short_weekdays INTEGER NOT NULL DEFAULT 0 CHECK (prefer_short_weekdays IN (0, 1)),
        updated_at TEXT,
        sync_state TEXT NOT NULL DEFAULT 'synced' CHECK (sync_state IN ('synced', 'pending')),
        local_updated_at TEXT
      )`,
      // Rebuild sync_queue so its CHECK accepts 'preferences' (same steps as version 3).
      'DROP TABLE IF EXISTS sync_queue_v4',
      `CREATE TABLE sync_queue_v4 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity TEXT NOT NULL CHECK (entity IN ('book', 'profile', 'preferences')),
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete', 'cover_upload')),
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error_code TEXT,
        next_attempt_at TEXT,
        created_at TEXT NOT NULL,
        failed INTEGER NOT NULL DEFAULT 0,
        UNIQUE (entity, entity_id, operation)
      )`,
      `INSERT INTO sync_queue_v4 (id, entity, entity_id, operation, attempts, last_error_code,
         next_attempt_at, created_at, failed)
       SELECT id, entity, entity_id, operation, attempts, last_error_code, next_attempt_at,
         created_at, failed FROM sync_queue`,
      'DROP TABLE sync_queue',
      'ALTER TABLE sync_queue_v4 RENAME TO sync_queue',
      'CREATE INDEX IF NOT EXISTS sync_queue_due_idx ON sync_queue (failed, next_attempt_at)',
    ],
  },
  {
    version: 5,
    statements: [
      // Offline cache and history of the Librero's recommendations (remote recommendations
      // table). The server creates them; this device only changes the disposition.
      `CREATE TABLE IF NOT EXISTS recommendations (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        book_id TEXT NOT NULL,
        rationale TEXT NOT NULL,
        request_context TEXT NOT NULL DEFAULT '{}',
        disposition TEXT NOT NULL DEFAULT 'suggested'
          CHECK (disposition IN ('suggested', 'viewed', 'read_later', 'skipped')),
        created_at TEXT NOT NULL,
        sync_state TEXT NOT NULL DEFAULT 'synced' CHECK (sync_state IN ('synced', 'pending')),
        local_updated_at TEXT
      )`,
      'CREATE INDEX IF NOT EXISTS recommendations_created_idx ON recommendations (user_id, created_at)',
      // Rebuild sync_queue so its CHECK accepts 'recommendation' (same steps as version 3).
      'DROP TABLE IF EXISTS sync_queue_v5',
      `CREATE TABLE sync_queue_v5 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity TEXT NOT NULL CHECK (entity IN ('book', 'profile', 'preferences', 'recommendation')),
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete', 'cover_upload')),
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error_code TEXT,
        next_attempt_at TEXT,
        created_at TEXT NOT NULL,
        failed INTEGER NOT NULL DEFAULT 0,
        UNIQUE (entity, entity_id, operation)
      )`,
      `INSERT INTO sync_queue_v5 (id, entity, entity_id, operation, attempts, last_error_code,
         next_attempt_at, created_at, failed)
       SELECT id, entity, entity_id, operation, attempts, last_error_code, next_attempt_at,
         created_at, failed FROM sync_queue`,
      'DROP TABLE sync_queue',
      'ALTER TABLE sync_queue_v5 RENAME TO sync_queue',
      'CREATE INDEX IF NOT EXISTS sync_queue_due_idx ON sync_queue (failed, next_attempt_at)',
    ],
  },
  {
    version: 6,
    statements: [
      // "Nuevas aventuras": recommendations can be books outside the shelf (no book_id, a
      // suggested title instead). SQLite cannot drop NOT NULL: rebuild the table, keeping every
      // existing row as kind = 'shelf'. The sync queue is unchanged.
      'DROP TABLE IF EXISTS recommendations_v6',
      `CREATE TABLE recommendations_v6 (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'shelf' CHECK (kind IN ('shelf', 'discovery')),
        book_id TEXT,
        suggested_title TEXT,
        suggested_author TEXT,
        suggested_genre TEXT,
        suggested_page_count INTEGER,
        suggestion_verified INTEGER CHECK (suggestion_verified IS NULL OR suggestion_verified IN (0, 1)),
        rationale TEXT NOT NULL,
        request_context TEXT NOT NULL DEFAULT '{}',
        disposition TEXT NOT NULL DEFAULT 'suggested'
          CHECK (disposition IN ('suggested', 'viewed', 'read_later', 'skipped')),
        created_at TEXT NOT NULL,
        sync_state TEXT NOT NULL DEFAULT 'synced' CHECK (sync_state IN ('synced', 'pending')),
        local_updated_at TEXT,
        CHECK ((kind = 'shelf' AND book_id IS NOT NULL)
          OR (kind = 'discovery' AND suggested_title IS NOT NULL))
      )`,
      `INSERT INTO recommendations_v6 (id, user_id, kind, book_id, rationale, request_context,
         disposition, created_at, sync_state, local_updated_at)
       SELECT id, user_id, 'shelf', book_id, rationale, request_context, disposition, created_at,
         sync_state, local_updated_at FROM recommendations`,
      'DROP TABLE recommendations',
      'ALTER TABLE recommendations_v6 RENAME TO recommendations',
      'CREATE INDEX IF NOT EXISTS recommendations_created_idx ON recommendations (user_id, created_at)',
    ],
  },
  {
    version: 7,
    statements: [
      // Profile photo: the local file on this device, plus the remote path and the moment the
      // photo changed (the server's avatar_updated_at once synced).
      'ALTER TABLE profile ADD COLUMN avatar_local_uri TEXT',
      'ALTER TABLE profile ADD COLUMN avatar_path TEXT',
      'ALTER TABLE profile ADD COLUMN avatar_updated_at TEXT',
      // Rebuild sync_queue so its CHECK accepts the avatar operations (same steps as version 3).
      'DROP TABLE IF EXISTS sync_queue_v7',
      `CREATE TABLE sync_queue_v7 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity TEXT NOT NULL CHECK (entity IN ('book', 'profile', 'preferences', 'recommendation')),
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL CHECK (operation IN
          ('upsert', 'delete', 'cover_upload', 'avatar_upload', 'avatar_remove')),
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error_code TEXT,
        next_attempt_at TEXT,
        created_at TEXT NOT NULL,
        failed INTEGER NOT NULL DEFAULT 0,
        UNIQUE (entity, entity_id, operation)
      )`,
      `INSERT INTO sync_queue_v7 (id, entity, entity_id, operation, attempts, last_error_code,
         next_attempt_at, created_at, failed)
       SELECT id, entity, entity_id, operation, attempts, last_error_code, next_attempt_at,
         created_at, failed FROM sync_queue`,
      'DROP TABLE sync_queue',
      'ALTER TABLE sync_queue_v7 RENAME TO sync_queue',
      'CREATE INDEX IF NOT EXISTS sync_queue_due_idx ON sync_queue (failed, next_attempt_at)',
    ],
  },
  {
    version: 8,
    statements: [
      // Append-only reading log (remote reading_events). created_at is the server's, null until
      // pushed; local_updated_at never changes (the engine's "unchanged during push" check).
      `CREATE TABLE IF NOT EXISTS reading_events (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        book_id TEXT NOT NULL,
        pages_delta INTEGER NOT NULL,
        local_date TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        created_at TEXT,
        sync_state TEXT NOT NULL DEFAULT 'synced' CHECK (sync_state IN ('synced', 'pending')),
        local_updated_at TEXT
      )`,
      'CREATE INDEX IF NOT EXISTS reading_events_date_idx ON reading_events (user_id, local_date)',
      // Rebuild sync_queue so its CHECK accepts 'reading_event' (same steps as version 3).
      'DROP TABLE IF EXISTS sync_queue_v8',
      `CREATE TABLE sync_queue_v8 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity TEXT NOT NULL CHECK (entity IN
          ('book', 'profile', 'preferences', 'recommendation', 'reading_event')),
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL CHECK (operation IN
          ('upsert', 'delete', 'cover_upload', 'avatar_upload', 'avatar_remove')),
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error_code TEXT,
        next_attempt_at TEXT,
        created_at TEXT NOT NULL,
        failed INTEGER NOT NULL DEFAULT 0,
        UNIQUE (entity, entity_id, operation)
      )`,
      `INSERT INTO sync_queue_v8 (id, entity, entity_id, operation, attempts, last_error_code,
         next_attempt_at, created_at, failed)
       SELECT id, entity, entity_id, operation, attempts, last_error_code, next_attempt_at,
         created_at, failed FROM sync_queue`,
      'DROP TABLE sync_queue',
      'ALTER TABLE sync_queue_v8 RENAME TO sync_queue',
      'CREATE INDEX IF NOT EXISTS sync_queue_due_idx ON sync_queue (failed, next_attempt_at)',
    ],
  },
  {
    version: 9,
    statements: [
      // Removing a book's cover deletes the remote image after the row is updated: the queue
      // accepts 'cover_remove' (same rebuild steps as version 3).
      'DROP TABLE IF EXISTS sync_queue_v9',
      `CREATE TABLE sync_queue_v9 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity TEXT NOT NULL CHECK (entity IN
          ('book', 'profile', 'preferences', 'recommendation', 'reading_event')),
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL CHECK (operation IN
          ('upsert', 'delete', 'cover_upload', 'cover_remove', 'avatar_upload', 'avatar_remove')),
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error_code TEXT,
        next_attempt_at TEXT,
        created_at TEXT NOT NULL,
        failed INTEGER NOT NULL DEFAULT 0,
        UNIQUE (entity, entity_id, operation)
      )`,
      `INSERT INTO sync_queue_v9 (id, entity, entity_id, operation, attempts, last_error_code,
         next_attempt_at, created_at, failed)
       SELECT id, entity, entity_id, operation, attempts, last_error_code, next_attempt_at,
         created_at, failed FROM sync_queue`,
      'DROP TABLE sync_queue',
      'ALTER TABLE sync_queue_v9 RENAME TO sync_queue',
      'CREATE INDEX IF NOT EXISTS sync_queue_due_idx ON sync_queue (failed, next_attempt_at)',
    ],
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export async function getUserVersion(db: SqlDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

/** Applies pending migrations, each in its own transaction. Safe to run on every open. */
export async function migrate(db: SqlDatabase): Promise<number> {
  const current = await getUserVersion(db);
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    await db.transaction(async (tx) => {
      for (const statement of migration.statements) await tx.execAsync(statement);
      // PRAGMA does not accept bound parameters; the version is a trusted integer.
      await tx.execAsync(`PRAGMA user_version = ${Number(migration.version)}`);
    });
  }
  return getUserVersion(db);
}
