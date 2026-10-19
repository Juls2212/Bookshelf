// The signed-in user's local library: opens that user's database and runs the initial pull
// before the first read, so screens see pulled books (or an empty library when offline).
import { openUserDatabase } from '@/db/database';
import type { SqlDatabase } from '@/db/sql';
import { deviceNetwork } from '@/lib/network';

import { runInitialPull } from './initialPull';
import { supabaseBookGateway } from './supabaseBookGateway';

export type LibrarySession = {
  /** Opens the user's database (idempotent for the same user; switches users safely). */
  start(userId: string): Promise<SqlDatabase>;
  /** The ready database of the current user, or null when nobody is signed in. */
  current(): Promise<{ db: SqlDatabase; userId: string } | null>;
  /** Closes the database (files are kept). Resolves once it is closed. */
  stop(): Promise<void>;
};

type Deps = {
  open?: (userId: string) => Promise<SqlDatabase>;
  /** Runs once per start, after migrations (initial pull). Failures never block the app. */
  prepare?: (db: SqlDatabase) => Promise<unknown>;
};

export function createLibrarySession({
  open = (userId) => openUserDatabase(userId),
  prepare = async () => undefined,
}: Deps = {}): LibrarySession {
  let active: { userId: string; ready: Promise<SqlDatabase> } | null = null;
  let closing: Promise<void> = Promise.resolve();

  const closeQuietly = async (ready: Promise<SqlDatabase>) => {
    try {
      await (await ready).close();
    } catch {
      // Already closed or never opened.
    }
  };

  return {
    start(userId) {
      if (active?.userId === userId) return active.ready;
      if (active) closing = closeQuietly(active.ready);
      const ready = (async () => {
        const db = await open(userId);
        await prepare(db).catch(() => undefined);
        return db;
      })();
      active = { userId, ready };
      return ready;
    },

    async current() {
      const session = active;
      if (!session) return null;
      const db = await session.ready;
      // The user may have changed while the database was opening.
      return active === session ? { db, userId: session.userId } : null;
    },

    async stop() {
      const session = active;
      active = null;
      // A second stop() waits for the close started by the first one.
      if (session) closing = closeQuietly(session.ready);
      await closing;
    },
  };
}

// Offline, the initial pull is skipped (no request that can only time out): the sync engine
// runs it as soon as the connection returns, and the screens show the first-run message.
export const librarySession: LibrarySession = createLibrarySession({
  prepare: async (db) =>
    (await deviceNetwork.isOnline()) ? runInitialPull(db, supabaseBookGateway) : 'skipped',
});
