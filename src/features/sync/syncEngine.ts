// Sync engine: pushes the local queue to Supabase, pulls remote changes and caches covers.
//
// Conflict policy (documented here on purpose):
// - Last write wins at the row level: whoever pushes last overwrites the server row.
// - Local pending changes win over remote ones until they are pushed: the pull never
//   overwrites a row whose sync_state is 'pending' (see upsertRemoteRow).
// - After a push, the server row (with its server-set updated_at) becomes the local truth,
//   unless the user edited the book again during the push (local_updated_at changed): then
//   the row stays pending and is pushed again.
// - Remote soft deletes are applied (deleted_at is copied; the book disappears from lists).
// - A cover removed on another device (cover_path null) also drops this device's local copy.
// - The profile (name, theme) follows the same rules: a pending local profile is never
//   overwritten by the pull, and it becomes synced only if it did not change during the push.
// - The profile photo is uploaded (or removed) before the profile row that carries its path
//   and avatar_updated_at. The pull downloads the photo again when the server's
//   avatar_updated_at is newer than this device's; a pending local photo always wins.
// - Reading preferences follow the same rules too. If the server has no row, the local copy
//   (or the defaults, when there is none) is queued and pushed in the same sync.
// - Recommendations are created by the server; this device only changes their disposition,
//   with the same rules (a pending local disposition is never overwritten by the pull). The
//   pull keeps the latest 50 locally.
// - Reading events are append-only: pushed once (a repeated id is ignored by the server), only
//   after their book row exists remotely, and pulled incrementally by server created_at,
//   merged by id. They never conflict.
//
// Never logs tokens, URLs, titles or notes: only English error codes.
import type { SqlDatabase } from '@/db/sql';
import {
  enqueuePreferencesUpsert,
  getMeta,
  setMeta,
  type SyncEntity,
  type SyncOperation,
  type SyncQueueEntry,
} from '@/db/syncQueue';
import { clampBookRow } from '@/features/library/bookText';
import { coverPathFor, type CoverService } from '@/features/library/coverService';
import { runInitialPull, upsertRemoteRow } from '@/features/library/initialPull';
import type { LibrarySession } from '@/features/library/librarySession';
import { REMOTE_COLUMNS, type LocalBookRow } from '@/features/library/localBookRow';
import { getLocalEvent, upsertRemoteEvent } from '@/features/library/localReadingEvents';
import type {
  BookRemoteGateway,
  BookSyncGateway,
  RemoteBookUpsert,
} from '@/features/library/supabaseBookGateway';
import type { ReadingEventSyncGateway } from '@/features/library/supabaseReadingEventGateway';
import type { AvatarService } from '@/features/profile/avatarService';
import { getLocalProfile, upsertRemoteProfile } from '@/features/profile/localProfile';
import type { ProfileSyncGateway } from '@/features/profile/supabaseProfileGateway';
import { INPUT_LIMITS } from '@/lib/inputLimits';
import { truncateChars } from '@/lib/inputSanitizers';
import {
  ensurePendingPreferences,
  getLocalPreferences,
  localRowToPreferences,
  upsertRemotePreferences,
} from '@/features/preferences/localPreferences';
import type { PreferencesSyncGateway } from '@/features/preferences/supabasePreferencesGateway';
import {
  getLocalRecommendation,
  HISTORY_LIMIT,
  trimLocalRecommendations,
  upsertRemoteRecommendation,
} from '@/features/recommendations/localRecommendations';
import type { RecommendationSyncGateway } from '@/features/recommendations/supabaseRecommendationGateway';
import type { Foreground, Network } from '@/lib/network';

import { backoffDelayMs, classifyRemoteError, type ClassifiedError } from './syncErrors';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';

export type SyncSnapshot = {
  status: SyncStatus;
  pendingCount: number;
  failedCount: number;
  lastSyncAt: string | null;
  /** Whether this device has downloaded the library once; null while unknown (no session). */
  initialPullDone: boolean | null;
};

export const EMPTY_SYNC_SNAPSHOT: SyncSnapshot = {
  status: 'idle',
  pendingCount: 0,
  failedCount: 0,
  lastSyncAt: null,
  initialPullDone: null,
};

export type SyncEngine = {
  /** Starts listening to triggers and runs a first sync (session ready). */
  start(): void;
  stop(): void;
  /** Runs a sync now (single-flight: joins the running one and runs once more after it). */
  syncNow(): Promise<void>;
  /** Clears permanent failures so they are retried, then syncs. */
  retryFailed(): Promise<void>;
  /** A local write happened: sync after a short debounce. */
  notifyLocalChange(): void;
};

type Deps = {
  session: LibrarySession;
  gateway: BookSyncGateway & BookRemoteGateway;
  profiles: ProfileSyncGateway;
  preferences: PreferencesSyncGateway;
  recommendations: RecommendationSyncGateway;
  readingEvents: ReadingEventSyncGateway;
  covers: Pick<CoverService, 'upload' | 'downloadToLocal' | 'remove'>;
  avatars: Pick<
    AvatarService,
    'upload' | 'remove' | 'downloadToLocal' | 'removeLocal' | 'pruneLocal'
  >;
  network: Network;
  foreground?: Foreground;
  now?: () => Date;
  random?: () => number;
  onSnapshot?: (snapshot: SyncSnapshot) => void;
  /** Remote rows or cached covers changed: the UI should reload from SQLite. */
  onRemoteChanges?: () => void;
  /** The cached profile changed after a pull: the profile store should reload it. */
  onProfileChange?: () => void;
  /** The cached reading preferences changed (pulled, created or synced): reload them. */
  onPreferencesChange?: () => void;
  /** The cached recommendations changed (pulled or synced): reload them. */
  onRecommendationsChange?: () => void;
  debounceMs?: number;
  pullPageSize?: number;
  coverConcurrency?: number;
  coverBatch?: number;
};

/**
 * Push order inside one entity: the cover or photo first, then the row, then a cover removal
 * (only once the row no longer points at the image), then the delete.
 */
const OPERATION_ORDER: Record<SyncOperation, number> = {
  cover_upload: 0,
  cover_remove: 1.5,
  avatar_upload: 0,
  avatar_remove: 0,
  upsert: 1,
  delete: 2,
};
/** Incremental pull looks a bit before the cursor so near-simultaneous writes are not missed. */
export const PULL_OVERLAP_MS = 5_000;
const LOCAL_CHANGE_DEBOUNCE_MS = 1_000;
const EPOCH = '1970-01-01T00:00:00.000Z';

/**
 * `updatedAt`: the server time of the pushed row (the local row becomes synced); null for rows
 * without updated_at (synced without a timestamp); absent when the row is not synced yet (e.g. a
 * cover upload, which waits for the book row).
 */
type PushAttempt = { ok: true; updatedAt?: string | null } | { ok: false; error: ClassifiedError };
type PushOutcome = 'ok' | 'blocked' | 'abort';

function warnCode(operation: string, code: string): void {
  console.warn(`[sync] ${operation} failed: ${code}`);
}

type RunContext = {
  db: SqlDatabase;
  userId: string;
  /** The session is refreshed at most once per run. */
  refreshTried: boolean;
  hadErrors: boolean;
  changed: boolean;
  profileChanged: boolean;
  preferencesChanged: boolean;
  recommendationsChanged: boolean;
  /** Something was queued during the pull (missing server row): push again before finishing. */
  pushAgain: boolean;
};

/** Local table and key column of each queued entity (fixed names, never user input). */
const ENTITY_TABLES: Record<SyncEntity, { table: string; key: string }> = {
  book: { table: 'books', key: 'id' },
  profile: { table: 'profile', key: 'id' },
  preferences: { table: 'reading_preferences', key: 'user_id' },
  recommendation: { table: 'recommendations', key: 'id' },
  reading_event: { table: 'reading_events', key: 'id' },
};

export function createSyncEngine({
  session,
  gateway,
  profiles,
  preferences,
  recommendations,
  readingEvents,
  covers,
  avatars,
  network,
  foreground,
  now = () => new Date(),
  random = Math.random,
  onSnapshot = () => undefined,
  onRemoteChanges = () => undefined,
  onProfileChange = () => undefined,
  onPreferencesChange = () => undefined,
  onRecommendationsChange = () => undefined,
  debounceMs = LOCAL_CHANGE_DEBOUNCE_MS,
  pullPageSize = 200,
  coverConcurrency = 2,
  coverBatch = 20,
}: Deps): SyncEngine {
  let snapshot: SyncSnapshot = EMPTY_SYNC_SNAPSHOT;
  let running: Promise<void> | null = null;
  let rerun = false;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let unsubscribers: (() => void)[] = [];
  let lastOnline: boolean | null = null;
  /** stop() is final: a sync still running must not publish state for a signed-out user. */
  let stopped = false;

  const emit = (patch: Partial<SyncSnapshot>) => {
    if (stopped) return;
    snapshot = { ...snapshot, ...patch };
    onSnapshot(snapshot);
  };

  /** Queue counts plus the persisted sync metadata (survives app restarts). */
  const refreshCounts = async (db: SqlDatabase) => {
    const row = await db.getFirstAsync<{ pending: number; failed: number }>(
      `SELECT COALESCE(SUM(CASE WHEN failed = 0 THEN 1 ELSE 0 END), 0) AS pending,
              COALESCE(SUM(CASE WHEN failed = 1 THEN 1 ELSE 0 END), 0) AS failed
       FROM sync_queue`,
    );
    const initialPullDone = (await getMeta(db, 'initial_pull_done')) === 'true';
    const lastSyncAt = snapshot.lastSyncAt ?? (await getMeta(db, 'last_sync_at'));
    emit({
      pendingCount: row?.pending ?? 0,
      failedCount: row?.failed ?? 0,
      initialPullDone,
      lastSyncAt,
    });
  };

  /** Retries once after refreshing an expired session (once per run). */
  const handleAuth = async (ctx: RunContext, error: ClassifiedError): Promise<boolean> => {
    if (error.code !== 'auth_expired' || ctx.refreshTried) return false;
    ctx.refreshTried = true;
    return gateway.refreshSession();
  };

  const recordFailure = async (ctx: RunContext, entry: SyncQueueEntry, error: ClassifiedError) => {
    ctx.hadErrors = true;
    warnCode(entry.operation, error.code);
    if (error.retryable) {
      const attempts = entry.attempts + 1;
      const next = new Date(now().getTime() + backoffDelayMs(attempts, random)).toISOString();
      await ctx.db.runAsync(
        'UPDATE sync_queue SET attempts = ?, last_error_code = ?, next_attempt_at = ? WHERE id = ?',
        [attempts, error.code, next, entry.id],
      );
    } else {
      // Permanent: stop retrying, keep it visible as failed (retryFailed() clears it).
      await ctx.db.runAsync(
        'UPDATE sync_queue SET failed = 1, last_error_code = ?, next_attempt_at = NULL WHERE id = ?',
        [error.code, entry.id],
      );
    }
  };

  /** Removes the entry and marks the row synced only if nothing changed locally meanwhile. */
  const completeEntry = async (
    ctx: RunContext,
    entry: SyncQueueEntry,
    snapshotLocalUpdatedAt: string | null,
    serverUpdatedAt?: string | null,
  ) => {
    const { table, key } = ENTITY_TABLES[entry.entity];
    await ctx.db.transaction(async (tx) => {
      const current = await tx.getFirstAsync<{ local_updated_at: string | null }>(
        `SELECT local_updated_at FROM ${table} WHERE ${key} = ?`,
        [entry.entity_id],
      );
      if (current && current.local_updated_at !== snapshotLocalUpdatedAt) return; // edited during push
      await tx.runAsync('DELETE FROM sync_queue WHERE id = ?', [entry.id]);
      const remaining = await tx.getFirstAsync<{ n: number }>(
        'SELECT COUNT(*) AS n FROM sync_queue WHERE entity = ? AND entity_id = ?',
        [entry.entity, entry.entity_id],
      );
      if (serverUpdatedAt !== undefined && (remaining?.n ?? 0) === 0) {
        if (serverUpdatedAt === null) {
          await tx.runAsync(`UPDATE ${table} SET sync_state = 'synced' WHERE ${key} = ?`, [
            entry.entity_id,
          ]);
        } else {
          await tx.runAsync(
            `UPDATE ${table} SET sync_state = 'synced', updated_at = ? WHERE ${key} = ?`,
            [serverUpdatedAt, entry.entity_id],
          );
        }
      }
    });
  };

  /** Runs one push attempt (plus one retry after a session refresh) and records the outcome. */
  const settle = async (
    ctx: RunContext,
    entry: SyncQueueEntry,
    localUpdatedAt: string | null,
    attempt: () => Promise<PushAttempt>,
  ): Promise<PushOutcome> => {
    let result = await attempt();
    if (!result.ok && (await handleAuth(ctx, result.error))) result = await attempt();
    if (result.ok) {
      await completeEntry(ctx, entry, localUpdatedAt, result.updatedAt);
      return 'ok';
    }
    await recordFailure(ctx, entry, result.error);
    // Without a reachable server every other request would fail too.
    return result.error.code === 'network_error' || result.error.code === 'timeout'
      ? 'abort'
      : 'blocked';
  };

  const pushProfileEntry = async (ctx: RunContext, entry: SyncQueueEntry) => {
    const profile = await getLocalProfile(ctx.db, entry.entity_id);
    if (!profile || profile.id !== ctx.userId) {
      await ctx.db.runAsync('DELETE FROM sync_queue WHERE id = ?', [entry.id]);
      return 'ok';
    }
    if (entry.operation === 'avatar_upload' || entry.operation === 'avatar_remove') {
      return settle(ctx, entry, profile.local_updated_at, async () => {
        let result: { ok: boolean; cause?: unknown };
        if (entry.operation === 'avatar_remove') {
          result = await avatars.remove(ctx.userId);
        } else if (profile.avatar_path && profile.avatar_local_uri) {
          result = await avatars.upload(ctx.userId, profile.avatar_local_uri);
        } else {
          result = { ok: true }; // removed meanwhile: nothing to upload
        }
        return result.ok
          ? { ok: true }
          : { ok: false, error: classifyRemoteError(result.cause ?? {}) };
      });
    }
    return settle(ctx, entry, profile.local_updated_at, async () => {
      // Only the editable fields; the server sets updated_at.
      const result = await profiles.pushProfile(ctx.userId, {
        display_name:
          profile.display_name === null
            ? null
            : truncateChars(profile.display_name, INPUT_LIMITS.displayName),
        theme: profile.theme,
        avatar_path: profile.avatar_path,
        avatar_updated_at: profile.avatar_updated_at,
      });
      return result.ok
        ? { ok: true, updatedAt: result.data.updated_at }
        : { ok: false, error: classifyRemoteError(result.cause) };
    });
  };

  const pushPreferencesEntry = async (ctx: RunContext, entry: SyncQueueEntry) => {
    const row = await getLocalPreferences(ctx.db, entry.entity_id);
    if (!row || row.user_id !== ctx.userId) {
      await ctx.db.runAsync('DELETE FROM sync_queue WHERE id = ?', [entry.id]);
      return 'ok';
    }
    const local = localRowToPreferences(row);
    const outcome = await settle(ctx, entry, row.local_updated_at, async () => {
      const result = await preferences.pushPreferences(ctx.userId, {
        favorite_genres: local.favoriteGenres,
        prioritize_unread: local.prioritizeUnread,
        consider_mood: local.considerMood,
        prefer_short_weekdays: local.preferShortWeekdays,
      });
      return result.ok
        ? { ok: true, updatedAt: result.data.updated_at }
        : { ok: false, error: classifyRemoteError(result.cause) };
    });
    // Pending -> saved: the store shows it.
    if (outcome === 'ok') ctx.preferencesChanged = true;
    return outcome;
  };

  const pushRecommendationEntry = async (ctx: RunContext, entry: SyncQueueEntry) => {
    const row = await getLocalRecommendation(ctx.db, entry.entity_id);
    if (!row || row.user_id !== ctx.userId) {
      await ctx.db.runAsync('DELETE FROM sync_queue WHERE id = ?', [entry.id]);
      return 'ok';
    }
    const outcome = await settle(ctx, entry, row.local_updated_at, async () => {
      // A row deleted on the server (its book was removed) has nothing left to update.
      const result = await recommendations.pushDisposition(row.id, row.disposition);
      return result.ok
        ? { ok: true, updatedAt: null }
        : { ok: false, error: classifyRemoteError(result.cause) };
    });
    if (outcome === 'ok') ctx.recommendationsChanged = true;
    return outcome;
  };

  const pushReadingEventEntry = async (
    ctx: RunContext,
    entry: SyncQueueEntry,
  ): Promise<PushOutcome> => {
    const row = await getLocalEvent(ctx.db, entry.entity_id);
    if (!row || row.user_id !== ctx.userId) {
      await ctx.db.runAsync('DELETE FROM sync_queue WHERE id = ?', [entry.id]);
      return 'ok';
    }
    // The server checks the book (same owner): wait while the book row is still unsent (also
    // when it failed; retrying the book releases its events).
    const bookPending = await ctx.db.getFirstAsync<{ id: number }>(
      "SELECT id FROM sync_queue WHERE entity = 'book' AND entity_id = ? LIMIT 1",
      [row.book_id],
    );
    if (bookPending) return 'blocked';
    return settle(ctx, entry, row.local_updated_at, async () => {
      const result = await readingEvents.pushEvent({
        id: row.id,
        user_id: ctx.userId,
        book_id: row.book_id,
        pages_delta: row.pages_delta,
        local_date: row.local_date,
        occurred_at: row.occurred_at,
      });
      return result.ok
        ? { ok: true, updatedAt: null }
        : { ok: false, error: classifyRemoteError(result.cause) };
    });
  };

  /** Pushes one queue entry. Returns 'ok', 'blocked' (stop this entity) or 'abort' (stop push). */
  const pushEntry = async (ctx: RunContext, entry: SyncQueueEntry): Promise<PushOutcome> => {
    if (entry.entity === 'reading_event') return pushReadingEventEntry(ctx, entry);
    if (entry.entity === 'profile') return pushProfileEntry(ctx, entry);
    if (entry.entity === 'preferences') return pushPreferencesEntry(ctx, entry);
    if (entry.entity === 'recommendation') return pushRecommendationEntry(ctx, entry);

    const row = await ctx.db.getFirstAsync<LocalBookRow>('SELECT * FROM books WHERE id = ?', [
      entry.entity_id,
    ]);
    if (!row) {
      await ctx.db.runAsync('DELETE FROM sync_queue WHERE id = ?', [entry.id]);
      return 'ok';
    }
    return settle(ctx, entry, row.local_updated_at, async () => {
      if (entry.operation === 'cover_remove') {
        // A new cover meanwhile replaced the removal (the queue drops it); never delete it.
        if (row.cover_path !== null) return { ok: true };
        const result = await covers.remove(coverPathFor(ctx.userId, row.id));
        // Idempotent: an image that is already gone is the goal.
        return result.ok || result.error === 'not_found'
          ? { ok: true }
          : { ok: false, error: classifyRemoteError(result.cause ?? {}) };
      }
      if (entry.operation === 'cover_upload') {
        if (!row.local_cover_uri) return { ok: true };
        const result = await covers.upload(ctx.userId, row.id, row.local_cover_uri);
        return result.ok
          ? { ok: true }
          : { ok: false, error: classifyRemoteError(result.cause ?? {}) };
      }
      // upsert and delete both send the full row; a delete is the row with deleted_at set.
      const payload = Object.fromEntries(
        REMOTE_COLUMNS.filter((c) => c !== 'updated_at').map((c) => [c, row[c]]),
      ) as RemoteBookUpsert;
      payload.user_id = ctx.userId;
      const result = await gateway.upsertBook(clampBookRow(payload));
      return result.ok
        ? { ok: true, updatedAt: result.data.updated_at }
        : { ok: false, error: classifyRemoteError(result.cause) };
    });
  };

  const push = async (ctx: RunContext) => {
    const entries = await ctx.db.getAllAsync<SyncQueueEntry>(
      'SELECT * FROM sync_queue WHERE failed = 0 ORDER BY created_at, id',
    );
    const byEntity = new Map<string, SyncQueueEntry[]>();
    for (const entry of entries) {
      const key = `${entry.entity}:${entry.entity_id}`;
      byEntity.set(key, [...(byEntity.get(key) ?? []), entry]);
    }
    const nowIso = now().toISOString();
    for (const entityEntries of byEntity.values()) {
      entityEntries.sort((a, b) => OPERATION_ORDER[a.operation] - OPERATION_ORDER[b.operation]);
      for (const entry of entityEntries) {
        // Keep the per-book order: a book waits for its cover upload (or its backoff).
        if (entry.next_attempt_at && entry.next_attempt_at > nowIso) break;
        const outcome = await pushEntry(ctx, entry);
        if (outcome === 'abort') return;
        if (outcome === 'blocked') break;
      }
    }
  };

  /** Incremental pull by server updated_at; the cursor only advances after a full success. */
  const pull = async (ctx: RunContext): Promise<void> => {
    if ((await getMeta(ctx.db, 'initial_pull_done')) !== 'true') {
      const outcome = await runInitialPull(ctx.db, gateway, { now });
      if (outcome === 'failed') ctx.hadErrors = true;
      if (outcome === 'done') ctx.changed = true;
      return;
    }
    const last = (await getMeta(ctx.db, 'last_pull_at')) ?? EPOCH;
    const since = new Date(Date.parse(last) - PULL_OVERLAP_MS).toISOString();
    let cursor = Date.parse(last);

    for (let offset = 0; ; offset += pullPageSize) {
      let page = await gateway.pullChangedSince(since, offset, pullPageSize);
      if (!page.ok && (await handleAuth(ctx, classifyRemoteError(page.cause)))) {
        page = await gateway.pullChangedSince(since, offset, pullPageSize);
      }
      if (!page.ok) {
        ctx.hadErrors = true;
        warnCode('pull', classifyRemoteError(page.cause).code);
        return;
      }
      const rows = page.data;
      await ctx.db.transaction(async (tx) => {
        for (const row of rows) {
          // Pending local rows are skipped inside upsertRemoteRow (local changes win).
          if ((await upsertRemoteRow(tx, row)) > 0) ctx.changed = true;
          cursor = Math.max(cursor, Date.parse(row.updated_at));
        }
      });
      if (rows.length < pullPageSize) break;
    }
    await setMeta(ctx.db, 'last_pull_at', new Date(cursor).toISOString());
  };

  /**
   * The photo of a synced profile: downloaded when the profile has a remote photo but no local
   * file (new device, or a newer photo pulled). After a pull changed the profile, old local
   * files are deleted. Failures are tolerated (retried on a later sync).
   */
  const cacheAvatar = async (ctx: RunContext, pulled: boolean): Promise<void> => {
    const row = await getLocalProfile(ctx.db, ctx.userId);
    if (!row || row.sync_state === 'pending') return;
    if (!row.avatar_path) {
      if (pulled && !row.avatar_local_uri) avatars.pruneLocal(ctx.userId, null);
      return;
    }
    if (row.avatar_local_uri) return;
    const result = await avatars.downloadToLocal(ctx.userId, row.avatar_path);
    if (!result.ok) return;
    // Only if the profile still points at the same photo (no local change meanwhile).
    const saved = await ctx.db.runAsync(
      `UPDATE profile SET avatar_local_uri = ?
       WHERE id = ? AND avatar_local_uri IS NULL AND sync_state = 'synced'
         AND avatar_path = ? AND avatar_updated_at IS ?`,
      [result.data, ctx.userId, row.avatar_path, row.avatar_updated_at],
    );
    if (saved.changes > 0) {
      avatars.pruneLocal(ctx.userId, result.data);
      ctx.profileChanged = true;
    } else {
      avatars.removeLocal(result.data);
    }
  };

  /** The profile is a single row: pulled whole on every sync (kept while pending locally). */
  const pullProfile = async (ctx: RunContext): Promise<void> => {
    let result = await profiles.pullProfile(ctx.userId);
    if (!result.ok && (await handleAuth(ctx, classifyRemoteError(result.cause)))) {
      result = await profiles.pullProfile(ctx.userId);
    }
    if (!result.ok) {
      ctx.hadErrors = true;
      warnCode('pull profile', classifyRemoteError(result.cause).code);
      return;
    }
    const row = result.data;
    let pulled = false;
    if (row && row.id === ctx.userId && (await upsertRemoteProfile(ctx.db, row)) > 0) {
      ctx.profileChanged = true;
      pulled = true;
    }
    await cacheAvatar(ctx, pulled);
  };

  /**
   * Reading preferences are a single row: pulled whole on every sync (kept while pending). With
   * no server row, the local copy or the defaults are queued and pushed in this same sync.
   */
  const pullPreferences = async (ctx: RunContext): Promise<void> => {
    let result = await preferences.pullPreferences(ctx.userId);
    if (!result.ok && (await handleAuth(ctx, classifyRemoteError(result.cause)))) {
      result = await preferences.pullPreferences(ctx.userId);
    }
    if (!result.ok) {
      ctx.hadErrors = true;
      warnCode('pull preferences', classifyRemoteError(result.cause).code);
      return;
    }
    const row = result.data;
    if (row && row.user_id === ctx.userId) {
      if ((await upsertRemotePreferences(ctx.db, row)) > 0) ctx.preferencesChanged = true;
      return;
    }
    if (row) return; // never another user's row
    const nowIso = now().toISOString();
    await ctx.db.transaction(async (tx) => {
      await ensurePendingPreferences(tx, ctx.userId, nowIso);
      await enqueuePreferencesUpsert(tx, ctx.userId, nowIso);
    });
    ctx.preferencesChanged = true;
    ctx.pushAgain = true;
  };

  /** The latest 50 recommendations (pending local dispositions are kept). */
  const pullRecommendations = async (ctx: RunContext): Promise<void> => {
    let result = await recommendations.pullRecent(HISTORY_LIMIT);
    if (!result.ok && (await handleAuth(ctx, classifyRemoteError(result.cause)))) {
      result = await recommendations.pullRecent(HISTORY_LIMIT);
    }
    if (!result.ok) {
      ctx.hadErrors = true;
      warnCode('pull recommendations', classifyRemoteError(result.cause).code);
      return;
    }
    const rows = result.data.filter((row) => row.user_id === ctx.userId);
    await ctx.db.transaction(async (tx) => {
      for (const row of rows) {
        if ((await upsertRemoteRecommendation(tx, row)) > 0) ctx.recommendationsChanged = true;
      }
      await trimLocalRecommendations(tx, ctx.userId);
    });
  };

  /** New reading events from other devices, by server created_at; merged by id. */
  const pullReadingEvents = async (ctx: RunContext): Promise<void> => {
    const last = (await getMeta(ctx.db, 'last_events_pull_at')) ?? EPOCH;
    const since = new Date(Date.parse(last) - PULL_OVERLAP_MS).toISOString();
    let cursor = Date.parse(last);
    for (let offset = 0; ; offset += pullPageSize) {
      let page = await readingEvents.pullEventsSince(since, offset, pullPageSize);
      if (!page.ok && (await handleAuth(ctx, classifyRemoteError(page.cause)))) {
        page = await readingEvents.pullEventsSince(since, offset, pullPageSize);
      }
      if (!page.ok) {
        ctx.hadErrors = true;
        warnCode('pull reading events', classifyRemoteError(page.cause).code);
        return;
      }
      const rows = page.data.filter((row) => row.user_id === ctx.userId);
      await ctx.db.transaction(async (tx) => {
        for (const row of rows) {
          if ((await upsertRemoteEvent(tx, row)) > 0) ctx.changed = true;
          const created = Date.parse(row.created_at);
          if (!Number.isNaN(created)) cursor = Math.max(cursor, created);
        }
      });
      if (page.data.length < pullPageSize) break;
    }
    await setMeta(ctx.db, 'last_events_pull_at', new Date(cursor).toISOString());
  };

  /** Offline cover cache for pulled books (max `coverConcurrency` downloads at once). */
  const cacheCovers = async (ctx: RunContext) => {
    const rows = await ctx.db.getAllAsync<{ id: string; cover_path: string }>(
      `SELECT id, cover_path FROM books
       WHERE deleted_at IS NULL AND cover_path IS NOT NULL AND local_cover_uri IS NULL
         AND sync_state = 'synced'
       ORDER BY updated_at DESC LIMIT ?`,
      [coverBatch],
    );
    const queue = [...rows];
    const worker = async () => {
      for (let row = queue.shift(); row; row = queue.shift()) {
        const result = await covers.downloadToLocal(ctx.userId, row.id, row.cover_path);
        if (!result.ok) continue; // tolerated: retried on a later sync
        await ctx.db.runAsync(
          'UPDATE books SET local_cover_uri = ? WHERE id = ? AND local_cover_uri IS NULL',
          [result.data, row.id],
        );
        ctx.changed = true;
      }
    };
    await Promise.all(Array.from({ length: Math.min(coverConcurrency, rows.length) }, worker));
  };

  const runOnce = async () => {
    const active = await session.current();
    if (!active) return;
    if (!(await network.isOnline())) {
      await refreshCounts(active.db);
      emit({ status: 'offline' });
      return;
    }
    emit({ status: 'syncing' });
    const ctx: RunContext = {
      db: active.db,
      userId: active.userId,
      refreshTried: false,
      hadErrors: false,
      changed: false,
      profileChanged: false,
      preferencesChanged: false,
      recommendationsChanged: false,
      pushAgain: false,
    };
    try {
      await push(ctx);
      await pull(ctx);
      await pullProfile(ctx);
      await pullPreferences(ctx);
      await pullRecommendations(ctx);
      await pullReadingEvents(ctx);
      if (ctx.pushAgain) await push(ctx);
      if (!ctx.hadErrors) await cacheCovers(ctx);
      if (!ctx.hadErrors) {
        const lastSyncAt = now().toISOString();
        await setMeta(ctx.db, 'last_sync_at', lastSyncAt);
        emit({ lastSyncAt });
      }
    } catch {
      ctx.hadErrors = true;
      warnCode('sync', 'local_error');
    }
    if (ctx.changed && !stopped) onRemoteChanges();
    if (ctx.profileChanged && !stopped) onProfileChange();
    if (ctx.preferencesChanged && !stopped) onPreferencesChange();
    if (ctx.recommendationsChanged && !stopped) onRecommendationsChange();
    try {
      await refreshCounts(active.db);
    } catch {
      // The database was closed meanwhile (sign-out).
    }
    emit({ status: ctx.hadErrors || snapshot.failedCount > 0 ? 'error' : 'idle' });
  };

  const syncNow = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (running) {
      rerun = true;
      return running;
    }
    running = (async () => {
      do {
        rerun = false;
        await runOnce();
      } while (rerun);
    })().finally(() => {
      running = null;
    });
    return running;
  };

  return {
    start() {
      if (unsubscribers.length > 0) return;
      unsubscribers = [
        network.subscribe((online) => {
          const restored = online && lastOnline === false;
          lastOnline = online;
          if (!online) emit({ status: 'offline' });
          if (restored) void syncNow();
        }),
        ...(foreground ? [foreground.subscribe((active) => active && void syncNow())] : []),
      ];
      void syncNow();
    },

    stop() {
      for (const unsubscribe of unsubscribers) unsubscribe();
      unsubscribers = [];
      lastOnline = null;
      if (debounce) clearTimeout(debounce);
      debounce = null;
      stopped = true;
      snapshot = EMPTY_SYNC_SNAPSHOT;
      onSnapshot(snapshot);
    },

    syncNow,

    async retryFailed() {
      const active = await session.current();
      if (!active) return;
      await active.db.runAsync(
        'UPDATE sync_queue SET failed = 0, attempts = 0, last_error_code = NULL, next_attempt_at = NULL WHERE failed = 1',
      );
      await refreshCounts(active.db);
      await syncNow();
    },

    notifyLocalChange() {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = null;
        void syncNow();
      }, debounceMs);
      void session.current().then((active) => (active ? refreshCounts(active.db) : undefined));
    },
  };
}
