// Cover suggestions: asks the `find-cover` Edge Function (public catalogs, no AI) for up to
// ten cover images, and downloads the one the user accepts. Everything here is optional:
// failures resolve to "nothing to suggest" (the form never shows an error for it).
import { Directory, File, Paths } from 'expo-file-system';

import { getSupabaseClient, type AppSupabaseClient } from '@/lib/supabase';

import { coverService, type CoverService, type LocalImage } from './coverService';
import {
  downloadedImageExtension,
  isAllowedCoverUrl,
  isAllowedRedirectUrl,
  isUsableCoverSize,
  MAX_COVER_REDIRECTS,
  MAX_SUGGESTED_COVER_BYTES,
  hasCandidateList,
  toCoverCandidates,
  type CoverCandidate,
} from './coverSuggestion';

export const FIND_COVER_FUNCTION = 'find-cover';
const FIND_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 15_000;

export type CoverQuery = { title: string; author: string | null };

export interface CoverFinder {
  /**
   * Up to ten candidates, best first; [] when the catalogs found nothing; null when the
   * search failed (network, timeout, rate limit, cancelled), which the form keeps silent.
   */
  find(query: CoverQuery, options?: { signal?: AbortSignal }): Promise<CoverCandidate[] | null>;
  /**
   * Downloads an accepted candidate to the cache as a LocalImage for the normal cover pipeline;
   * null when the URL, type, size or image dimensions are not acceptable.
   */
  download(
    candidate: CoverCandidate,
    options?: { signal?: AbortSignal },
  ): Promise<LocalImage | null>;
}

/** Aborts after `ms` or when the caller aborts. */
function withDeadline(signal: AbortSignal | undefined, ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * GET with at most MAX_COVER_REDIRECTS hops, each one checked (https, allowed redirect host).
 * Where the platform follows redirects itself (React Native ignores `redirect: 'manual'`), the
 * final URL is checked instead. Null when a hop is not allowed or there are too many.
 */
async function fetchFollowingRedirects(
  fetchImpl: typeof fetch,
  firstUrl: string,
  signal: AbortSignal,
): Promise<Response | null> {
  let url = firstUrl;
  for (let hop = 0; hop <= MAX_COVER_REDIRECTS; hop += 1) {
    const response = await fetchImpl(url, { signal, redirect: 'manual' });
    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get('location');
      if (!location || hop === MAX_COVER_REDIRECTS) return null;
      const next = new URL(location, url).toString();
      if (!isAllowedRedirectUrl(next)) return null;
      url = next;
      continue;
    }
    // Followed by the platform: the image must have come from an allowed place.
    if (response.url && response.url !== url && !isAllowedRedirectUrl(response.url)) return null;
    return response;
  }
  return null;
}

/** Writes downloaded bytes to a new cache file (injected in tests). */
type CacheFiles = {
  write(bytes: Uint8Array, extension: string): string;
  remove(uri: string): void;
};

const deviceCacheFiles: CacheFiles = {
  write(bytes, extension) {
    const dir = new Directory(Paths.cache, 'suggested-covers');
    dir.create({ intermediates: true, idempotent: true });
    const file = new File(dir, `cover_${Date.now()}.${extension}`);
    file.create({ overwrite: true });
    file.write(bytes);
    return file.uri;
  },
  remove(uri) {
    const file = new File(uri);
    if (file.exists) file.delete();
  },
};

type Deps = {
  getClient?: () => Pick<AppSupabaseClient, 'functions'>;
  fetchImpl?: typeof fetch;
  files?: CacheFiles;
  covers?: Pick<CoverService, 'measure'>;
};

export function createCoverFinder({
  getClient = getSupabaseClient,
  fetchImpl = (...args) => fetch(...args),
  files = deviceCacheFiles,
  covers = coverService,
}: Deps = {}): CoverFinder {
  return {
    async find({ title, author }, { signal } = {}) {
      if (signal?.aborted) return null;
      const deadline = withDeadline(signal, FIND_TIMEOUT_MS);
      // Settles as soon as the request is aborted, even if invoke ignores the signal.
      const aborted = new Promise<null>((resolve) => {
        deadline.signal.addEventListener('abort', () => resolve(null), { once: true });
      });
      try {
        const body: Record<string, string> = { title: title.trim() };
        if (author?.trim()) body.author = author.trim();
        const result = await Promise.race([
          getClient().functions.invoke(FIND_COVER_FUNCTION, { body, signal: deadline.signal }),
          aborted,
        ]);
        if (!result || result.error || !hasCandidateList(result.data)) return null;
        return toCoverCandidates(result.data);
      } catch {
        return null;
      } finally {
        deadline.done();
      }
    },

    async download(candidate, { signal } = {}) {
      if (!isAllowedCoverUrl(candidate.imageUrl)) return null;
      const deadline = withDeadline(signal, DOWNLOAD_TIMEOUT_MS);
      let uri: string | null = null;
      try {
        const response = await fetchFollowingRedirects(
          fetchImpl,
          candidate.imageUrl,
          deadline.signal,
        );
        if (!response?.ok) return null;
        const declared = Number(response.headers.get('content-length') ?? 0);
        if (declared > MAX_SUGGESTED_COVER_BYTES) return null;
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength === 0 || bytes.byteLength > MAX_SUGGESTED_COVER_BYTES) return null;
        const extension = downloadedImageExtension(response.headers.get('content-type'), bytes);
        if (!extension) return null;
        uri = files.write(bytes, extension);
        const size = await covers.measure(uri);
        if (!size.ok || !isUsableCoverSize(size.data)) {
          files.remove(uri);
          return null;
        }
        // Saved like a picked image: the existing pipeline crops, resizes and uploads it.
        return { uri, width: size.data.width, height: size.data.height, source: 'gallery' };
      } catch {
        if (uri) files.remove(uri);
        return null;
      } finally {
        deadline.done();
      }
    },
  };
}

export const coverFinder: CoverFinder = createCoverFinder();
