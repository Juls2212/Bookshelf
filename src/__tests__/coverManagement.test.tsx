// Phase 9.3.2: accepting a suggested cover (redirects), and cover management in the book form
// (change, suggest, remove) with the local-first removal and its sync.
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { ToastProvider } from '@/components/Toast';
import { openUserDatabase } from '@/db/database';
import { listSyncQueue } from '@/db/syncQueue';
import { ThemeProvider } from '@/design/ThemeProvider';
import { BookForm } from '@/features/library/BookForm';
import { emptyBookForm } from '@/features/library/bookFormLogic';
import { createCoverFinder, type CoverFinder } from '@/features/library/coverFinder';
import type { LocalImage } from '@/features/library/coverService';
import {
  downloadedImageExtension,
  isAllowedRedirectUrl,
  MAX_COVER_REDIRECTS,
  type CoverCandidate,
} from '@/features/library/coverSuggestion';
import { editBook } from '@/features/library/editBook';
import { upsertRemoteRow } from '@/features/library/initialPull';
import { createLibrarySession } from '@/features/library/librarySession';
import type { LocalBookRow } from '@/features/library/localBookRow';
import { createSqliteBookRepository } from '@/features/library/sqliteBookRepository';
import type { RemoteBookUpsert } from '@/features/library/supabaseBookGateway';
import { createSyncEngine } from '@/features/sync/syncEngine';
import { format, t } from '@/i18n';
import { fakeAvatars } from '@/test-utils/fakeAvatars';
import { fakePreferencesServer } from '@/test-utils/fakePreferencesServer';
import { fakeReadingEventServer } from '@/test-utils/fakeReadingEventServer';
import { fakeRecommendationServer } from '@/test-utils/fakeRecommendationServer';
import { createMemoryOpener } from '@/test-utils/nodeSqlite';
import type { Book } from '@/types/book';
import type { UserBookRow } from '@/types/database';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(), deleteDatabaseAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ getSupabaseClient: jest.fn() }));

const USER = '11111111-1111-4111-8111-111111111111';
const c = t.bookForm.coverSuggestion;
const OL = 'https://covers.openlibrary.org/b/id/8231856-L.jpg?default=false';
const ARCHIVE =
  'https://ia800100.us.archive.org/view_archive.php?archive=/x.zip&file=8231856-L.jpg';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

// ---------------------------------------------------------------------------
// Accepting: redirects, types, sizes
// ---------------------------------------------------------------------------

type Step = {
  status?: number;
  location?: string;
  type?: string | null;
  url?: string;
  bytes?: Uint8Array;
};

/** A fetch that answers each call with the next step. */
function scriptedFetch(steps: Step[]) {
  return jest.fn(async (input: unknown) => {
    const step = steps.shift() ?? { status: 404 };
    const headers: Record<string, string | null | undefined> = {
      location: step.location,
      'content-type': step.type === undefined ? 'image/jpeg' : step.type,
      'content-length': step.bytes ? String(step.bytes.byteLength) : null,
    };
    const status = step.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      url: step.url ?? String(input),
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
      arrayBuffer: async () => (step.bytes ?? JPEG).buffer.slice(0),
    } as unknown as Response;
  });
}

const olCandidate: CoverCandidate = {
  imageUrl: OL,
  source: 'open_library',
  title: 'Don Quijote',
  author: null,
};

function finderWith(steps: Step[], size = { width: 300, height: 450 }) {
  const fetchImpl = scriptedFetch(steps);
  const files = { write: jest.fn(() => 'file:///cache/c.jpg'), remove: jest.fn() };
  const finder = createCoverFinder({
    getClient: () => ({ functions: { invoke: jest.fn() } }) as never,
    fetchImpl,
    files,
    covers: { measure: jest.fn(async () => ({ ok: true as const, data: size })) },
  });
  return { finder, fetchImpl, files };
}

describe('accepting a suggested cover (download)', () => {
  it('follows the Open Library redirect to archive.org (the cause of the skipped covers)', async () => {
    const f = finderWith([
      { status: 302, location: ARCHIVE },
      { type: 'image/jpeg;charset=UTF-8' },
    ]);
    await expect(f.finder.download(olCandidate)).resolves.toMatchObject({
      uri: 'file:///cache/c.jpg',
      width: 300,
    });
    expect(f.fetchImpl).toHaveBeenNthCalledWith(
      1,
      OL,
      expect.objectContaining({ redirect: 'manual' }),
    );
    expect(f.fetchImpl).toHaveBeenNthCalledWith(2, ARCHIVE, expect.anything());
  });

  it('also accepts it when the platform followed the redirect itself', async () => {
    const f = finderWith([{ url: ARCHIVE }]);
    await expect(f.finder.download(olCandidate)).resolves.not.toBeNull();
  });

  it('rejects a redirect to a host that is not allowed, or to http', async () => {
    for (const location of ['https://evil.example/x.jpg', 'http://ia800100.us.archive.org/x.jpg']) {
      const f = finderWith([{ status: 302, location }]);
      await expect(f.finder.download(olCandidate)).resolves.toBeNull();
      expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    }
    const followed = finderWith([{ url: 'https://evil.example/x.jpg' }]);
    await expect(followed.finder.download(olCandidate)).resolves.toBeNull();
  });

  it('stops after three redirects', async () => {
    const hop = { status: 301, location: ARCHIVE };
    const f = finderWith([hop, hop, hop, hop, {}]);
    await expect(f.finder.download(olCandidate)).resolves.toBeNull();
    expect(f.fetchImpl).toHaveBeenCalledTimes(MAX_COVER_REDIRECTS + 1);
    const ok = finderWith([hop, hop, hop, {}]);
    await expect(ok.finder.download(olCandidate)).resolves.not.toBeNull();
  });

  it('the first URL must be on the strict allowlist (archive.org only as a redirect)', async () => {
    const f = finderWith([{}]);
    await expect(f.finder.download({ ...olCandidate, imageUrl: ARCHIVE })).resolves.toBeNull();
    expect(f.fetchImpl).not.toHaveBeenCalled();
    expect(isAllowedRedirectUrl(ARCHIVE)).toBe(true);
    expect(isAllowedRedirectUrl('https://archive.org/download/x.jpg')).toBe(true);
    expect(isAllowedRedirectUrl('https://notarchive.org/x.jpg')).toBe(false);
    expect(isAllowedRedirectUrl('https://archive.org.evil.example/x.jpg')).toBe(false);
  });

  it('types: charset suffixes, missing type sniffed from the bytes, HTML refused', async () => {
    expect(downloadedImageExtension('image/jpeg; charset=binary', JPEG)).toBe('jpg');
    expect(downloadedImageExtension(null, JPEG)).toBe('jpg');
    expect(downloadedImageExtension('application/octet-stream', JPEG)).toBe('jpg');
    expect(downloadedImageExtension('text/html', JPEG)).toBeNull();
    expect(downloadedImageExtension(null, new Uint8Array([1, 2, 3]))).toBeNull();
    const noType = finderWith([{ type: null }]);
    await expect(noType.finder.download(olCandidate)).resolves.not.toBeNull();
  });

  it('a 1x1 placeholder is still rejected after the redirect', async () => {
    const f = finderWith([{ status: 302, location: ARCHIVE }, {}], { width: 1, height: 1 });
    await expect(f.finder.download(olCandidate)).resolves.toBeNull();
    expect(f.files.remove).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The form: change, suggest, remove
// ---------------------------------------------------------------------------

const candidate = (n: number): CoverCandidate => ({
  imageUrl: `https://covers.openlibrary.org/b/id/${n}-L.jpg?default=false`,
  source: 'open_library',
  title: `Libro ${n}`,
  author: null,
});
const downloaded: LocalImage = {
  uri: 'file:///cache/suggested.jpg',
  width: 300,
  height: 450,
  source: 'gallery',
};

function fakeFinder(candidates: CoverCandidate[] | null) {
  return {
    find: jest.fn<ReturnType<CoverFinder['find']>, Parameters<CoverFinder['find']>>(
      async () => candidates,
    ),
    download: jest.fn<ReturnType<CoverFinder['download']>, Parameters<CoverFinder['download']>>(
      async () => downloaded,
    ),
  };
}

const values = { ...emptyBookForm, title: 'Don Quijote de la Mancha', pages: '900' };

async function renderForm(props: Partial<Parameters<typeof BookForm>[0]> = {}) {
  const onSubmit = jest.fn(async () => ({ ok: true as const }));
  const view = await render(
    <ThemeProvider>
      <ToastProvider>
        <BookForm
          initialValues={values}
          submitLabel={props.editing ? t.bookForm.editSave : t.bookForm.save}
          onSubmit={onSubmit}
          onCancel={jest.fn()}
          {...props}
        />
      </ToastProvider>
    </ThemeProvider>,
  );
  return { onSubmit, view };
}

const button = (name: string) => screen.getByRole('button', { name });
const noButton = (name: string) => screen.queryByRole('button', { name });

describe('edit form cover section', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('with a saved cover: "Cambiar portada", "Sugerir portada" and "Quitar portada"', async () => {
    const finder = fakeFinder([candidate(1)]);
    await renderForm({
      editing: true,
      existingCover: { uri: 'https://signed/c.jpg' },
      coverFinder: finder,
    });
    await act(async () => undefined);
    expect(button(t.bookForm.changeCover)).toBeOnTheScreen();
    expect(button(t.bookForm.suggestCover)).toBeOnTheScreen();
    expect(button(t.bookForm.removeCover)).toBeOnTheScreen();
    // No automatic search with a cover.
    await act(async () => jest.advanceTimersByTime(800));
    expect(finder.find).not.toHaveBeenCalled();
  });

  it('without a cover: "Añadir portada" and "Sugerir portada", no "Quitar portada"', async () => {
    await renderForm({ editing: true, coverFinder: fakeFinder([]) });
    await act(async () => undefined);
    expect(button(t.bookForm.addCover)).toBeOnTheScreen();
    expect(button(t.bookForm.suggestCover)).toBeOnTheScreen();
    expect(noButton(t.bookForm.removeCover)).toBeNull();
  });

  it('"Cambiar portada" offers the gallery and the camera', async () => {
    await renderForm({ editing: true, existingCover: { uri: 'https://signed/c.jpg' } });
    await act(async () => undefined);
    await fireEvent.press(button(t.bookForm.changeCover));
    expect(button(t.bookForm.coverFromGallery)).toBeOnTheScreen();
    expect(button(t.bookForm.coverFromCamera)).toBeOnTheScreen();
  });

  it('"Quitar portada" asks first; confirming saves the book without its cover', async () => {
    const { onSubmit } = await renderForm({
      editing: true,
      existingCover: { uri: 'https://signed/c.jpg' },
    });
    await act(async () => undefined);
    await fireEvent.press(button(t.bookForm.removeCover));
    expect(screen.getByText(t.bookForm.removeCoverMessage)).toBeOnTheScreen();
    // Cancelling keeps it.
    await fireEvent.press(screen.getByTestId('remove-cover-cancel'));
    expect(button(t.bookForm.removeCover)).toBeOnTheScreen();
    await fireEvent.press(button(t.bookForm.removeCover));
    await fireEvent.press(screen.getByTestId('remove-cover-confirm'));
    // Back to the typographic cover: "Añadir portada", no "Quitar portada".
    expect(button(t.bookForm.addCover)).toBeOnTheScreen();
    expect(noButton(t.bookForm.removeCover)).toBeNull();
    await fireEvent.press(button(t.bookForm.editSave));
    expect(onSubmit).toHaveBeenCalledWith(expect.anything(), null, { removeCover: true });
  });

  it('"Sugerir portada" replaces the cover only after "Usar esta portada"', async () => {
    const finder = fakeFinder([candidate(4)]);
    const { onSubmit } = await renderForm({
      editing: true,
      existingCover: { uri: 'https://signed/c.jpg' },
      coverFinder: finder,
      submitLabel: t.bookForm.editSave,
    });
    await act(async () => undefined);
    await fireEvent.press(button(t.bookForm.suggestCover));
    expect(finder.find).toHaveBeenCalledWith(
      { title: 'Don Quijote de la Mancha', author: null },
      expect.anything(),
    );
    expect(
      await screen.findByLabelText(format(c.imageA11y, { title: 'Libro 4' })),
    ).toBeOnTheScreen();
    // Seen, not applied: saving now keeps the current cover.
    await fireEvent.press(button(t.bookForm.editSave));
    expect(onSubmit).toHaveBeenLastCalledWith(expect.anything(), null);
    await fireEvent.press(button(c.accept));
    expect(screen.queryByTestId('cover-suggestion')).toBeNull();
    await fireEvent.press(button(t.bookForm.editSave));
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ uri: downloaded.uri }),
    );
  });

  it('an explicit request offline says so (the automatic one stays silent)', async () => {
    const finder = fakeFinder([candidate(1)]);
    const NetInfo = jest.requireMock<{ fetch: jest.Mock }>('@react-native-community/netinfo');
    NetInfo.fetch.mockResolvedValueOnce({ isConnected: false, isInternetReachable: false });
    await renderForm({
      editing: true,
      existingCover: { uri: 'https://signed/c.jpg' },
      coverFinder: finder,
    });
    await act(async () => undefined);
    await fireEvent.press(button(t.bookForm.suggestCover));
    expect(await screen.findByText(c.offline)).toBeOnTheScreen();
    expect(finder.find).not.toHaveBeenCalled();
  });
});

describe('add form: "Sugerir portada" to try again', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('appears after "No, gracias" and after "nothing found"', async () => {
    const finder = fakeFinder([candidate(1)]);
    await renderForm({ coverFinder: finder });
    await act(async () => jest.advanceTimersByTime(800));
    expect(noButton(t.bookForm.suggestCover)).toBeNull();
    await fireEvent.press(await screen.findByRole('button', { name: c.decline }));
    expect(button(t.bookForm.suggestCover)).toBeOnTheScreen();
    await fireEvent.press(button(t.bookForm.suggestCover));
    expect(await screen.findByTestId('cover-suggestion')).toBeOnTheScreen();
  });

  it('when the automatic search found nothing', async () => {
    await renderForm({ coverFinder: fakeFinder([]) });
    await act(async () => jest.advanceTimersByTime(800));
    expect(await screen.findByText(c.notFound)).toBeOnTheScreen();
    expect(button(t.bookForm.suggestCover)).toBeOnTheScreen();
  });
});

// ---------------------------------------------------------------------------
// Removal: local first, then sync
// ---------------------------------------------------------------------------

async function library() {
  const opener = createMemoryOpener();
  const session = createLibrarySession({ open: (u) => openUserDatabase(u, opener) });
  await session.start(USER);
  const db = (await session.current())!.db;
  let ids = 0;
  const repo = createSqliteBookRepository({ session, newId: () => `id-${++ids}` });
  const remote = new Map<string, UserBookRow>();
  const calls: string[] = [];
  let online = true;
  const offline = () => ({ ok: false as const, cause: new TypeError('Network request failed') });
  const upsertBook = jest.fn(async (row: RemoteBookUpsert) => {
    if (!online) return offline();
    calls.push(`upsert:${row.cover_path ?? 'null'}`);
    const saved = { ...row, updated_at: new Date().toISOString() } as UserBookRow;
    remote.set(row.id, saved);
    return { ok: true as const, data: saved };
  });
  const covers = {
    upload: jest.fn(async (_u: string, bookId: string) => {
      if (!online)
        return { ok: false as const, error: 'network_error' as const, cause: offline().cause };
      calls.push('upload');
      return { ok: true as const, data: `${USER}/${bookId}.jpg` };
    }),
    downloadToLocal: jest.fn(),
    remove: jest.fn(async (path: string) => {
      if (!online)
        return { ok: false as const, error: 'network_error' as const, cause: offline().cause };
      calls.push(`remove:${path}`);
      return { ok: true as const, data: null };
    }),
  };
  const engine = createSyncEngine({
    session,
    gateway: {
      upsertBook,
      pullChangedSince: jest.fn(async () => ({ ok: true as const, data: [] })),
      pullPage: jest.fn(async () => ({ ok: true as const, data: [] })),
      refreshSession: jest.fn(async () => true),
    },
    profiles: {
      pullProfile: jest.fn(async () => ({ ok: true as const, data: null })),
      pushProfile: jest.fn(),
    },
    preferences: fakePreferencesServer(USER).gateway,
    recommendations: fakeRecommendationServer().gateway,
    readingEvents: fakeReadingEventServer().gateway,
    covers,
    avatars: fakeAvatars().service,
    network: { isOnline: async () => online, subscribe: () => () => undefined },
    random: () => 0,
  });
  const row = (id: string) =>
    db.getFirstAsync<LocalBookRow>('SELECT * FROM books WHERE id = ?', [id]);
  const ops = async () => (await listSyncQueue(db)).map((e) => e.operation).sort();
  const withCover = async () => {
    const created = await repo.create({
      title: 'Libro',
      pageCount: 100,
      coverPath: `${USER}/id-1.jpg`,
      coverSource: 'gallery',
      localCoverUri: 'file:///documents/covers/u/id-1.jpg',
    });
    if (!created.ok) throw new Error('create');
    await engine.syncNow();
    calls.length = 0;
    return created.data;
  };
  const removeCover = (id: string) =>
    repo.update(id, { coverPath: null, coverSource: null, localCoverUri: null });
  return {
    db,
    repo,
    engine,
    covers,
    calls,
    row,
    ops,
    withCover,
    removeCover,
    setOnline: (value: boolean) => {
      online = value;
    },
  };
}

describe('replacing a cover (edit form)', () => {
  const replacement = (id: string) =>
    ({
      coverPath: `${USER}/${id}.jpg`,
      coverSource: 'gallery',
      localCoverUri: 'file:///documents/covers/u/id-1_new.jpg',
    }) as const;

  it('writes the new local file and queues the row and the upload in one update', async () => {
    const l = await library();
    const book = await l.withCover();
    await expect(l.repo.update(book.id, replacement(book.id))).resolves.toMatchObject({
      ok: true,
      data: { localCoverUri: 'file:///documents/covers/u/id-1_new.jpg' },
    });
    expect(await l.row(book.id)).toMatchObject({
      local_cover_uri: 'file:///documents/covers/u/id-1_new.jpg',
      sync_state: 'pending',
    });
    expect(await l.ops()).toEqual(['cover_upload', 'upsert']);
  });

  it('uploads the new file on sync, then the row', async () => {
    const l = await library();
    const book = await l.withCover();
    await l.repo.update(book.id, replacement(book.id));
    await l.engine.syncNow();
    expect(l.covers.upload).toHaveBeenLastCalledWith(
      USER,
      book.id,
      'file:///documents/covers/u/id-1_new.jpg',
    );
    expect(l.calls).toEqual(['upload', `upsert:${USER}/${book.id}.jpg`]);
    expect(await l.ops()).toEqual([]);
  });

  it('a text-only edit does not queue an upload', async () => {
    const l = await library();
    const book = await l.withCover();
    await l.repo.update(book.id, { title: 'Otro título' });
    expect(await l.ops()).toEqual(['upsert']);
  });
});

describe('removing a cover (local first, then sync)', () => {
  it('clears the cover locally and queues the row and the image removal together', async () => {
    const l = await library();
    const book = await l.withCover();
    await expect(l.removeCover(book.id)).resolves.toMatchObject({
      ok: true,
      data: { coverPath: null, localCoverUri: null },
    });
    expect(await l.row(book.id)).toMatchObject({
      cover_path: null,
      local_cover_uri: null,
      sync_state: 'pending',
    });
    expect(await l.ops()).toEqual(['cover_remove', 'upsert']);
  });

  it('pushes the row first, then deletes the remote image', async () => {
    const l = await library();
    const book = await l.withCover();
    await l.removeCover(book.id);
    await l.engine.syncNow();
    expect(l.calls).toEqual(['upsert:null', `remove:${USER}/${book.id}.jpg`]);
    expect(await l.ops()).toEqual([]);
  });

  it('offline: stays queued and syncs later', async () => {
    const l = await library();
    const book = await l.withCover();
    l.setOnline(false);
    await l.removeCover(book.id);
    await l.engine.syncNow();
    expect(await l.ops()).toEqual(['cover_remove', 'upsert']);
    l.setOnline(true);
    await l.db.runAsync('UPDATE sync_queue SET next_attempt_at = NULL');
    await l.engine.syncNow();
    expect(l.calls).toEqual(['upsert:null', `remove:${USER}/${book.id}.jpg`]);
    expect(await l.ops()).toEqual([]);
  });

  it('an image that is already gone on the server counts as removed', async () => {
    const l = await library();
    const book = await l.withCover();
    l.covers.remove.mockResolvedValueOnce({
      ok: false,
      error: 'not_found',
      cause: { status: 404 },
    } as never);
    await l.removeCover(book.id);
    await l.engine.syncNow();
    expect(await l.ops()).toEqual([]);
  });

  it('a new cover after the removal cancels the removal (never deletes the new image)', async () => {
    const l = await library();
    const book = await l.withCover();
    l.setOnline(false);
    await l.removeCover(book.id);
    await l.repo.update(book.id, {
      coverPath: `${USER}/${book.id}.jpg`,
      coverSource: 'gallery',
      localCoverUri: 'file:///documents/covers/u/id-1.jpg',
    });
    expect(await l.ops()).toEqual(['cover_upload', 'upsert']);
    l.setOnline(true);
    await l.db.runAsync('UPDATE sync_queue SET next_attempt_at = NULL');
    await l.engine.syncNow();
    expect(l.calls.some((call) => call.startsWith('remove'))).toBe(false);
  });

  it('a cover removed on another device drops the local copy on pull', async () => {
    const l = await library();
    const book = await l.withCover();
    const synced = await l.row(book.id);
    const fromServer = {
      ...(synced as unknown as UserBookRow),
      cover_path: null,
      cover_source: null,
      updated_at: new Date(Date.now() + 60_000).toISOString(),
    };
    await l.db.transaction((tx) => upsertRemoteRow(tx, fromServer));
    expect(await l.row(book.id)).toMatchObject({ cover_path: null, local_cover_uri: null });
  });

  it('editBook clears the local file and the cached signed URL after the update', async () => {
    const order: string[] = [];
    const book = {
      id: 'b1',
      coverPath: `${USER}/b1.jpg`,
      localCoverUri: 'file:///documents/covers/u/b1.jpg',
    } as Book;
    const covers = {
      prepare: jest.fn(),
      saveLocal: jest.fn(),
      removeLocal: jest.fn((uri: string) => order.push(`removeLocal:${uri}`)),
      forgetSignedUrl: jest.fn((path: string) => order.push(`forget:${path}`)),
    };
    const update = jest.fn(async (_id: string, patch: object) => {
      order.push(`update:${JSON.stringify(patch)}`);
      return { ok: true as const, data: { ...book, coverPath: null, localCoverUri: null } };
    });
    await editBook(
      { userId: USER, book, patch: {}, cover: null, removeCover: true },
      { update, covers },
    );
    expect(order).toEqual([
      'update:{"coverPath":null,"coverSource":null,"localCoverUri":null}',
      'removeLocal:file:///documents/covers/u/b1.jpg',
      `forget:${USER}/b1.jpg`,
    ]);
  });
});
