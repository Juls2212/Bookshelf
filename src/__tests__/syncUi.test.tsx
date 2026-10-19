import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import HomeScreen from '@/app/(tabs)/index';
import LibraryScreen from '@/app/(tabs)/library';
import ProfileScreen from '@/app/(tabs)/profile';
import { ToastProvider } from '@/components/Toast';
import { ThemeProvider } from '@/design/ThemeProvider';
import { signOutFlow } from '@/features/sync/signOutFlow';
import { SyncBadge } from '@/features/sync/SyncBadge';
import {
  firstRunState,
  lastSyncText,
  syncBadgeA11yLabel,
  syncBadgeFor,
  syncBadgeLabel,
  syncStatusText,
} from '@/features/sync/syncPresentation';
import { format, t } from '@/i18n';
import { formatDayTime } from '@/lib/dates';
import { EMPTY_SYNC_SNAPSHOT } from '@/features/sync/syncEngine';
import { useSyncStore } from '@/stores/syncStore';
import type { Book } from '@/types/book';

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
jest.mock('@/features/auth/authService', () => ({}));
const mockRouter = { push: jest.fn(), navigate: jest.fn(), back: jest.fn(), setParams: jest.fn() };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
}));
jest.mock('@/features/library/coverService', () => ({ coverService: {} }));
jest.mock('@/features/library/useCoverUris', () => ({ useCoverUris: <T,>(books: T[]) => books }));
jest.mock('@/components/ShelfMotion', () => ({
  ShelfMotion: ({ children }: { children: unknown }) => children,
}));
jest.mock('@/features/sync/signOutFlow', () => ({
  signOutFlow: { prepare: jest.fn(), signOut: jest.fn() },
}));

type MockLibraryState = {
  books: Book[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  errorCode: string | null;
  load: jest.Mock;
  refresh: jest.Mock;
};
const mockLibrary: { state: MockLibraryState } = {
  state: { books: [], status: 'ready', errorCode: null, load: jest.fn(), refresh: jest.fn() },
};
jest.mock('@/stores/libraryStore', () => {
  const useLibraryStore = <T,>(selector: (s: MockLibraryState) => T) => selector(mockLibrary.state);
  useLibraryStore.getState = () => mockLibrary.state;
  return { useLibraryStore };
});

const flow = signOutFlow as jest.Mocked<typeof signOutFlow>;

function renderUi(ui: ReactElement) {
  return render(
    <ThemeProvider>
      <ToastProvider>{ui}</ToastProvider>
    </ThemeProvider>,
  );
}

const syncNow = jest.fn(async () => undefined);
const retryFailed = jest.fn(async () => undefined);

function setSync(patch: Partial<typeof EMPTY_SYNC_SNAPSHOT>) {
  useSyncStore.setState({ ...EMPTY_SYNC_SNAPSHOT, initialPullDone: true, ...patch });
}

beforeEach(() => {
  jest.clearAllMocks();
  useSyncStore.setState({ syncNow, retryFailed });
  setSync({});
  mockLibrary.state = {
    books: [],
    status: 'ready',
    errorCode: null,
    load: jest.fn(),
    refresh: jest.fn(),
  };
});

describe('sync presentation', () => {
  it.each([
    [{ status: 'idle', pendingCount: 0, failedCount: 0 }, 'synced', 0],
    [{ status: 'syncing', pendingCount: 2, failedCount: 0 }, 'syncing', 2],
    [{ status: 'idle', pendingCount: 3, failedCount: 0 }, 'pending', 3],
    [{ status: 'offline', pendingCount: 2, failedCount: 1 }, 'offline', 3],
    [{ status: 'error', pendingCount: 1, failedCount: 2 }, 'error', 2],
    [{ status: 'error', pendingCount: 0, failedCount: 0 }, 'error', 0],
    // A retryable failure (e.g. unreachable server) keeps the changes pending.
    [{ status: 'error', pendingCount: 1, failedCount: 0 }, 'pending', 1],
  ] as const)('%p -> %s', (counts, kind, count) => {
    expect(syncBadgeFor(counts)).toEqual({ kind, count });
  });

  it('writes singular, plural and offline labels from i18n', () => {
    expect(syncBadgeLabel({ kind: 'pending', count: 1 })).toBe(t.sync.badge.pendingOne);
    expect(syncBadgeLabel({ kind: 'pending', count: 4 })).toBe(
      format(t.sync.badge.pendingMany, { count: 4 }),
    );
    expect(syncBadgeLabel({ kind: 'offline', count: 0 })).toBe(t.sync.badge.offline);
    expect(syncBadgeLabel({ kind: 'offline', count: 2 })).toBe(
      format(t.sync.badge.offlinePendingMany, { count: 2 }),
    );
    expect(syncBadgeA11yLabel({ kind: 'error', count: 1 })).toBe(t.sync.a11y.errorOne);
    expect(syncStatusText({ kind: 'error', count: 3 })).toBe(
      format(t.sync.failedMany, { count: 3 }),
    );
    expect(syncStatusText({ kind: 'synced', count: 0 })).toBe(t.sync.status.synced);
  });

  it('formats the last sync time with the date helpers', () => {
    const now = new Date(2026, 9, 11, 18, 0);
    expect(lastSyncText(null, now)).toBe(t.sync.neverSynced);
    expect(lastSyncText(new Date(2026, 9, 11, 14, 5).toISOString(), now)).toBe(
      format(t.sync.lastSync, { when: `${t.dates.today}, 14:05` }),
    );
    expect(lastSyncText(new Date(2026, 9, 10, 9, 30).toISOString(), now)).toBe(
      format(t.sync.lastSync, { when: `${t.dates.yesterday}, 09:30` }),
    );
  });

  it('only shows a first-run state before the first download, with no local books', () => {
    expect(firstRunState({ status: 'offline', initialPullDone: false }, false)).toBe('offline');
    expect(firstRunState({ status: 'error', initialPullDone: false }, false)).toBe('failed');
    expect(firstRunState({ status: 'syncing', initialPullDone: false }, false)).toBe('loading');
    expect(firstRunState({ status: 'idle', initialPullDone: null }, false)).toBe('loading');
    expect(firstRunState({ status: 'offline', initialPullDone: false }, true)).toBeNull();
    expect(firstRunState({ status: 'offline', initialPullDone: true }, false)).toBeNull();
  });
});

describe('SyncBadge', () => {
  it.each([
    [{ status: 'idle' }, t.sync.badge.synced, t.sync.a11y.synced],
    [{ status: 'syncing' }, t.sync.badge.syncing, t.sync.a11y.syncing],
    [{ status: 'idle', pendingCount: 1 }, t.sync.badge.pendingOne, t.sync.a11y.pendingOne],
    [
      { status: 'offline', pendingCount: 2 },
      format(t.sync.badge.offlinePendingMany, { count: 2 }),
      format(t.sync.a11y.offlinePendingMany, { count: 2 }),
    ],
  ] as const)(
    'shows the real state %p as text and accessible label',
    async (patch, text, label) => {
      setSync(patch);
      await renderUi(<SyncBadge />);
      expect(screen.getByText(text)).toBeTruthy();
      expect(screen.getByLabelText(label)).toBeTruthy();
      expect(screen.queryByRole('button')).toBeNull();
    },
  );

  it('in the error state is a button that retries the failed changes', async () => {
    setSync({ status: 'error', failedCount: 2 });
    await renderUi(<SyncBadge />);
    const badge = screen.getByRole('button', {
      name: format(t.sync.a11y.errorMany, { count: 2 }),
    });
    expect(badge.props.accessibilityHint).toBe(t.sync.a11y.retryHint);
    expect(screen.getByText(t.sync.badge.error)).toBeTruthy();
    await fireEvent.press(badge);
    expect(retryFailed).toHaveBeenCalledTimes(1);
  });

  it('follows store changes (airplane mode, then reconnect)', async () => {
    setSync({ status: 'idle' });
    await renderUi(<SyncBadge />);
    await act(async () => setSync({ status: 'offline', pendingCount: 1 }));
    expect(screen.getByText(t.sync.badge.offlinePendingOne)).toBeTruthy();
    await act(async () => setSync({ status: 'idle', pendingCount: 0 }));
    expect(screen.getByText(t.sync.badge.synced)).toBeTruthy();
  });
});

describe('Perfil sync section', () => {
  it('shows the real state, the last sync and "Sincronizar ahora"', async () => {
    const last = new Date();
    setSync({ status: 'idle', lastSyncAt: last.toISOString() });
    await renderUi(<ProfileScreen />);
    expect(screen.getByText(t.sync.status.synced)).toBeTruthy();
    expect(
      screen.getByText(format(t.sync.lastSync, { when: formatDayTime(last, new Date()) })),
    ).toBeTruthy();
    expect(screen.queryByText(t.sync.retry)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: t.sync.syncNow }));
    expect(syncNow).toHaveBeenCalledTimes(1);
  });

  it('explains pending and offline states', async () => {
    setSync({ status: 'offline', pendingCount: 2 });
    await renderUi(<ProfileScreen />);
    expect(screen.getByText(t.sync.status.offline)).toBeTruthy();
    expect(screen.getByText(t.sync.neverSynced)).toBeTruthy();
  });

  it('with failed changes shows a clear message and "Reintentar"', async () => {
    setSync({ status: 'error', failedCount: 1 });
    await renderUi(<ProfileScreen />);
    expect(screen.getByText(t.sync.failedOne)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: t.sync.retry }));
    expect(retryFailed).toHaveBeenCalledTimes(1);
  });
});

describe('safe sign-out', () => {
  it('with nothing unsynced asks the usual confirmation and signs out', async () => {
    flow.prepare.mockResolvedValue('clean');
    flow.signOut.mockResolvedValue({ ok: true, data: null });
    await renderUi(<ProfileScreen />);
    await fireEvent.press(screen.getByRole('button', { name: t.profile.signOut }));
    expect(screen.getByText(t.profile.signOutTitle)).toBeTruthy();
    const buttons = screen.getAllByRole('button', { name: t.profile.signOut });
    await fireEvent.press(buttons[buttons.length - 1]);
    expect(flow.signOut).toHaveBeenCalledTimes(1);
  });

  it('with unsynced changes warns; "Cancelar" keeps the session', async () => {
    flow.prepare.mockResolvedValue('unsynced');
    await renderUi(<ProfileScreen />);
    await fireEvent.press(screen.getByRole('button', { name: t.profile.signOut }));
    expect(screen.getByText(t.profile.signOutUnsyncedTitle)).toBeTruthy();
    expect(screen.getByText(t.profile.signOutUnsyncedMessage)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: t.bookDetail.cancel }));
    expect(flow.signOut).not.toHaveBeenCalled();
    expect(screen.queryByText(t.profile.signOutUnsyncedTitle)).toBeNull();
  });

  it('with unsynced changes signs out only after "Cerrar sesión de todos modos"', async () => {
    flow.prepare.mockResolvedValue('unsynced');
    flow.signOut.mockResolvedValue({ ok: true, data: null });
    await renderUi(<ProfileScreen />);
    await fireEvent.press(screen.getByRole('button', { name: t.profile.signOut }));
    await fireEvent.press(screen.getByRole('button', { name: t.profile.signOutAnyway }));
    expect(flow.signOut).toHaveBeenCalledTimes(1);
  });
});

describe('first run offline', () => {
  it('Biblioteca shows the message instead of a skeleton and resumes when online', async () => {
    setSync({ status: 'offline', initialPullDone: false });
    await renderUi(<LibraryScreen />);
    expect(screen.getByText(t.library.firstRunOffline)).toBeTruthy();
    expect(screen.queryByText(t.emptyLibrary.title)).toBeNull();

    // Connection back: the engine pulls, the store reloads.
    mockLibrary.state = { ...mockLibrary.state, status: 'ready' };
    await act(async () => setSync({ status: 'idle', initialPullDone: true }));
    expect(screen.queryByText(t.library.firstRunOffline)).toBeNull();
    expect(screen.getByText(t.emptyLibrary.title)).toBeTruthy();
  });

  it('Inicio shows the same message', async () => {
    setSync({ status: 'offline', initialPullDone: false });
    await renderUi(<HomeScreen />);
    expect(screen.getByText(t.library.firstRunOffline)).toBeTruthy();
  });

  it('a failed first download (server unreachable) offers a retry through the engine', async () => {
    setSync({ status: 'error', initialPullDone: false });
    await renderUi(<LibraryScreen />);
    await fireEvent.press(screen.getByRole('button', { name: t.library.retry }));
    expect(syncNow).toHaveBeenCalledTimes(1);
  });

  it('Biblioteca shows the sync badge in its header', async () => {
    setSync({ status: 'idle', pendingCount: 2 });
    await renderUi(<LibraryScreen />);
    expect(screen.getByText(format(t.sync.badge.pendingMany, { count: 2 }))).toBeTruthy();
  });
});
