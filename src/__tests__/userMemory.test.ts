// Sign-out (or another account) clears every in-memory store and cache of the previous user.
import { bindUserMemoryToAuth, clearUserMemory } from '@/stores/userMemory';

const mockLibrary = { reset: jest.fn() };
const mockProfile = { clear: jest.fn() };
const mockPreferences = { clear: jest.fn() };
const mockRecommendations = { clear: jest.fn() };
const mockSyncSetState = jest.fn();
const mockCoverClear = jest.fn();
const mockSuggesterClear = jest.fn();

jest.mock('@/stores/authStore', () => {
  const { create } = jest.requireActual<typeof import('zustand')>('zustand');
  return { useAuthStore: create(() => ({ user: null as { id: string } | null })) };
});
jest.mock('@/stores/libraryStore', () => ({
  useLibraryStore: { getState: () => mockLibrary },
}));
jest.mock('@/stores/profileStore', () => ({
  useProfileStore: { getState: () => mockProfile },
}));
jest.mock('@/stores/preferencesStore', () => ({
  usePreferencesStore: { getState: () => mockPreferences },
}));
jest.mock('@/stores/recommendationsStore', () => ({
  useRecommendationsStore: { getState: () => mockRecommendations },
}));
jest.mock('@/stores/syncStore', () => ({
  useSyncStore: { setState: (...args: unknown[]) => mockSyncSetState(...args) },
}));
jest.mock('@/features/sync/syncEngine', () => ({
  EMPTY_SYNC_SNAPSHOT: { phase: 'idle', pendingCount: 0 },
}));
jest.mock('@/features/library/coverService', () => ({
  coverService: { clearCache: () => mockCoverClear() },
}));
jest.mock('@/features/suggestions/supabaseBookSuggester', () => ({
  supabaseBookSuggester: { clearCache: () => mockSuggesterClear() },
}));

// Imported after the mocks (jest.mock is hoisted).
const { useAuthStore } = jest.requireMock<{
  useAuthStore: import('zustand').StoreApi<{ user: { id: string } | null }>;
}>('@/stores/authStore');

const everyClear = () => [
  mockLibrary.reset,
  mockProfile.clear,
  mockPreferences.clear,
  mockRecommendations.clear,
  mockSyncSetState,
  mockCoverClear,
  mockSuggesterClear,
];

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({ user: null });
});

describe('user memory', () => {
  it('clearUserMemory resets every store and cache', () => {
    clearUserMemory();
    for (const fn of everyClear()) expect(fn).toHaveBeenCalledTimes(1);
    expect(mockSyncSetState).toHaveBeenCalledWith({ phase: 'idle', pendingCount: 0 });
  });

  it('clears on sign-out and on an account switch, never on sign-in', () => {
    const unbind = bindUserMemoryToAuth();
    useAuthStore.setState({ user: { id: 'a' } });
    expect(mockLibrary.reset).not.toHaveBeenCalled();

    useAuthStore.setState({ user: { id: 'b' } });
    for (const fn of everyClear()) expect(fn).toHaveBeenCalledTimes(1);

    useAuthStore.setState({ user: null });
    for (const fn of everyClear()) expect(fn).toHaveBeenCalledTimes(2);

    unbind();
    useAuthStore.setState({ user: { id: 'a' } });
    useAuthStore.setState({ user: null });
    expect(mockLibrary.reset).toHaveBeenCalledTimes(2);
  });

  it('a token refresh for the same user keeps the memory', () => {
    const unbind = bindUserMemoryToAuth();
    useAuthStore.setState({ user: { id: 'a' } });
    useAuthStore.setState({ user: { id: 'a' } });
    expect(mockLibrary.reset).not.toHaveBeenCalled();
    unbind();
  });
});
