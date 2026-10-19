import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { openUserDatabase } from '@/db/database';
import { getMeta } from '@/db/syncQueue';
import { coverService } from '@/features/library/coverService';
import { runInitialPull } from '@/features/library/initialPull';
import { createLibrarySession } from '@/features/library/librarySession';
import { createSqliteBookRepository } from '@/features/library/sqliteBookRepository';
import {
  createSupabaseBookGateway,
  mapBookError,
  type BookRemoteGateway,
} from '@/features/library/supabaseBookGateway';
import { useCoverUris } from '@/features/library/useCoverUris';
import type { AppSupabaseClient } from '@/lib/supabase';
import { createMemoryOpener } from '@/test-utils/nodeSqlite';
import type { UserBookRow } from '@/types/database';

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'local-1') }));
jest.mock('expo-file-system', () => ({ File: jest.fn(), Directory: jest.fn(), Paths: {} }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));
jest.mock('@/lib/supabase', () => ({ getSupabaseClient: jest.fn() }));

const USER = '11111111-1111-4111-8111-111111111111';

const remote = (id: string, overrides: Partial<UserBookRow> = {}): UserBookRow => ({
  id,
  user_id: USER,
  title: `Remote ${id}`,
  author: null,
  genre: null,
  page_count: null,
  cover_path: null,
  cover_source: null,
  reading_status: 'to_read',
  current_page: 0,
  rating: null,
  notes: null,
  lent_to: null,
  lent_at: null,
  status_changed_at: '2026-09-01T00:00:00+00:00',
  created_at: '2026-09-01T00:00:00+00:00',
  updated_at: '2026-09-02T00:00:00+00:00',
  deleted_at: null,
  ...overrides,
});

function gatewayWith(rows: UserBookRow[]) {
  const pullPage = jest.fn(async (offset: number, limit: number) => ({
    ok: true as const,
    data: rows.slice(offset, offset + limit),
  }));
  return { pullPage } satisfies BookRemoteGateway;
}

async function openDb() {
  return openUserDatabase(USER, createMemoryOpener());
}

const NOW = () => new Date('2026-10-11T12:00:00.000Z');

describe('runInitialPull', () => {
  it('pulls every page (including soft-deleted rows) and marks the pull as done', async () => {
    const db = await openDb();
    const gateway = gatewayWith([
      remote('a'),
      remote('b', { deleted_at: '2026-09-05T00:00:00+00:00' }),
      remote('c'),
    ]);
    await expect(runInitialPull(db, gateway, { now: NOW, pageSize: 2 })).resolves.toBe('done');
    expect(gateway.pullPage.mock.calls).toEqual([
      [0, 2],
      [2, 2],
    ]);
    const rows = await db.getAllAsync<{
      id: string;
      sync_state: string;
      deleted_at: string | null;
    }>('SELECT id, sync_state, deleted_at FROM books ORDER BY id');
    expect(rows).toEqual([
      { id: 'a', sync_state: 'synced', deleted_at: null },
      { id: 'b', sync_state: 'synced', deleted_at: '2026-09-05T00:00:00+00:00' },
      { id: 'c', sync_state: 'synced', deleted_at: null },
    ]);
    expect(await getMeta(db, 'initial_pull_done')).toBe('true');
    // Cursor = newest server updated_at among pulled rows.
    expect(await getMeta(db, 'last_pull_at')).toBe('2026-09-02T00:00:00.000Z');

    // Done once: later starts skip it.
    await expect(runInitialPull(db, gateway, { now: NOW })).resolves.toBe('skipped');
  });

  it('never overwrites rows with pending local changes', async () => {
    const opener = createMemoryOpener();
    const session = createLibrarySession({ open: (u) => openUserDatabase(u, opener) });
    const repo = createSqliteBookRepository({ session, now: NOW });
    await session.start(USER);
    await repo.create({ id: 'a', title: 'Local edit', pageCount: 200 });
    const db = (await session.current())!.db;

    await runInitialPull(db, gatewayWith([remote('a', { title: 'Server title' }), remote('b')]), {
      now: NOW,
    });
    const list = await repo.list();
    expect(list.ok && list.data.map((b) => b.title).sort()).toEqual(['Local edit', 'Remote b']);
  });

  it('offline: nothing is marked done, so the next start retries', async () => {
    const db = await openDb();
    const offline: BookRemoteGateway = {
      pullPage: jest.fn(async () => ({ ok: false as const, error: 'network_error' as const })),
    };
    await expect(runInitialPull(db, offline, { now: NOW })).resolves.toBe('failed');
    expect(await getMeta(db, 'initial_pull_done')).toBeNull();

    await expect(runInitialPull(db, gatewayWith([remote('a')]), { now: NOW })).resolves.toBe(
      'done',
    );
  });

  it('gives up on a hanging page instead of blocking the app', async () => {
    const db = await openDb();
    const hanging: BookRemoteGateway = { pullPage: () => new Promise(() => {}) };
    await expect(runInitialPull(db, hanging, { now: NOW, pageTimeoutMs: 10 })).resolves.toBe(
      'failed',
    );
  });

  it('a failing pull never blocks opening the library', async () => {
    const opener = createMemoryOpener();
    const session = createLibrarySession({
      open: (u) => openUserDatabase(u, opener),
      prepare: () => Promise.reject(new Error('offline')),
    });
    const repo = createSqliteBookRepository({ session });
    await session.start(USER);
    await expect(repo.list()).resolves.toEqual({ ok: true, data: [] });
  });
});

describe('supabaseBookGateway', () => {
  it('pulls pages in a stable order, including deleted rows', async () => {
    const calls: [string, unknown[]][] = [];
    const query: Record<string, unknown> = {};
    for (const method of ['select', 'order', 'range']) {
      query[method] = (...args: unknown[]) => {
        calls.push([method, args]);
        return query;
      };
    }
    query.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: [remote('a')], error: null }).then(resolve);
    const client = { from: jest.fn(() => query) } as unknown as AppSupabaseClient;

    const result = await createSupabaseBookGateway(() => client).pullPage(200, 100);
    expect(result).toEqual({ ok: true, data: [remote('a')] });
    expect(client.from).toHaveBeenCalledWith('user_books');
    expect(calls.find(([m]) => m === 'select')?.[1][0]).toContain('deleted_at');
    expect(calls.filter(([m]) => m === 'order').map(([, a]) => a[0])).toEqual(['created_at', 'id']);
    expect(calls.find(([m]) => m === 'range')?.[1]).toEqual([200, 299]);
  });

  it.each([
    [{ message: 'TypeError: Network request failed' }, 'network_error'],
    [{ code: 'PGRST116' }, 'not_found'],
    [{ code: '42501' }, 'unauthorized'],
    [{ statusCode: '403', message: 'denied' }, 'unauthorized'],
    [{ code: '23514' }, 'validation_failed'],
    [null, 'unknown'],
  ] as const)('mapBookError(%p) -> %s', (error, expected) => {
    expect(mapBookError(error)).toBe(expected);
  });
});

describe('useCoverUris', () => {
  type CoverBook = {
    id: string;
    coverPath: string | null;
    updatedAt: string;
    localCoverUri?: string | null;
  };

  function Probe({ books }: { books: CoverBook[] }) {
    const covered = useCoverUris(books);
    return (
      <>
        {covered.map((b) => (
          <Text key={b.id}>{`${b.id}:${b.coverUri ?? 'none'}`}</Text>
        ))}
      </>
    );
  }

  it('a new cover file gives a new image cache key, even with the same updated_at', async () => {
    function KeyProbe({ book }: { book: CoverBook }) {
      const [covered] = useCoverUris([book]);
      return <Text>{`key:${covered.coverCacheKey}`}</Text>;
    }
    const base = { id: 'b', coverPath: 'u/b.jpg', updatedAt: 't' };
    const { rerender } = await render(
      <KeyProbe book={{ ...base, localCoverUri: 'file:///covers/b_1.jpg' }} />,
    );
    expect(screen.getByText('key:file:///covers/b_1.jpg@t')).toBeOnTheScreen();
    await rerender(<KeyProbe book={{ ...base, localCoverUri: 'file:///covers/b_2.jpg' }} />);
    expect(screen.getByText('key:file:///covers/b_2.jpg@t')).toBeOnTheScreen();
  });

  it('prefers the local cover and only signs URLs for remote-only covers', async () => {
    const getSignedUrls = jest
      .spyOn(coverService, 'getSignedUrls')
      .mockResolvedValue({ ok: true, data: { 'u/remote.jpg': 'https://signed/remote' } });
    await render(
      <Probe
        books={[
          {
            id: 'local',
            coverPath: 'u/local.jpg',
            updatedAt: 't',
            localCoverUri: 'file:///local.jpg',
          },
          { id: 'remote', coverPath: 'u/remote.jpg', updatedAt: 't' },
          { id: 'plain', coverPath: null, updatedAt: 't' },
        ]}
      />,
    );
    expect(getSignedUrls).toHaveBeenCalledWith(['u/remote.jpg']);
    expect(screen.getByText('local:file:///local.jpg')).toBeOnTheScreen();
    expect(await screen.findByText('remote:https://signed/remote')).toBeOnTheScreen();
    expect(screen.getByText('plain:none')).toBeOnTheScreen();
  });
});
