// Sample content returned by the fake services (identifier, suggester, recommender). They are
// only selectable from the dev gallery in development builds and used by tests; this is
// sample book content, not UI copy, and no screen reads it directly.
import type { IdentifiedBook } from '@/features/scan/bookIdentifier';
import type { SuggestedBook } from '@/features/suggestions/bookSuggester';

export const fakeIdentifiedBook: IdentifiedBook = {
  title: 'Cartas a nadie',
  author: 'Julián Rueda',
  genre: 'Novela epistolar',
  pageCount: 248,
  confidence: 'high',
  coverBox: { x: 0.22, y: 0.12, width: 0.56, height: 0.76 },
  // Photographed slightly at an angle.
  coverCorners: [
    { x: 0.25, y: 0.12 },
    { x: 0.77, y: 0.15 },
    { x: 0.78, y: 0.87 },
    { x: 0.22, y: 0.88 },
  ],
};

/** A blurry photo: only the title was read with some certainty. */
export const fakeLowConfidenceBook: IdentifiedBook = {
  title: 'Cartas a nadie',
  author: 'J. Rueda',
  genre: null,
  pageCount: null,
  confidence: 'low',
  coverBox: null,
  coverCorners: null,
};

export const fakeSuggestions: SuggestedBook[] = [
  {
    title: 'Cartas a nadie',
    canonicalTitle: null,
    author: 'Julián Rueda',
    genre: 'Novela',
    pageCount: 248,
  },
  {
    title: 'Cartas a nadie (edición ilustrada)',
    canonicalTitle: null,
    author: 'Julián Rueda',
    genre: 'Novela',
    pageCount: 312,
  },
  {
    title: 'Cartas sin nadie',
    canonicalTitle: null,
    author: 'Marta Ossa',
    genre: 'Poesía',
    pageCount: null,
  },
];

export const fakeRationale =
  'Lleva tiempo esperando en tu estante y encaja con los géneros que prefieres.';

/** "Nuevas aventuras" samples: verified, unverified and low-confidence cases. */
export const fakeDiscoveries: {
  title: string;
  author: string | null;
  genre: string | null;
  pageCount: number | null;
  verified: boolean;
  confidence: 'high' | 'medium' | 'low';
  rationale: string;
}[] = [
  {
    title: 'La hojarasca',
    author: 'Gabriel García Márquez',
    genre: 'Novela',
    pageCount: 144,
    verified: true,
    confidence: 'high',
    rationale: 'Valoraste con 5 estrellas varias novelas y prefieres libros cortos entre semana.',
  },
  {
    title: 'Cuadernos del sur',
    author: 'Lucía Ferrer',
    genre: 'Crónica',
    pageCount: null,
    verified: false,
    confidence: 'medium',
    rationale: 'La crónica es uno de tus géneros favoritos y tus últimas lecturas fueron breves.',
  },
  {
    title: 'Mares de tinta',
    author: null,
    genre: 'Poesía',
    pageCount: null,
    verified: false,
    confidence: 'low',
    rationale: 'Te gusta la poesía y pediste algo tranquilo.',
  },
];
