// Pure logic of the `find-cover` Edge Function (runs in Deno; tested here in Node).
import {
  COVER_HOST_ALLOWLIST,
  FIND_COVER_ERROR_STATUS,
  FIND_COVER_FUNCTION_NAME,
  FIND_COVER_LIMITS,
  googleBooksCandidates,
  googleBooksQueries,
  isAllowedCoverUrl,
  matchScore,
  mergeCoverCandidates,
  normalizeGoogleImage,
  normalizeIsbn,
  openLibraryCandidates,
  openLibraryQueries,
  parseFindCoverRequest,
  type CoverCandidate,
} from '../../supabase/functions/_shared/findCover';
import { isRateLimited } from '../../supabase/functions/_shared/identifyBook';

const request = { title: 'Cien años de soledad', author: 'Gabriel García Márquez', isbn: null };

describe('find-cover request', () => {
  it('accepts a title with an optional author and ISBN (cleaned)', () => {
    expect(parseFindCoverRequest({ title: '  Cien   años ', author: '' })).toEqual({
      ok: true,
      value: { title: 'Cien años', author: null, isbn: null },
    });
    expect(
      parseFindCoverRequest({ title: 'Rayuela', author: 'Cortázar', isbn: '978-84-376-0494-7' }),
    ).toEqual({
      ok: true,
      value: { title: 'Rayuela', author: 'Cortázar', isbn: '9788437604947' },
    });
  });

  it('rejects bad input', () => {
    for (const body of [
      null,
      [],
      {},
      { title: '' },
      { title: 'x'.repeat(201) },
      { title: 'Ok', author: 5 },
      { title: 'Ok', author: 'a'.repeat(121) },
      { title: 'Ok', isbn: '12345' },
    ]) {
      expect(parseFindCoverRequest(body)).toEqual({ ok: false, error: 'invalid_request' });
    }
    expect(normalizeIsbn('0-306-40615-X')).toBe('030640615X');
    expect(normalizeIsbn('X306406152')).toBeNull();
  });

  it('limits: 30 per hour per user; error statuses', () => {
    expect(FIND_COVER_FUNCTION_NAME).toBe('find-cover');
    expect(FIND_COVER_LIMITS.perHour).toBe(30);
    expect(isRateLimited({ lastHour: 29, lastDay: 0 }, FIND_COVER_LIMITS)).toBe(false);
    expect(isRateLimited({ lastHour: 30, lastDay: 0 }, FIND_COVER_LIMITS)).toBe(true);
    expect(FIND_COVER_ERROR_STATUS).toEqual({
      unauthorized: 401,
      invalid_request: 400,
      rate_limited: 429,
      upstream_error: 502,
    });
  });
});

describe('image host allowlist', () => {
  it('only https on the three catalog hosts', () => {
    expect(COVER_HOST_ALLOWLIST).toEqual([
      'covers.openlibrary.org',
      'books.google.com',
      'books.googleusercontent.com',
    ]);
    expect(isAllowedCoverUrl('https://covers.openlibrary.org/b/id/1-L.jpg')).toBe(true);
    expect(isAllowedCoverUrl('https://books.google.com/books/content?id=x&img=1')).toBe(true);
    expect(isAllowedCoverUrl('https://books.googleusercontent.com/a.jpg')).toBe(true);
    for (const url of [
      'http://covers.openlibrary.org/b/id/1-L.jpg',
      'https://evil.example/covers.openlibrary.org.jpg',
      'https://covers.openlibrary.org.evil.example/a.jpg',
      'https://user:pw@covers.openlibrary.org/a.jpg',
      'https://covers.openlibrary.org:8443/a.jpg',
      'javascript:alert(1)',
      'not a url',
      42,
    ]) {
      expect(isAllowedCoverUrl(url)).toBe(false);
    }
  });

  it('Google thumbnails become https, larger (zoom=0) and without the page curl', () => {
    expect(
      normalizeGoogleImage(
        'http://books.google.com/books/content?id=a&printsec=frontcover&img=1&zoom=1&edge=curl',
      ),
    ).toBe('https://books.google.com/books/content?id=a&printsec=frontcover&img=1&zoom=0');
    expect(normalizeGoogleImage('http://example.com/a.jpg')).toBeNull();
  });
});

describe('catalog lookups', () => {
  it('search plan: Open Library title, title + author, loose; Google es first, then no filter', () => {
    const ol = openLibraryQueries(request);
    expect(ol.map((q) => q.attempt)).toEqual(['title', 'title_author', 'loose']);
    const first = new URL(ol[0].url);
    expect(first.host).toBe('openlibrary.org');
    expect(first.searchParams.get('title')).toBe(request.title);
    expect(first.searchParams.has('author')).toBe(false);
    expect(first.searchParams.get('fields')).toBe('key,title,author_name,cover_i,isbn,language');
    expect(first.searchParams.has('lang')).toBe(false); // language neutral
    expect(new URL(ol[1].url).searchParams.get('author')).toBe(request.author);
    expect(new URL(ol[2].url).searchParams.get('q')).toBe('cien anos soledad');
    expect(openLibraryQueries({ ...request, author: null }).map((q) => q.attempt)).toEqual([
      'title',
      'loose',
    ]);

    const google = googleBooksQueries(request, 'k');
    expect(google.map((q) => q.attempt)).toEqual(['title_author_es', 'title_author', 'title']);
    expect(new URL(google[0].url).searchParams.get('langRestrict')).toBe('es');
    expect(new URL(google[1].url).searchParams.has('langRestrict')).toBe(false);
    expect(googleBooksQueries({ ...request, author: null }, null).map((q) => q.attempt)).toEqual([
      'title_es',
      'title',
    ]);
    expect(new URL(google[0].url).searchParams.get('q')).toBe(
      `${request.title} inauthor:${request.author}`,
    );
    expect(new URL(google[0].url).searchParams.get('fields')).toContain('imageLinks');
    expect(new URL(google[0].url).searchParams.get('key')).toBe('k');
    expect(new URL(googleBooksQueries(request, null)[0].url).searchParams.has('key')).toBe(false);
    const byIsbn = googleBooksQueries({ ...request, isbn: '9788437604947' }, null);
    expect(new URL(byIsbn[0].url).searchParams.get('q')).toBe('isbn:9788437604947');
  });

  it('best title and author matches first; unrelated books and missing covers are skipped', () => {
    const response = {
      docs: [
        { title: 'Cien años de soledad (edición escolar)', author_name: ['Otro'], cover_i: 11 },
        { title: 'Un libro distinto', author_name: ['Gabriel García Márquez'], cover_i: 12 },
        { title: 'Cien años de soledad', author_name: ['Gabriel García Márquez'], cover_i: 13 },
        { title: 'Cien años de soledad', author_name: ['Gabriel García Márquez'] },
        { title: 'Cien años de soledad', cover_i: -1 },
      ],
    };
    expect(openLibraryCandidates(response, request).map((c) => c.image_url)).toEqual([
      'https://covers.openlibrary.org/b/id/13-L.jpg?default=false',
      'https://covers.openlibrary.org/b/id/11-L.jpg?default=false',
    ]);
    expect(openLibraryCandidates({ nope: true }, request)).toEqual([]);
  });

  it('with an ISBN, its Open Library cover goes first', () => {
    const candidates = openLibraryCandidates({ docs: [] }, { ...request, isbn: '9788437604947' });
    expect(candidates[0]).toMatchObject({
      image_url: 'https://covers.openlibrary.org/b/isbn/9788437604947-L.jpg?default=false',
      source: 'open_library',
    });
  });

  it('Google Books candidates need an allowed image and a matching title', () => {
    const response = {
      items: [
        {
          volumeInfo: {
            title: 'Otra cosa',
            imageLinks: { thumbnail: 'http://books.google.com/x?id=1' },
          },
        },
        {
          volumeInfo: {
            title: 'Cien años de soledad',
            authors: ['Gabriel García Márquez'],
            imageLinks: { smallThumbnail: 'http://books.google.com/books/content?id=2' },
          },
        },
        {
          volumeInfo: {
            title: 'Cien años de soledad',
            imageLinks: { thumbnail: 'https://evil.example/a.jpg' },
          },
        },
      ],
    };
    expect(googleBooksCandidates(response, request)).toEqual([
      {
        image_url: 'https://books.google.com/books/content?id=2',
        source: 'google_books',
        title: 'Cien años de soledad',
        author: 'Gabriel García Márquez',
      },
    ]);
  });

  it('matchScore: exact title 2, contained 1, plus 1 for the author', () => {
    expect(matchScore(request, 'CIEN AÑOS DE SOLEDAD', ['García Márquez, Gabriel'])).toBe(3);
    expect(matchScore(request, 'Cien años de soledad: novela', [])).toBe(1);
    expect(matchScore(request, 'Rayuela', [])).toBe(0);
  });
});

describe('merging (Open Library first, Google Books as fallback)', () => {
  const candidate = (url: string, source: CoverCandidate['source']): CoverCandidate => ({
    image_url: url,
    source,
    title: null,
    author: null,
  });

  it('keeps the order, drops duplicates and disallowed URLs', () => {
    const ol = [
      candidate('https://covers.openlibrary.org/b/id/1-L.jpg', 'open_library'),
      candidate('https://covers.openlibrary.org/b/id/1-L.jpg', 'open_library'),
      candidate('http://covers.openlibrary.org/b/id/2-L.jpg', 'open_library'),
    ];
    const google = [
      candidate('https://books.google.com/a', 'google_books'),
      candidate('https://books.google.com/b', 'google_books'),
      candidate('https://books.google.com/c', 'google_books'),
    ];
    expect(mergeCoverCandidates(ol, google).map((c) => c.image_url)).toEqual([
      'https://covers.openlibrary.org/b/id/1-L.jpg',
      'https://books.google.com/a',
      'https://books.google.com/b',
      'https://books.google.com/c',
    ]);
  });

  it('falls back to Google Books when Open Library has nothing', () => {
    const google = [candidate('https://books.google.com/a', 'google_books')];
    expect(mergeCoverCandidates([], google)).toEqual(google);
    expect(mergeCoverCandidates([], [])).toEqual([]);
  });
});
