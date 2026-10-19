// Pure logic of the `discover-book` Edge Function (runs in Deno; tested here in Node).
import {
  applyVerification,
  buildDiscoverInstructions,
  buildDiscoverPayload,
  buildDiscoverRequest,
  DISCOVER_ERROR_STATUS,
  DISCOVER_FUNCTION_NAME,
  DISCOVER_LIMITS,
  DISCOVER_TIMEOUT_MS,
  DISCOVERY_SCHEMA,
  discoveryContextRecord,
  isExcludedSuggestion,
  normalizeText,
  OPEN_LIBRARY_TIMEOUT_MS,
  openLibrarySearchUrl,
  parseDiscoverRequest,
  sameBook,
  validateDiscovery,
  verificationFrom,
  type DiscoverRequest,
  type Discovery,
} from '../../supabase/functions/_shared/discoverBook';
import { isRateLimited } from '../../supabase/functions/_shared/identifyBook';
import { DEFAULT_PREFERENCES } from '../../supabase/functions/_shared/recommendBook';

const UUID = '00000000-0000-4000-8000-000000000001';
const base = { local_weekday: 2, local_hour: 21 };

const request = (overrides: Partial<DiscoverRequest> = {}): DiscoverRequest => ({
  seedBookId: null,
  mood: 'calm',
  context: 'Algo breve',
  excludeSuggestions: [],
  localWeekday: 2,
  localHour: 21,
  ...overrides,
});

describe('request validation', () => {
  it('accepts a full body and cleans it', () => {
    expect(
      parseDiscoverRequest({
        ...base,
        seed_book_id: UUID.toUpperCase(),
        mood: 'thoughtful',
        context: '  algo\u0000 corto ',
        exclude_suggestions: [
          { title: ' La hojarasca ', author: 'García Márquez' },
          { title: 'Otro' },
        ],
      }),
    ).toEqual({
      ok: true,
      value: {
        seedBookId: UUID,
        mood: 'thoughtful',
        context: 'algo corto',
        excludeSuggestions: [
          { title: 'La hojarasca', author: 'García Márquez' },
          { title: 'Otro', author: null },
        ],
        localWeekday: 2,
        localHour: 21,
      },
    });
    expect(parseDiscoverRequest(base)).toEqual({
      ok: true,
      value: {
        seedBookId: null,
        mood: null,
        context: null,
        excludeSuggestions: [],
        localWeekday: 2,
        localHour: 21,
      },
    });
  });

  it.each([
    ['no body', null],
    ['a seed that is not a UUID', { ...base, seed_book_id: '1); drop' }],
    ['an unknown mood', { ...base, mood: 'sad' }],
    ['a context over 200 characters', { ...base, context: 'a'.repeat(201) }],
    ['exclusions that are not a list', { ...base, exclude_suggestions: 'x' }],
    ['an exclusion without title', { ...base, exclude_suggestions: [{ author: 'A' }] }],
    ['an exclusion with an empty title', { ...base, exclude_suggestions: [{ title: '  ' }] }],
    [
      'an exclusion with a numeric author',
      { ...base, exclude_suggestions: [{ title: 'T', author: 4 }] },
    ],
    [
      'more than 30 exclusions',
      { ...base, exclude_suggestions: Array.from({ length: 31 }, (_, i) => ({ title: `T${i}` })) },
    ],
    ['a missing hour', { local_weekday: 2 }],
    ['a weekday of 7', { local_weekday: 7, local_hour: 1 }],
  ])('rejects %s as invalid_request', (_label, body) => {
    expect(parseDiscoverRequest(body)).toEqual({ ok: false, error: 'invalid_request' });
  });
});

describe('normalization and exclusion of books the user has', () => {
  it('ignores case, accents and punctuation', () => {
    expect(normalizeText('  Cien años de soledad! ')).toBe('cien anos de soledad');
    expect(normalizeText(null)).toBe('');
  });

  it('the same title and author (or a missing author) is the same book', () => {
    expect(
      sameBook(
        { title: 'CIEN AÑOS de soledad', author: 'Gabriel García Márquez' },
        { title: 'Cien anos de soledad', author: 'gabriel garcia marquez' },
      ),
    ).toBe(true);
    expect(
      sameBook({ title: 'Rayuela', author: null }, { title: 'rayuela', author: 'Cortázar' }),
    ).toBe(true);
    expect(
      sameBook({ title: 'Rayuela', author: 'Otro' }, { title: 'Rayuela', author: 'Cortázar' }),
    ).toBe(false);
    expect(sameBook({ title: 'Rayuela 2', author: null }, { title: 'Rayuela', author: null })).toBe(
      false,
    );
  });

  it('rejects suggestions on the shelf or already suggested', () => {
    const library = [{ title: 'El túnel', author: 'Ernesto Sabato' }];
    const excluded = [{ title: 'La hojarasca', author: null }];
    expect(
      isExcludedSuggestion({ title: 'El tunel', author: 'ERNESTO SABATO' }, library, excluded),
    ).toBe(true);
    expect(
      isExcludedSuggestion({ title: 'La Hojarasca', author: 'García Márquez' }, library, excluded),
    ).toBe(true);
    expect(
      isExcludedSuggestion(
        { title: 'Sobre héroes y tumbas', author: 'Ernesto Sabato' },
        library,
        excluded,
      ),
    ).toBe(false);
  });
});

describe('model payload privacy', () => {
  const secretRow = (title: string) =>
    ({
      title,
      author: 'Autora',
      genre: 'Novela',
      page_count: 200,
      rating: 5,
      notes: 'NOTA-PRIVADA',
      lent_to: 'NOMBRE-AMIGA',
      cover_path: 'user/cover.jpg',
      current_page: 77,
      user_id: 'USER-ID',
    }) as never;

  const payload = buildDiscoverPayload({
    seed: secretRow('Semilla'),
    taste: [secretRow('Favorito'), { title: 'Sin nota', author: null, genre: null, rating: null }],
    reading: [secretRow('Leyendo')],
    recent: [{ title: 'Ya sugerido', author: 'X' }],
    preferences: { ...DEFAULT_PREFERENCES, favorite_genres: ['novel'] },
    request: request({ excludeSuggestions: [{ title: 'Excluido', author: null }] }),
  });
  const sent = JSON.stringify(buildDiscoverRequest({ model: 'm', payload }));

  it('sends only titles, authors, genres, page counts and ratings', () => {
    for (const secret of [
      'NOTA-PRIVADA',
      'NOMBRE-AMIGA',
      'user/cover.jpg',
      'USER-ID',
      'current_page',
      'notes',
      'lent_to',
      'cover_path',
    ]) {
      expect(sent).not.toContain(secret);
    }
    expect(Object.keys(payload.seed_book!).sort()).toEqual([
      'author',
      'genre',
      'page_count',
      'rating',
      'title',
    ]);
    expect(Object.keys(payload.currently_reading[0]).sort()).toEqual(['author', 'genre', 'title']);
    // Unrated books are not taste data.
    expect(payload.finished_books_rated.map((b) => b.title)).toEqual(['Favorito']);
    expect(payload.already_suggested.map((s) => s.title)).toEqual(['Ya sugerido', 'Excluido']);
    expect(payload).toMatchObject({ mood: 'calm', context: 'Algo breve', is_workday: true });
  });

  it('never sends the whole library (it is only used to exclude)', () => {
    expect(Object.keys(payload)).not.toContain('library');
  });

  it('mood and context are left out when consider_mood is off', () => {
    const off = buildDiscoverPayload({
      seed: null,
      taste: [],
      reading: [],
      recent: [],
      preferences: { ...DEFAULT_PREFERENCES, consider_mood: false },
      request: request({ mood: 'exciting', context: 'SECRETO' }),
    });
    expect(off).toMatchObject({ mood: null, context: null, seed_book: null });
    expect(JSON.stringify(off)).not.toContain('SECRETO');
  });

  it('typed text travels as JSON data, never as instructions', () => {
    const body = buildDiscoverRequest({ model: 'm', payload }) as {
      input: { role: string; content: unknown }[];
      store: boolean;
    };
    expect(body.store).toBe(false);
    expect(body.input[0]).toEqual({ role: 'system', content: buildDiscoverInstructions() });
  });
});

describe('prompt and schema', () => {
  it('states the rules', () => {
    const text = buildDiscoverInstructions();
    expect(text).toMatch(/does NOT own yet/);
    expect(text).toMatch(/exactly one real, published book/);
    expect(text).toMatch(/If seed_book is given, the book must be similar to it/);
    expect(text).toMatch(/highest-rated books/);
    expect(text).toMatch(/Never invent it/);
    expect(text).toMatch(/use "low" if you are unsure the book exists/);
    expect(text).toMatch(/at most 2 sentences and 350 characters/);
    expect(text).toMatch(/Never describe the plot, characters, awards, reviews or quotes/);
    expect(text).toMatch(/untrusted data/);
    expect(text).toMatch(/Novela, Poesía, Historia/);
  });

  it('strict schema with every field required', () => {
    expect(DISCOVERY_SCHEMA.additionalProperties).toBe(false);
    expect([...DISCOVERY_SCHEMA.required].sort()).toEqual(
      Object.keys(DISCOVERY_SCHEMA.properties).sort(),
    );
    expect(DISCOVERY_SCHEMA.properties.confidence.enum).toEqual(['high', 'medium', 'low']);
    expect(DISCOVER_TIMEOUT_MS).toBe(25_000);
    expect(DISCOVER_FUNCTION_NAME).toBe('discover-book');
  });
});

describe('output validation', () => {
  const raw = {
    title: '  La hojarasca ',
    author: 'Gabriel García Márquez',
    genre: 'novela',
    page_count: 144,
    confidence: 'high',
    rationale: 'Te gustan las novelas cortas. Valoraste con 5 estrellas varias. Tercera frase.',
  };

  it('sanitizes the fields and caps the rationale', () => {
    expect(validateDiscovery(raw)).toEqual({
      title: 'La hojarasca',
      author: 'Gabriel García Márquez',
      genre: 'Novela',
      pageCount: 144,
      confidence: 'high',
      rationale: 'Te gustan las novelas cortas. Valoraste con 5 estrellas varias.',
    });
    expect(validateDiscovery({ ...raw, page_count: 0, author: ' ' })).toMatchObject({
      pageCount: null,
      author: null,
    });
  });

  it.each([
    ['a non-object', 'x'],
    ['no title', { ...raw, title: ' ' }],
    ['no rationale', { ...raw, rationale: '' }],
    ['an unknown confidence', { ...raw, confidence: 'sure' }],
  ])('rejects %s', (_label, value) => {
    expect(validateDiscovery(value)).toBeNull();
  });
});

describe('Open Library check', () => {
  const suggestion = { title: 'La hojarasca', author: 'Gabriel García Márquez' };

  it('builds a keyless search URL with title and author', () => {
    const url = new URL(openLibrarySearchUrl(suggestion));
    expect(url.origin + url.pathname).toBe('https://openlibrary.org/search.json');
    expect(url.searchParams.get('title')).toBe('La hojarasca');
    expect(url.searchParams.get('author')).toBe('Gabriel García Márquez');
    expect(url.searchParams.has('key')).toBe(false);
    expect(OPEN_LIBRARY_TIMEOUT_MS).toBe(4_000);
  });

  it('a matching title and author verifies it and gives the pages', () => {
    expect(
      verificationFrom(
        {
          docs: [
            { title: 'Otra', author_name: ['Gabriel García Márquez'] },
            {
              title: 'La Hojarasca',
              author_name: ['Gabriel Garcia Marquez'],
              number_of_pages_median: 160,
            },
          ],
        },
        suggestion,
      ),
    ).toEqual({ verified: true, pageCount: 160 });
  });

  it('a different author, no match, or a broken answer is "not verified"', () => {
    expect(
      verificationFrom(
        { docs: [{ title: 'La hojarasca', author_name: ['Otro Nombre'] }] },
        suggestion,
      ),
    ).toEqual({ verified: false, pageCount: null });
    expect(verificationFrom({ docs: [] }, suggestion).verified).toBe(false);
    expect(verificationFrom('oops', suggestion).verified).toBe(false);
    expect(verificationFrom(null, suggestion).verified).toBe(false);
  });

  it('the catalog only fills a missing page count', () => {
    const d: Discovery = {
      ...validateDiscovery({
        title: 'T',
        author: null,
        genre: null,
        page_count: null,
        confidence: 'low',
        rationale: 'R.',
      })!,
    };
    expect(applyVerification(d, { verified: true, pageCount: 300 }).pageCount).toBe(300);
    expect(applyVerification(d, { verified: false, pageCount: 300 }).pageCount).toBeNull();
    expect(
      applyVerification({ ...d, pageCount: 120 }, { verified: true, pageCount: 300 }).pageCount,
    ).toBe(120);
  });
});

describe('stored context, limits and statuses', () => {
  it('keeps the confidence in request_context', () => {
    expect(
      discoveryContextRecord(request({ seedBookId: UUID }), DEFAULT_PREFERENCES, 'low'),
    ).toEqual({
      mode: 'discovery',
      seed_book_id: UUID,
      mood: 'calm',
      context: 'Algo breve',
      local_weekday: 2,
      local_hour: 21,
      confidence: 'low',
    });
  });

  it('allows 15 calls per hour and 50 per day', () => {
    expect(DISCOVER_LIMITS).toEqual({ perHour: 15, perDay: 50 });
    expect(isRateLimited({ lastHour: 14, lastDay: 49 }, DISCOVER_LIMITS)).toBe(false);
    expect(isRateLimited({ lastHour: 15, lastDay: 15 }, DISCOVER_LIMITS)).toBe(true);
    expect(isRateLimited({ lastHour: 0, lastDay: 50 }, DISCOVER_LIMITS)).toBe(true);
  });

  it('every error code has an HTTP error status', () => {
    expect(DISCOVER_ERROR_STATUS).toEqual({
      unauthorized: 401,
      invalid_request: 400,
      rate_limited: 429,
      no_new_suggestions: 422,
      upstream_error: 502,
      timeout: 504,
    });
  });
});
