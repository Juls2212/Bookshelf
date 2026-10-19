// "Portada sugerida" rules (pure): which image URLs the app accepts, which downloaded images
// are good enough to be a cover, and when the form asks for a suggestion at all.

/** Same allowlist as the find-cover function; checked again before any download. */
export const COVER_HOST_ALLOWLIST = [
  'covers.openlibrary.org',
  'books.google.com',
  'books.googleusercontent.com',
] as const;

/** Smaller images are catalog placeholders ("no cover"), never real covers. */
export const MIN_SUGGESTED_COVER_PX = 100;
/** Larger downloads are refused (a cover is a few hundred KB). */
export const MAX_SUGGESTED_COVER_BYTES = 5 * 1024 * 1024;
export const SUGGESTED_COVER_TYPES: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
/** Most candidates the app keeps (same cap as the find-cover function). */
export const MAX_COVER_CANDIDATES = 10;
/** Titles shorter than this are not looked up. */
export const COVER_SUGGESTION_MIN_TITLE = 3;

export type CoverCandidateSource = 'open_library' | 'google_books';

export type CoverCandidate = {
  imageUrl: string;
  source: CoverCandidateSource;
  title: string | null;
  author: string | null;
};

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

/** Hops a download may follow (covers.openlibrary.org answers with a redirect). */
export const MAX_COVER_REDIRECTS = 3;

/**
 * Where a cover download may be redirected: the allowlisted hosts, plus the Internet Archive,
 * which stores Open Library's images (archive.org and its *.archive.org servers, e.g.
 * ia800100.us.archive.org). https only. The first URL must still be on the strict allowlist.
 */
export function isAllowedRedirectUrl(value: unknown): value is string {
  if (isAllowedCoverUrl(value)) return true;
  if (typeof value !== 'string' || value.length > 2000) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return (
    url.protocol === 'https:' &&
    url.username === '' &&
    url.password === '' &&
    url.port === '' &&
    (host === 'archive.org' || host.endsWith('.archive.org'))
  );
}

/** Image type from the first bytes (servers sometimes send no or a generic content type). */
export function sniffImageExtension(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'png';
  }
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  return null;
}

/**
 * Extension for a download: the declared image type, or (with no or a generic type) what the
 * bytes say. Any other declared type (HTML error pages, text) is refused.
 */
export function downloadedImageExtension(
  contentType: string | null | undefined,
  bytes: Uint8Array,
): string | null {
  const declared = coverExtensionFor(contentType);
  if (declared) return declared;
  const type = contentType?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (type === '' || type === 'application/octet-stream' || type === 'binary/octet-stream') {
    return sniffImageExtension(bytes);
  }
  return null;
}

/** File extension for an accepted content type, or null for anything else. */
export function coverExtensionFor(contentType: string | null | undefined): string | null {
  const type = contentType?.split(';')[0]?.trim().toLowerCase() ?? '';
  return SUGGESTED_COVER_TYPES[type] ?? null;
}

/** Real covers only: tiny placeholder images are rejected. */
export function isUsableCoverSize(size: { width: number; height: number }): boolean {
  return size.width >= MIN_SUGGESTED_COVER_PX && size.height >= MIN_SUGGESTED_COVER_PX;
}

/**
 * Ask for a suggestion only when it can help: the form allows it, the book has no cover (new
 * or saved), the user did not say "No, gracias" and the title is long enough.
 */
export function shouldSuggestCover({
  enabled,
  hasCover,
  dismissed,
  title,
}: {
  enabled: boolean;
  hasCover: boolean;
  dismissed: boolean;
  title: string;
}): boolean {
  return enabled && !hasCover && !dismissed && title.trim().length >= COVER_SUGGESTION_MIN_TITLE;
}

/** The function's answer has the expected `{ data: { candidates: [...] } }` shape. */
export function hasCandidateList(body: unknown): boolean {
  return Array.isArray((body as { data?: { candidates?: unknown } } | null)?.data?.candidates);
}

/**
 * Candidates from the function (`image_url` in the JSON becomes `imageUrl`), checked again on
 * the client (allowlist, shape, at most MAX_COVER_CANDIDATES).
 */
export function toCoverCandidates(body: unknown): CoverCandidate[] {
  const list = (body as { data?: { candidates?: unknown } } | null)?.data?.candidates;
  if (!Array.isArray(list)) return [];
  const candidates: CoverCandidate[] = [];
  const seen = new Set<string>();
  for (const item of list as unknown[]) {
    if (candidates.length >= MAX_COVER_CANDIDATES) break;
    const c = (item ?? {}) as Record<string, unknown>;
    if (!isAllowedCoverUrl(c.image_url) || seen.has(c.image_url)) continue;
    if (c.source !== 'open_library' && c.source !== 'google_books') continue;
    seen.add(c.image_url);
    candidates.push({
      imageUrl: c.image_url,
      source: c.source,
      title: typeof c.title === 'string' && c.title.trim() ? c.title.trim() : null,
      author: typeof c.author === 'string' && c.author.trim() ? c.author.trim() : null,
    });
  }
  return candidates;
}
