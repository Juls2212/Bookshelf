// Pure logic of the `find-cover` Edge Function (no AI): request validation, the Open Library
// and Google Books lookups (URLs and response parsing), the image host allowlist and how the
// candidates are ordered. No Deno or Node APIs, so it runs in the function (Deno) and in Jest
// (Node). The `.ts` extension in the import is what Deno requires.
import type { UsageLimits } from './identifyBook.ts';
import { AUTHOR_MAX_LENGTH, TITLE_MAX_LENGTH } from './inputLimits.ts';

export const FIND_COVER_FUNCTION_NAME = 'find-cover';
export const FIND_COVER_LIMITS: UsageLimits = { perHour: 30, perDay: 150 };
/** Per catalog request (several queries run one after the other). */
export const CATALOG_TIMEOUT_MS = 3_500;
/** No new query starts after this (the app gives up at 15 s). */
export const SEARCH_BUDGET_MS = 11_000;
export const MAX_COVER_CANDIDATES = 10;

export const COVER_TITLE_MAX_LENGTH = TITLE_MAX_LENGTH;
export const COVER_AUTHOR_MAX_LENGTH = AUTHOR_MAX_LENGTH;

/** Only images from these hosts (https) are ever proposed or downloaded. */
export const COVER_HOST_ALLOWLIST = [
  'covers.openlibrary.org',
  'books.google.com',
  'books.googleusercontent.com',
] as const;

export type FindCoverErrorCode =
  'unauthorized' | 'invalid_request' | 'rate_limited' | 'upstream_error';

export const FIND_COVER_ERROR_STATUS: Record<FindCoverErrorCode, number> = {
  unauthorized: 401,
  invalid_request: 400,
  rate_limited: 429,
  upstream_error: 502,
};

export function findCoverErrorBody(code: FindCoverErrorCode): { error: FindCoverErrorCode } {
  return { error: code };
}

type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export type FindCoverRequest = { title: string; author: string | null; isbn: string | null };

/** Control characters become spaces, whitespace is collapsed and trimmed. */
function cleanInput(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const length = (text: string) => Array.from(text).length;

/** ISBN-10 or ISBN-13 (hyphens and spaces ignored, X only as the last ISBN-10 digit). */
export function normalizeIsbn(value: string): string | null {
  const compact = value.replace(/[\s-]/g, '').toUpperCase();
  return /^\d{9}[\dX]$/.test(compact) || /^\d{13}$/.test(compact) ? compact : null;
}

/** `{ title, author?, isbn? }`: title 1..200 characters, author up to 120, a valid ISBN. */
export function parseFindCoverRequest(body: unknown): Result<FindCoverRequest, 'invalid_request'> {
  const fail = { ok: false, error: 'invalid_request' } as const;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return fail;
  const { title, author, isbn } = body as Record<string, unknown>;
  if (typeof title !== 'string') return fail;
  const cleanTitle = cleanInput(title);
  if (length(cleanTitle) < 1 || length(cleanTitle) > COVER_TITLE_MAX_LENGTH) return fail;
  if (author !== undefined && author !== null && typeof author !== 'string') return fail;
  const cleanAuthor = typeof author === 'string' ? cleanInput(author) : '';
  if (length(cleanAuthor) > COVER_AUTHOR_MAX_LENGTH) return fail;
  if (isbn !== undefined && isbn !== null && typeof isbn !== 'string') return fail;
  let cleanIsbn: string | null = null;
  if (typeof isbn === 'string' && isbn.trim()) {
    cleanIsbn = normalizeIsbn(isbn);
    if (!cleanIsbn) return fail;
  }
  return {
    ok: true,
    value: { title: cleanTitle, author: cleanAuthor || null, isbn: cleanIsbn },
  };
}

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

/** An https URL on an allowlisted host (exact host, no credentials, default port). */
export function isAllowedCoverUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2000) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    url.username === '' &&
    url.password === '' &&
    url.port === '' &&
    (COVER_HOST_ALLOWLIST as readonly string[]).includes(url.hostname.toLowerCase())
  );
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

export type CoverSource = 'open_library' | 'google_books';

export type CoverCandidate = {
  image_url: string;
  source: CoverSource;
  title: string | null;
  author: string | null;
};

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const clean = cleanInput(value);
  return clean ? Array.from(clean).slice(0, max).join('') : null;
};

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/** Lower case, no accents or punctuation, single spaces. */
export function normalizeTitle(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Words that do not identify a book (articles, prepositions, conjunctions) in Spanish,
 * English, Portuguese, French and Italian: "El Quijote" and "Don Quijote" share "quijote".
 */
const STOP_WORDS = new Set([
  'el',
  'la',
  'los',
  'las',
  'lo',
  'un',
  'una',
  'unos',
  'unas',
  'de',
  'del',
  'y',
  'e',
  'o',
  'u',
  'en',
  'al',
  'a',
  'con',
  'por',
  'para',
  'the',
  'an',
  'of',
  'and',
  'or',
  'in',
  'on',
  'to',
  'for',
  'o',
  'os',
  'as',
  'um',
  'uma',
  'do',
  'da',
  'dos',
  'das',
  'le',
  'les',
  'des',
  'du',
  'et',
  'il',
  'lo',
  'gli',
  'di',
]);

/** The words that identify a title (all words when it only has stop words, e.g. "El"). */
export function significantWords(value: string): string[] {
  const words = normalizeTitle(value).split(' ').filter(Boolean);
  const meaningful = words.filter((w) => !STOP_WORDS.has(w));
  return meaningful.length > 0 ? meaningful : words;
}

/** Share of the typed title's words a catalog title must contain to be the same book. */
export const TITLE_MATCH_THRESHOLD = 0.6;

/**
 * How well a catalog entry matches the request, or 0 when it is another book. Order, case,
 * accents, punctuation and articles do not matter ("El Quijote de la mancha" matches "El
 * ingenioso hidalgo don Quijote de la Mancha"). Score = share of the typed words found
 * (0.6..1), +1 for the same words exactly, +1 when an author word (3+ letters) matches. The
 * author alone never makes another book a match.
 */
export function matchScore(
  request: Pick<FindCoverRequest, 'title' | 'author'>,
  title: string | null,
  authors: readonly string[],
): number {
  if (!title) return 0;
  const wanted = significantWords(request.title);
  const found = new Set(significantWords(title));
  if (wanted.length === 0) return 0;
  const share = wanted.filter((w) => found.has(w)).length / wanted.length;
  if (share < TITLE_MATCH_THRESHOLD) return 0;
  let score = share;
  if (wanted.length === found.size && share === 1) score += 1;
  if (request.author) {
    const words = new Set(
      normalizeTitle(request.author)
        .split(' ')
        .filter((w) => w.length >= 3),
    );
    if (
      authors.some((name) =>
        normalizeTitle(name)
          .split(' ')
          .some((w) => words.has(w)),
      )
    ) {
      score += 1;
    }
  }
  return score;
}

/** Stable sort by score (best first); equal scores keep the catalog's order. */
function byScore<T extends { score: number }>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => b.item.score - a.item.score || a.index - b.index)
    .map(({ item }) => item);
}

/**
 * A candidate with what the ordering needs (never sent to the app): whether it is a Spanish
 * edition, how large its image is (0..5), and whether it comes from the request's own ISBN.
 */
export type RankedCandidate = CoverCandidate & { spanish: boolean; size: number; pinned: boolean };

const stripRank = ({ spanish: _s, size: _z, pinned: _p, ...candidate }: RankedCandidate) =>
  candidate as CoverCandidate;

/** Open Library covers are served large (-L). */
const OPEN_LIBRARY_IMAGE_SIZE = 4;

const hasSpanish = (languages: readonly string[]) =>
  languages.some((language) => /(^|\/)(spa|es)$/i.test(language));

// Open Library ---------------------------------------------------------------

export const OPEN_LIBRARY_SEARCH_URL = 'https://openlibrary.org/search.json';
const OPEN_LIBRARY_FIELDS = 'key,title,author_name,cover_i,isbn,language';
/** Editions of the best matching work that are looked at. */
export const OPEN_LIBRARY_EDITIONS_LIMIT = 40;

export type CatalogQuery = { source: CoverSource; attempt: string; url: string };

/**
 * Open Library searches, tried in order until one gives a cover: the title alone, the title
 * with the author (when there is one), then a looser full-text query of the title's words.
 * No language filter.
 */
export function openLibraryQueries(request: FindCoverRequest): CatalogQuery[] {
  const url = (params: Record<string, string>) =>
    `${OPEN_LIBRARY_SEARCH_URL}?${new URLSearchParams({
      ...params,
      limit: '10',
      fields: OPEN_LIBRARY_FIELDS,
    }).toString()}`;
  const queries: CatalogQuery[] = [
    { source: 'open_library', attempt: 'title', url: url({ title: request.title }) },
  ];
  if (request.author) {
    queries.push({
      source: 'open_library',
      attempt: 'title_author',
      url: url({ title: request.title, author: request.author }),
    });
  }
  queries.push({
    source: 'open_library',
    attempt: 'loose',
    url: url({ q: significantWords(request.title).join(' ') }),
  });
  return queries;
}

/** `default=false` makes Open Library answer 404 instead of a blank placeholder image. */
export function openLibraryCoverById(coverId: number): string {
  return `https://covers.openlibrary.org/b/id/${coverId}-L.jpg?default=false`;
}

export function openLibraryCoverByIsbn(isbn: string): string {
  return `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`;
}

const isCoverId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

/**
 * Matching entries, best first: by cover id, or by the entry's first ISBN when it has no cover
 * id (Open Library answers 404 there when it has no image). The request's own ISBN goes first.
 */
export function openLibraryRanked(response: unknown, request: FindCoverRequest): RankedCandidate[] {
  const result: RankedCandidate[] = [];
  if (request.isbn) {
    result.push({
      image_url: openLibraryCoverByIsbn(request.isbn),
      source: 'open_library',
      title: request.title,
      author: request.author,
      spanish: false,
      size: OPEN_LIBRARY_IMAGE_SIZE,
      pinned: true,
    });
  }
  const docs = (response as { docs?: unknown } | null)?.docs;
  if (!Array.isArray(docs)) return result;
  const scored: (RankedCandidate & { score: number })[] = [];
  for (const doc of docs) {
    if (typeof doc !== 'object' || doc === null) continue;
    const d = doc as Record<string, unknown>;
    const authors = strings(d.author_name);
    const title = text(d.title, COVER_TITLE_MAX_LENGTH);
    const score = matchScore(request, title, authors);
    if (score === 0) continue; // another book is never proposed
    const coverId = d.cover_i;
    const isbn = strings(d.isbn)
      .map(normalizeIsbn)
      .find((value): value is string => value !== null);
    let image: string | null = null;
    if (isCoverId(coverId)) image = openLibraryCoverById(coverId);
    else if (isbn) image = openLibraryCoverByIsbn(isbn);
    if (!image) continue;
    scored.push({
      image_url: image,
      source: 'open_library',
      title,
      author: text(authors[0], COVER_AUTHOR_MAX_LENGTH),
      spanish: hasSpanish(strings(d.language)),
      size: OPEN_LIBRARY_IMAGE_SIZE,
      pinned: false,
      // An entry without a cover id is only a guess: after the ones with a real cover.
      score: isCoverId(coverId) ? score : score - 10,
    });
  }
  return [...result, ...byScore(scored).map(({ score: _score, ...c }) => c)];
}

export function openLibraryCandidates(
  response: unknown,
  request: FindCoverRequest,
): CoverCandidate[] {
  return openLibraryRanked(response, request).map(stripRank);
}

const WORK_KEY = /^\/works\/OL\d+W$/;

/** Work key (`/works/OL123W`) of the best matching entry of a search, or null. */
export function openLibraryBestWork(response: unknown, request: FindCoverRequest): string | null {
  const docs = (response as { docs?: unknown } | null)?.docs;
  if (!Array.isArray(docs)) return null;
  let best: { key: string; score: number } | null = null;
  for (const doc of docs) {
    if (typeof doc !== 'object' || doc === null) continue;
    const d = doc as Record<string, unknown>;
    if (typeof d.key !== 'string' || !WORK_KEY.test(d.key)) continue;
    const score = matchScore(
      request,
      text(d.title, COVER_TITLE_MAX_LENGTH),
      strings(d.author_name),
    );
    if (score > 0 && (!best || score > best.score)) best = { key: d.key, score };
  }
  return best?.key ?? null;
}

/** Editions of one work, with their covers (the work key must look like `/works/OL123W`). */
export function openLibraryEditionsQuery(workKey: string): CatalogQuery | null {
  if (!WORK_KEY.test(workKey)) return null;
  return {
    source: 'open_library',
    attempt: 'editions',
    url: `https://openlibrary.org${workKey}/editions.json?limit=${OPEN_LIBRARY_EDITIONS_LIMIT}`,
  };
}

/** Cover ids of the editions (`entries[].covers`), Spanish editions flagged. */
export function openLibraryEditionCandidates(
  response: unknown,
  request: FindCoverRequest,
): RankedCandidate[] {
  const entries = (response as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(entries)) return [];
  const result: RankedCandidate[] = [];
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const languages = Array.isArray(e.languages)
      ? e.languages
          .map((language) => (language as { key?: unknown } | null)?.key)
          .filter((key): key is string => typeof key === 'string')
      : [];
    const covers = Array.isArray(e.covers) ? e.covers.filter(isCoverId) : [];
    for (const coverId of covers) {
      result.push({
        image_url: openLibraryCoverById(coverId),
        source: 'open_library',
        title: text(e.title, COVER_TITLE_MAX_LENGTH) ?? request.title,
        author: null,
        spanish: hasSpanish(languages),
        size: OPEN_LIBRARY_IMAGE_SIZE,
        pinned: false,
      });
    }
  }
  return result;
}

// Google Books --------------------------------------------------------------

export const GOOGLE_BOOKS_URL = 'https://www.googleapis.com/books/v1/volumes';

/**
 * Google Books searches (fallback), in order: restricted to Spanish first, then without the
 * language filter. With an author, the title + author query leads and the title alone follows;
 * by ISBN when there is one. The API key is optional (lower quota without it). Never logged.
 */
export function googleBooksQueries(
  request: FindCoverRequest,
  apiKey: string | null,
): CatalogQuery[] {
  const url = (q: string, langRestrict: string | null) => {
    const params = new URLSearchParams({
      q,
      maxResults: '10',
      printType: 'books',
      fields: 'items(volumeInfo(title,authors,language,imageLinks))',
    });
    if (langRestrict) params.set('langRestrict', langRestrict);
    if (apiKey) params.set('key', apiKey);
    return `${GOOGLE_BOOKS_URL}?${params.toString()}`;
  };
  if (request.isbn) {
    return [{ source: 'google_books', attempt: 'isbn', url: url(`isbn:${request.isbn}`, null) }];
  }
  const lead = request.author ? `${request.title} inauthor:${request.author}` : request.title;
  const leadName = request.author ? 'title_author' : 'title';
  const queries: CatalogQuery[] = [
    { source: 'google_books', attempt: `${leadName}_es`, url: url(lead, 'es') },
    { source: 'google_books', attempt: leadName, url: url(lead, null) },
  ];
  if (request.author) {
    queries.push({ source: 'google_books', attempt: 'title', url: url(request.title, null) });
  }
  return queries;
}

/**
 * Google returns small http thumbnails with a page-curl effect: https, no curl, and the larger
 * zoom level. Null when the result is not on an allowlisted host.
 */
export function normalizeGoogleImage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let url: URL;
  try {
    url = new URL(value.replace(/^http:\/\//i, 'https://'));
  } catch {
    return null;
  }
  url.searchParams.delete('edge');
  if (url.searchParams.has('zoom')) url.searchParams.set('zoom', '0');
  const upgraded = url.toString();
  return isAllowedCoverUrl(upgraded) ? upgraded : null;
}

/** Image links from the largest to the smallest, with the size rank of each. */
const GOOGLE_IMAGE_SIZES = [
  ['extraLarge', 5],
  ['large', 4],
  ['medium', 3],
  ['small', 2],
  ['thumbnail', 1],
  ['smallThumbnail', 0],
] as const;

export function googleBooksRanked(response: unknown, request: FindCoverRequest): RankedCandidate[] {
  const items = (response as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  const scored: (RankedCandidate & { score: number })[] = [];
  for (const item of items) {
    const info = (item as { volumeInfo?: Record<string, unknown> } | null)?.volumeInfo;
    if (!info) continue;
    const links = (info.imageLinks ?? {}) as Record<string, unknown>;
    let image: string | null = null;
    let size = 0;
    for (const [name, rank] of GOOGLE_IMAGE_SIZES) {
      image = normalizeGoogleImage(links[name]);
      if (image) {
        size = rank;
        break;
      }
    }
    if (!image) continue;
    const authors = strings(info.authors);
    const title = text(info.title, COVER_TITLE_MAX_LENGTH);
    // An ISBN search is already exact; a text search must resemble the typed title.
    const score = request.isbn ? 3 : matchScore(request, title, authors);
    if (score === 0) continue;
    scored.push({
      image_url: image,
      source: 'google_books',
      title,
      author: text(authors[0], COVER_AUTHOR_MAX_LENGTH),
      spanish: typeof info.language === 'string' && info.language.toLowerCase() === 'es',
      size,
      pinned: false,
      score,
    });
  }
  return byScore(scored).map(({ score: _score, ...c }) => c);
}

export function googleBooksCandidates(
  response: unknown,
  request: FindCoverRequest,
): CoverCandidate[] {
  return googleBooksRanked(response, request).map(stripRank);
}

// Merge ---------------------------------------------------------------------

/**
 * Identity of an image for de-duplication: the Open Library cover id (or ISBN) and the Google
 * Books volume id, so the same picture at another size, protocol or zoom counts once.
 */
export function imageKey(imageUrl: string): string {
  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    return imageUrl;
  }
  const host = url.hostname.toLowerCase();
  if (host === 'covers.openlibrary.org') {
    const match = /^\/b\/(id|isbn)\/([0-9X]+)-/i.exec(url.pathname);
    if (match) return `ol:${match[1].toLowerCase()}:${match[2].toUpperCase()}`;
  }
  const volume = url.searchParams.get('id');
  if (host.startsWith('books.google') && volume) return `gb:${volume}`;
  return `${host}${url.pathname}`.toLowerCase();
}

/**
 * Ordered, de-duplicated candidates: only allowlisted https URLs, one per image (see
 * `imageKey`), the request's own ISBN cover first, then Spanish editions, then larger images;
 * ties keep the order they were found in. At most MAX_COVER_CANDIDATES.
 */
export function rankCoverCandidates(list: readonly RankedCandidate[]): CoverCandidate[] {
  const seen = new Set<string>();
  const unique: RankedCandidate[] = [];
  for (const candidate of list) {
    if (!isAllowedCoverUrl(candidate.image_url)) continue;
    const key = imageKey(candidate.image_url);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }
  return unique
    .map((candidate, index) => ({ candidate, index }))
    .sort(
      (a, b) =>
        Number(b.candidate.pinned) - Number(a.candidate.pinned) ||
        Number(b.candidate.spanish) - Number(a.candidate.spanish) ||
        b.candidate.size - a.candidate.size ||
        a.index - b.index,
    )
    .slice(0, MAX_COVER_CANDIDATES)
    .map(({ candidate }) => stripRank(candidate));
}

/**
 * Open Library first, Google Books as the fallback; only allowlisted https URLs, no duplicate
 * images, at most MAX_COVER_CANDIDATES, in the given order.
 */
export function mergeCoverCandidates(
  ...lists: readonly (readonly CoverCandidate[])[]
): CoverCandidate[] {
  const seen = new Set<string>();
  const merged: CoverCandidate[] = [];
  for (const list of lists) {
    for (const candidate of list) {
      if (merged.length >= MAX_COVER_CANDIDATES) return merged;
      const key = imageKey(candidate.image_url);
      if (!isAllowedCoverUrl(candidate.image_url) || seen.has(key)) continue;
      seen.add(key);
      merged.push(candidate);
    }
  }
  return merged;
}

// Search plan ---------------------------------------------------------------

/** One catalog answer: the HTTP status (0 = network error or timeout) and its JSON body. */
export type CatalogAnswer = { status: number; body: unknown };

/** Non-sensitive log record of one attempt (never the title, author, URL or key). */
export type AttemptLog = {
  source: CoverSource;
  attempt: string;
  status: number;
  candidates: number;
};

/**
 * Runs the searches in order and collects up to MAX_COVER_CANDIDATES distinct covers:
 * 1. Open Library queries until one gives candidates, then the editions of the best matching
 *    work (more cover variety).
 * 2. Google Books (Spanish first, then without the language filter) while there are fewer than
 *    the maximum, even when an earlier query already gave some.
 * `fetchJson` does the network part; `budgetLeft` stops early when time runs out. Returns null
 * only when every request failed (nothing to conclude).
 */
export async function searchCovers(
  request: FindCoverRequest,
  {
    fetchJson,
    googleApiKey,
    budgetLeft = () => true,
    log = () => undefined,
  }: {
    fetchJson: (url: string) => Promise<CatalogAnswer>;
    googleApiKey: string | null;
    budgetLeft?: () => boolean;
    log?: (entry: AttemptLog) => void;
  },
): Promise<CoverCandidate[] | null> {
  let anyAnswered = false;
  const collected: RankedCandidate[] = [];
  const enough = () => rankCoverCandidates(collected).length >= MAX_COVER_CANDIDATES;
  /** One request; its parsed candidates when it answered 200 (logged either way), else null. */
  const attempt = async (
    query: CatalogQuery,
    parse: (body: unknown) => RankedCandidate[],
  ): Promise<RankedCandidate[] | null> => {
    const answer = await fetchJson(query.url);
    const ok = answer.status === 200;
    const parsed = ok ? parse(answer.body) : null;
    if (ok) anyAnswered = true;
    log({
      source: query.source,
      attempt: query.attempt,
      status: answer.status,
      candidates: parsed ? parsed.length : 0,
    });
    return parsed;
  };

  for (const query of openLibraryQueries(request)) {
    if (!budgetLeft()) break;
    const found: { workKey: string | null } = { workKey: null };
    const parsed = await attempt(query, (body) => {
      found.workKey = openLibraryBestWork(body, request);
      return openLibraryRanked(body, request);
    });
    if (parsed && parsed.length > 0) {
      collected.push(...parsed);
      const editions = found.workKey ? openLibraryEditionsQuery(found.workKey) : null;
      if (editions && budgetLeft() && !enough()) {
        const more = await attempt(editions, (body) => openLibraryEditionCandidates(body, request));
        if (more) collected.push(...more);
      }
      break;
    }
  }
  for (const query of googleBooksQueries(request, googleApiKey)) {
    if (enough() || !budgetLeft()) break;
    const parsed = await attempt(query, (body) => googleBooksRanked(body, request));
    if (parsed) collected.push(...parsed);
  }
  const merged = rankCoverCandidates(collected);
  return merged.length === 0 && !anyAnswered ? null : merged;
}
