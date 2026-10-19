// Phase 9.3.1 diagnosis: realistic catalog answers through the function's pure logic and then
// through the client parser, for the titles that showed no "Portada sugerida".
import { toCoverCandidates } from '@/features/library/coverSuggestion';

import {
  googleBooksCandidates,
  matchScore,
  openLibraryCandidates,
  searchCovers,
  type AttemptLog,
  type CatalogAnswer,
  type CoverCandidate,
  type FindCoverRequest,
} from '../../supabase/functions/_shared/findCover';

/** Shaped like https://openlibrary.org/search.json?title=...&fields=title,author_name,cover_i,isbn */
const quijoteOpenLibrary = {
  numFound: 4,
  start: 0,
  numFoundExact: true,
  docs: [
    {
      title: 'El ingenioso hidalgo don Quijote de la Mancha',
      author_name: ['Miguel de Cervantes Saavedra'],
      cover_i: 8231856,
      isbn: ['8420412147', '9788420412146'],
    },
    {
      title: 'Don Quixote',
      author_name: ['Miguel de Cervantes Saavedra'],
      cover_i: 12345,
    },
    {
      title: 'Don Quijote de la Mancha',
      author_name: ['Miguel de Cervantes Saavedra', 'Martín de Riquer'],
      isbn: ['9788497404464'],
    },
    { title: 'Don Quijote de la Mancha (edición del IV centenario)' },
  ],
  q: '',
  offset: null,
};

const cienAnosOpenLibrary = {
  numFound: 2,
  docs: [
    {
      title: 'Cien años de soledad',
      author_name: ['Gabriel García Márquez'],
      cover_i: 9255566,
      isbn: ['9780307474728'],
    },
    { title: 'Cien años de soledad', author_name: ['Gabriel García Márquez'] },
  ],
};

const emptyOpenLibrary = { numFound: 0, start: 0, numFoundExact: true, docs: [] };

/** Shaped like https://www.googleapis.com/books/v1/volumes?q=...&fields=items(volumeInfo(...)) */
const quijoteGoogle = {
  items: [
    {
      volumeInfo: {
        title: 'Don Quijote de la Mancha',
        authors: ['Miguel de Cervantes'],
        imageLinks: {
          smallThumbnail:
            'http://books.google.com/books/content?id=NO8KAQAAMAAJ&printsec=frontcover&img=1&zoom=5&edge=curl&source=gbs_api',
          thumbnail:
            'http://books.google.com/books/content?id=NO8KAQAAMAAJ&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api',
        },
      },
    },
    { volumeInfo: { title: 'Don Quijote de la Mancha', authors: ['Miguel de Cervantes'] } },
  ],
};

const request = (title: string, author: string | null = null): FindCoverRequest => ({
  title,
  author,
  isbn: null,
});

/** What the function returns and what the app receives after JSON. */
const throughTheWire = (candidates: CoverCandidate[]) =>
  toCoverCandidates(JSON.parse(JSON.stringify({ data: { candidates } })));

describe('"El Quijote de la mancha" (typed casually)', () => {
  it('matches the catalog titles (articles, accents and case do not matter)', () => {
    const typed = request('El Quijote de la mancha');
    expect(matchScore(typed, 'El ingenioso hidalgo don Quijote de la Mancha', [])).toBeGreaterThan(
      0,
    );
    expect(matchScore(typed, 'Don Quijote de la Mancha', [])).toBeGreaterThan(0);
    expect(matchScore(typed, 'Don Quixote', [])).toBe(0);
    expect(matchScore(request('cien anos de SOLEDAD'), 'Cien años de soledad', [])).toBeGreaterThan(
      1,
    );
  });

  it('Open Library gives candidates (by cover id, then by ISBN without cover_i), title only', () => {
    const candidates = openLibraryCandidates(
      quijoteOpenLibrary,
      request('El Quijote de la mancha'),
    );
    expect(candidates.map((c) => c.image_url)).toEqual([
      'https://covers.openlibrary.org/b/id/8231856-L.jpg?default=false',
      'https://covers.openlibrary.org/b/isbn/9788497404464-L.jpg?default=false',
    ]);
    // ...and they survive the trip to the app (image_url -> imageUrl, allowlist).
    expect(throughTheWire(candidates)).toEqual([
      {
        imageUrl: 'https://covers.openlibrary.org/b/id/8231856-L.jpg?default=false',
        source: 'open_library',
        title: 'El ingenioso hidalgo don Quijote de la Mancha',
        author: 'Miguel de Cervantes Saavedra',
      },
      expect.objectContaining({ source: 'open_library' }),
    ]);
  });

  it('with the author filled in later, the same book still ranks first', () => {
    const withAuthor = openLibraryCandidates(
      quijoteOpenLibrary,
      request('El Quijote de la mancha', 'Miguel de Cervantes'),
    );
    expect(withAuthor[0].image_url).toBe(
      'https://covers.openlibrary.org/b/id/8231856-L.jpg?default=false',
    );
  });

  it('Google Books gives a larger https thumbnail without the curl; no imageLinks is skipped', () => {
    const candidates = googleBooksCandidates(quijoteGoogle, request('El Quijote de la mancha'));
    expect(candidates).toEqual([
      {
        image_url:
          'https://books.google.com/books/content?id=NO8KAQAAMAAJ&printsec=frontcover&img=1&zoom=0&source=gbs_api',
        source: 'google_books',
        title: 'Don Quijote de la Mancha',
        author: 'Miguel de Cervantes',
      },
    ]);
    expect(throughTheWire(candidates)).toHaveLength(1);
  });
});

describe('"Cien años de soledad"', () => {
  it('gives a candidate end to end', () => {
    const candidates = openLibraryCandidates(cienAnosOpenLibrary, request('Cien años de soledad'));
    expect(throughTheWire(candidates)[0]).toMatchObject({
      imageUrl: 'https://covers.openlibrary.org/b/id/9255566-L.jpg?default=false',
    });
  });
});

describe('search plan and fallback', () => {
  const plan = (answers: (url: string) => CatalogAnswer) => {
    const logs: AttemptLog[] = [];
    const fetchJson = jest.fn(async (url: string) => answers(url));
    return { fetchJson, logs, log: (entry: AttemptLog) => logs.push(entry) };
  };
  const isOpenLibrary = (url: string) => url.startsWith('https://openlibrary.org/');

  it('stops at the first Open Library query that finds covers (Google keeps filling up)', async () => {
    const p = plan((url) =>
      isOpenLibrary(url)
        ? { status: 200, body: quijoteOpenLibrary }
        : { status: 200, body: quijoteGoogle },
    );
    const result = await searchCovers(request('El Quijote de la mancha'), {
      fetchJson: p.fetchJson,
      googleApiKey: null,
      log: p.log,
    });
    expect(result).toHaveLength(3);
    expect(p.logs.map((l) => `${l.source}:${l.attempt}:${l.status}:${l.candidates}`)).toEqual([
      'open_library:title:200:2',
      'google_books:title_es:200:1',
      'google_books:title:200:1',
    ]);
  });

  it('Open Library empty on every query -> Google Books fallback', async () => {
    const p = plan((url) =>
      isOpenLibrary(url)
        ? { status: 200, body: emptyOpenLibrary }
        : { status: 200, body: quijoteGoogle },
    );
    const result = await searchCovers(request('El Quijote de la mancha', 'Cervantes'), {
      fetchJson: p.fetchJson,
      googleApiKey: null,
      log: p.log,
    });
    expect(result?.map((c) => c.source)).toEqual(['google_books']);
    expect(p.logs.map((l) => l.attempt)).toEqual([
      'title',
      'title_author',
      'loose',
      'title_author_es',
      'title_author',
      'title',
    ]);
  });

  it('Open Library errors (non-200, timeout) -> Google Books fallback', async () => {
    let n = 0;
    const p = plan((url) => {
      if (!isOpenLibrary(url)) return { status: 200, body: quijoteGoogle };
      n += 1;
      return n === 1 ? { status: 503, body: null } : { status: 0, body: null };
    });
    const result = await searchCovers(request('El Quijote de la mancha'), {
      fetchJson: p.fetchJson,
      googleApiKey: null,
      log: p.log,
    });
    expect(result).toHaveLength(1);
    expect(p.logs.slice(0, 2).map((l) => l.status)).toEqual([503, 0]);
  });

  it('nothing found is an empty list; every request failing is null', async () => {
    const empty = plan(() => ({ status: 200, body: { docs: [], items: [] } }));
    await expect(
      searchCovers(request('Título que no existe xyz'), {
        fetchJson: empty.fetchJson,
        googleApiKey: null,
      }),
    ).resolves.toEqual([]);
    const down = plan(() => ({ status: 0, body: null }));
    await expect(
      searchCovers(request('Rayuela'), { fetchJson: down.fetchJson, googleApiKey: null }),
    ).resolves.toBeNull();
  });

  it('logs only source, attempt, status and counts (never the title or the URL)', async () => {
    const p = plan(() => ({ status: 200, body: emptyOpenLibrary }));
    await searchCovers(request('Título privado', 'Autora privada'), {
      fetchJson: p.fetchJson,
      googleApiKey: 'secret-key',
      log: p.log,
    });
    const text = JSON.stringify(p.logs);
    expect(text).not.toMatch(/privad|secret|http/i);
    expect(Object.keys(p.logs[0]).sort()).toEqual(['attempt', 'candidates', 'source', 'status']);
  });

  it('stops starting new queries when the time budget is spent', async () => {
    const p = plan(() => ({ status: 200, body: emptyOpenLibrary }));
    let calls = 0;
    await searchCovers(request('Rayuela'), {
      fetchJson: p.fetchJson,
      googleApiKey: null,
      budgetLeft: () => ++calls <= 1,
    });
    expect(p.fetchJson).toHaveBeenCalledTimes(1);
  });
});

describe('cover variety (up to ten distinct candidates)', () => {
  const editions = (covers: [number, string][]) => ({
    entries: covers.map(([id, language]) => ({
      title: 'Don Quijote de la Mancha',
      covers: [id],
      languages: [{ key: `/languages/${language}` }],
    })),
  });
  const searchWithWork = {
    docs: [
      {
        key: '/works/OL1W',
        title: 'Don Quijote de la Mancha',
        author_name: ['Miguel de Cervantes'],
        cover_i: 100,
        language: ['eng'],
      },
    ],
  };
  const googleVolume = (id: string, language: string, links: Record<string, string>) => ({
    volumeInfo: {
      title: 'Don Quijote de la Mancha',
      authors: ['Miguel de Cervantes'],
      language,
      imageLinks: links,
    },
    id,
  });

  const run = async (answer: (url: string) => CatalogAnswer, title = 'El Quijote de la mancha') => {
    const urls: string[] = [];
    const result = await searchCovers(request(title), {
      fetchJson: jest.fn(async (url: string) => {
        urls.push(url);
        return answer(url);
      }),
      googleApiKey: null,
    });
    return { result, urls };
  };

  it('collects the covers of the best work editions, Spanish editions first, no duplicates', async () => {
    const { result, urls } = await run((url) => {
      if (url.includes('/editions.json')) {
        return {
          status: 200,
          body: editions([
            [100, 'eng'], // same cover as the search hit: counted once
            [201, 'eng'],
            [202, 'spa'],
            [203, 'spa'],
          ]),
        };
      }
      if (url.startsWith('https://openlibrary.org/search.json')) {
        return { status: 200, body: searchWithWork };
      }
      return { status: 200, body: { items: [] } };
    });
    expect(
      urls.some((u) => u === 'https://openlibrary.org/works/OL1W/editions.json?limit=40'),
    ).toBe(true);
    expect(result?.map((c) => c.image_url)).toEqual([
      'https://covers.openlibrary.org/b/id/202-L.jpg?default=false',
      'https://covers.openlibrary.org/b/id/203-L.jpg?default=false',
      'https://covers.openlibrary.org/b/id/100-L.jpg?default=false',
      'https://covers.openlibrary.org/b/id/201-L.jpg?default=false',
    ]);
    // The ranking fields never reach the app.
    expect(Object.keys(result?.[0] ?? {}).sort()).toEqual([
      'author',
      'image_url',
      'source',
      'title',
    ]);
  });

  it('returns at most ten and skips Google Books once there are ten', async () => {
    const many = editions(
      Array.from({ length: 14 }, (_, i) => [300 + i, 'spa'] as [number, string]),
    );
    const { result, urls } = await run((url) =>
      url.includes('/editions.json')
        ? { status: 200, body: many }
        : url.startsWith('https://openlibrary.org/search.json')
          ? { status: 200, body: searchWithWork }
          : { status: 200, body: { items: [] } },
    );
    expect(result).toHaveLength(10);
    expect(urls.some((u) => u.includes('googleapis'))).toBe(false);
  });

  it('Google Books: Spanish first, larger images first, the same volume once', async () => {
    const { result } = await run((url) => {
      if (!url.includes('googleapis')) return { status: 200, body: emptyOpenLibrary };
      const body = {
        items: [
          googleVolume('EN1', 'en', {
            extraLarge: 'http://books.google.com/books/content?id=EN1&zoom=6',
          }),
          googleVolume('ES1', 'es', {
            thumbnail: 'http://books.google.com/books/content?id=ES1&zoom=1',
          }),
          googleVolume('ES2', 'es', {
            thumbnail: 'http://books.google.com/books/content?id=ES2&zoom=1',
            large: 'http://books.google.com/books/content?id=ES2&zoom=4',
          }),
          googleVolume('ES1', 'es', {
            small: 'http://books.google.com/books/content?id=ES1&zoom=2',
          }),
        ],
      };
      return { status: 200, body };
    });
    expect(result?.map((c) => new URL(c.image_url).searchParams.get('id'))).toEqual([
      'ES2',
      'ES1',
      'EN1',
    ]);
    expect(result?.every((c) => c.image_url.startsWith('https://books.google.com/'))).toBe(true);
  });

  it('logs the editions attempt without titles or URLs', async () => {
    const logs: AttemptLog[] = [];
    await searchCovers(request('El Quijote de la mancha'), {
      fetchJson: async (url) =>
        url.includes('/editions.json')
          ? { status: 200, body: editions([[500, 'spa']]) }
          : url.startsWith('https://openlibrary.org/search.json')
            ? { status: 200, body: searchWithWork }
            : { status: 200, body: { items: [] } },
      googleApiKey: null,
      log: (entry) => logs.push(entry),
    });
    expect(logs.map((l) => l.attempt)).toContain('editions');
    expect(JSON.stringify(logs)).not.toMatch(/quijote|http/i);
  });

  it('ignores a work key that is not an Open Library work', async () => {
    const { urls } = await run((url) =>
      url.startsWith('https://openlibrary.org/search.json')
        ? {
            status: 200,
            body: { docs: [{ ...searchWithWork.docs[0], key: '/works/../../admin' }] },
          }
        : { status: 200, body: { items: [] } },
    );
    expect(urls.some((u) => u.includes('/editions.json'))).toBe(false);
  });
});
