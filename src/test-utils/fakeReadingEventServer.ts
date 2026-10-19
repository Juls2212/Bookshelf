// In-memory stand-in for the reading_events table, for sync tests. Insert-only and idempotent
// by id like the real one; each insert gets a later server created_at.
import type { ReadingEventSyncGateway } from '@/features/library/supabaseReadingEventGateway';
import type { ReadingEventRow } from '@/types/database';

export function fakeReadingEventServer(rows: ReadingEventRow[] = []) {
  const stored = new Map<string, ReadingEventRow>(rows.map((row) => [row.id, row]));
  let clock = Date.parse('2026-10-14T12:00:00.000Z');
  const insert = (event: Omit<ReadingEventRow, 'created_at'>) => {
    if (stored.has(event.id)) return false;
    clock += 1000;
    stored.set(event.id, { ...event, created_at: new Date(clock).toISOString() });
    return true;
  };
  const gateway = {
    pushEvent: jest.fn<
      ReturnType<ReadingEventSyncGateway['pushEvent']>,
      Parameters<ReadingEventSyncGateway['pushEvent']>
    >(async (event) => {
      insert(event);
      return { ok: true, data: null };
    }),
    pullEventsSince: jest.fn<
      ReturnType<ReadingEventSyncGateway['pullEventsSince']>,
      Parameters<ReadingEventSyncGateway['pullEventsSince']>
    >(async (since, offset, limit) => {
      const page = [...stored.values()]
        .filter((row) => row.created_at > since)
        .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
        .slice(offset, offset + limit);
      return { ok: true, data: page.map((row) => ({ ...row })) };
    }),
  };
  /** An event written by another device. */
  const addRemote = (event: Omit<ReadingEventRow, 'created_at'>) => insert(event);
  return { gateway, stored, addRemote };
}
