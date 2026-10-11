// TEMPORARY fixtures, replaced in Phase 3/4 by the real data layer.
// This folder is the only place where Spanish content is allowed outside i18n:
// it is sample book/user content (titles, authors, notes, recommendation text), not UI copy.
import type { Book, ReadingStatus } from '@/types/book';

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();

type Seed = {
  title: string;
  author: string;
  genre: string;
  pageCount: number;
  readingStatus: ReadingStatus;
  currentPage?: number;
  rating?: number;
  notes?: string;
  lentTo?: string;
  lentDaysAgo?: number;
  statusChangedAt?: string;
  addedDaysAgo: number;
};

const seeds: Seed[] = [
  {
    title: 'Los almendros',
    author: 'Marta Elena Ossa',
    genre: 'Novela',
    pageCount: 312,
    readingStatus: 'reading',
    currentPage: 214,
    rating: 4,
    notes: 'La escena del huerto me recordó a la casa de mi abuela. Volver al capítulo 9.',
    statusChangedAt: '2026-10-02T09:00:00.000Z',
    addedDaysAgo: 60,
  },
  {
    title: 'Mapa de sal',
    author: 'Inés Carvajal',
    genre: 'Novela',
    pageCount: 224,
    readingStatus: 'to_read',
    addedDaysAgo: 200,
  },
  {
    title: 'Cartas a nadie',
    author: 'Julián Rueda',
    genre: 'Novela',
    pageCount: 248,
    readingStatus: 'to_read',
    addedDaysAgo: 12,
  },
  {
    title: 'El invierno de las abejas',
    author: 'Lucía Varela',
    genre: 'Novela',
    pageCount: 296,
    readingStatus: 'finished',
    rating: 5,
    addedDaysAgo: 150,
  },
  {
    title: 'Lo que callan los ríos',
    author: 'Tomás Aguirre',
    genre: 'Crónica',
    pageCount: 180,
    readingStatus: 'finished',
    rating: 4,
    addedDaysAgo: 140,
  },
  {
    title: 'Casa de vidrio',
    author: 'Renata Lobo',
    genre: 'Poesía',
    pageCount: 96,
    readingStatus: 'to_read',
    addedDaysAgo: 30,
  },
  {
    title: 'Ceniza y miel',
    author: 'Paula Zuleta',
    genre: 'Novela',
    pageCount: 264,
    readingStatus: 'to_read',
    addedDaysAgo: 8,
  },
  {
    title: 'Tiempo prestado',
    author: 'Andrés Mora',
    genre: 'Ensayo',
    pageCount: 210,
    readingStatus: 'finished',
    rating: 3,
    addedDaysAgo: 120,
  },
  {
    title: 'Noches de tinta',
    author: 'Elena Prado',
    genre: 'Poesía',
    pageCount: 120,
    readingStatus: 'to_read',
    addedDaysAgo: 45,
  },
  {
    title: 'Las horas quietas',
    author: 'Óscar Lamas',
    genre: 'Novela',
    pageCount: 188,
    readingStatus: 'to_read',
    addedDaysAgo: 70,
  },
  {
    title: 'Antes del alba',
    author: 'Camilo Rey',
    genre: 'Historia',
    pageCount: 340,
    readingStatus: 'to_read',
    addedDaysAgo: 90,
  },
  {
    title: 'Herbario',
    author: 'Sara Beltrán',
    genre: 'Ensayo',
    pageCount: 160,
    readingStatus: 'finished',
    rating: 4,
    lentTo: 'Laura',
    lentDaysAgo: 12,
    addedDaysAgo: 180,
  },
];

export const mockBooks: Book[] = seeds.map((seed, index) => {
  const created = daysAgo(seed.addedDaysAgo);
  return {
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    title: seed.title,
    author: seed.author,
    genre: seed.genre,
    pageCount: seed.pageCount,
    coverPath: null,
    coverSource: null,
    readingStatus: seed.readingStatus,
    currentPage: seed.currentPage ?? null,
    rating: seed.rating ?? null,
    notes: seed.notes ?? null,
    lentTo: seed.lentTo ?? null,
    lentAt: seed.lentDaysAgo != null ? daysAgo(seed.lentDaysAgo) : null,
    createdAt: created,
    updatedAt: created,
    statusChangedAt: seed.statusChangedAt ?? created,
  };
});

export type MockTime = 'short' | 'hour' | 'afternoon';
export type MockMood = 'calm' | 'gripping' | 'think';

export type MockRecommendation = {
  id: string;
  bookId: string;
  /** Short headline used on the Inicio card. */
  headline: string;
  reason: string;
};

const bookId = (title: string) => mockBooks.find((b) => b.title === title)?.id ?? '';

export const mockRecommendations: MockRecommendation[] = [
  {
    id: 'rec-1',
    bookId: bookId('Mapa de sal'),
    headline: 'Algo tranquilo para esta noche',
    reason:
      'Tienes una hora y quieres algo tranquilo: sus capítulos son cortos y se leen sin prisa. Lleva en tu estante desde marzo, esperándote.',
  },
  {
    id: 'rec-2',
    bookId: bookId('Ceniza y miel'),
    headline: 'Una historia que te atrape',
    reason:
      'Llegó a tu estante hace poco y su ritmo no da respiro. Ideal para una tarde larga sin interrupciones.',
  },
  {
    id: 'rec-3',
    bookId: bookId('Casa de vidrio'),
    headline: 'Poemas para pensar despacio',
    reason:
      'Son textos breves que piden pausa. Puedes leer unos pocos en veinte minutos y quedarte pensando en ellos.',
  },
];

export type MockProfile = {
  name: string;
  email: string;
  memberSince: string;
  favoriteGenres: readonly (
    'novel' | 'poetry' | 'history' | 'essay' | 'mystery' | 'chronicle' | 'fantasy' | 'biography'
  )[];
  preferences: { unreadFirst: boolean; mood: boolean; shortWeekdays: boolean };
};

export const mockProfile: MockProfile = {
  name: 'Juliana Peñafiel',
  email: 'juliana@correo.com',
  memberSince: '2026-10-01T12:00:00.000Z',
  favoriteGenres: ['novel', 'poetry', 'history', 'chronicle'],
  preferences: { unreadFirst: true, mood: true, shortWeekdays: false },
};

/** Query that matches nothing, used by the `noResults` scenario. */
export const mockNoResultsQuery = 'Rayuela';
