// TEMPORARY view-model over fixtures, replaced in Phase 3/4 by repositories/services.
import type { LibraryFilter } from '@/components/FilterTabs';
import type { SyncStatus } from '@/components/SyncStatusBadge';
import { isLent } from '@/lib/book';
import type { Book } from '@/types/book';

import {
  mockBooks,
  mockNoResultsQuery,
  mockProfile,
  mockRecommendations,
  type MockProfile,
  type MockRecommendation,
} from './fixtures';
import { useMockScenario, type MockScenario } from './scenarioStore';

export type MockStatus = 'loading' | 'ready' | 'error' | 'offline';

export type MockData = {
  scenario: MockScenario;
  status: MockStatus;
  books: Book[];
  reading: Book | null;
  savedRecommendation: MockRecommendation | null;
  recommendations: MockRecommendation[];
  profile: MockProfile;
  syncStatus: SyncStatus;
  initialQuery: string;
};

const statusFor: Record<MockScenario, MockStatus> = {
  full: 'ready',
  empty: 'ready',
  loading: 'loading',
  noResults: 'ready',
  noReading: 'ready',
  noRecommendation: 'ready',
  offline: 'offline',
  error: 'error',
};

const syncFor: Record<MockStatus, SyncStatus> = {
  loading: 'syncing',
  ready: 'synced',
  error: 'error',
  offline: 'error',
};

export function getMockData(scenario: MockScenario): MockData {
  let books = scenario === 'empty' || scenario === 'loading' ? [] : mockBooks;
  if (scenario === 'noReading') {
    // Nothing in progress and nothing left to read.
    books = books.map((b) =>
      b.readingStatus === 'finished' ? b : { ...b, readingStatus: 'finished', currentPage: null },
    );
  }
  const status = statusFor[scenario];
  const recommendations = books.length > 0 ? mockRecommendations : [];
  return {
    scenario,
    status,
    books,
    reading: books.find((b) => b.readingStatus === 'reading') ?? null,
    savedRecommendation:
      scenario === 'noRecommendation' || recommendations.length === 0 ? null : recommendations[0],
    recommendations,
    profile: mockProfile,
    syncStatus: syncFor[status],
    initialQuery: scenario === 'noResults' ? mockNoResultsQuery : '',
  };
}

export function useMockData(): MockData {
  return getMockData(useMockScenario());
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .trim();
}

/** UI-only filtering over fixtures (search + filter tab). */
export function filterMockBooks(books: Book[], query: string, filter: LibraryFilter): Book[] {
  const q = normalize(query);
  return books.filter((book) => {
    if (filter === 'lent' && !isLent(book)) return false;
    if (filter !== 'all' && filter !== 'lent' && book.readingStatus !== filter) return false;
    if (!q) return true;
    return normalize(book.title).includes(q) || normalize(book.author ?? '').includes(q);
  });
}

export function findMockBook(books: Book[], id: string | undefined): Book | null {
  return books.find((b) => b.id === id) ?? null;
}
