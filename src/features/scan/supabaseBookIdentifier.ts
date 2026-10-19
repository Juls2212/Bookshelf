// Real identifier: sends the prepared photo to the `identify-book` Edge Function, which calls
// OpenAI on the server. The app never holds an AI key. Errors become the app's typed codes.
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { File } from 'expo-file-system';

import { isPlausibleCoverBox } from '@/features/library/coverCrop';

import { isValidQuad, orderCorners, type Point, type Quad } from './coverGeometry';
import { getSupabaseClient, type AppSupabaseClient } from '@/lib/supabase';

import {
  BookIdentifyError,
  type BookIdentifier,
  type IdentifiedBook,
  type IdentifyConfidence,
  type IdentifyErrorCode,
} from './bookIdentifier';

export const IDENTIFY_FUNCTION = 'identify-book';

type Deps = {
  getClient?: () => Pick<AppSupabaseClient, 'functions'>;
  readBase64?: (uri: string) => Promise<string>;
};

/** Error codes of the Edge Function -> codes the app shows cards for. */
const SERVER_ERRORS: Record<string, IdentifyErrorCode> = {
  unauthorized: 'unauthorized',
  rate_limited: 'rate_limited',
  not_a_book: 'not_a_book',
  low_confidence: 'low_confidence',
  timeout: 'timeout',
  upstream_error: 'unknown',
  invalid_request: 'unknown',
  image_too_large: 'unknown',
};

function readFileBase64(uri: string): Promise<string> {
  return new File(uri).base64();
}

function abortError(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

/** `{ error: code }` from the function; the status alone when there is no readable body. */
async function httpErrorCode(response: unknown): Promise<IdentifyErrorCode> {
  let code: unknown;
  try {
    code = ((await (response as Response).clone().json()) as { error?: unknown }).error;
  } catch {
    code = undefined;
  }
  if (typeof code === 'string' && code in SERVER_ERRORS) return SERVER_ERRORS[code];
  const status = (response as { status?: unknown } | null)?.status;
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429) return 'rate_limited';
  return 'unknown';
}

const isConfidence = (value: unknown): value is IdentifyConfidence =>
  value === 'high' || value === 'medium' || value === 'low';

const optionalText = (value: unknown) => (typeof value === 'string' ? value : null);

/**
 * Checked again here: 4 numeric points, put in order first, then only a convex shape of at least
 * 5 % of the photo gets through.
 */
function toCoverCorners(value: unknown): Quad | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const points = value as Partial<Point>[];
  if (!points.every((p) => typeof p?.x === 'number' && typeof p?.y === 'number')) return null;
  const ordered = orderCorners(points as Point[]);
  return isValidQuad(ordered) ? ordered : null;
}

/** Checks the `{ data }` body again on the client: only well-formed results get through. */
function toIdentifiedBook(body: unknown): IdentifiedBook {
  const data = (body as { data?: unknown } | null)?.data as Record<string, unknown> | undefined;
  if (!data || typeof data.title !== 'string' || !isConfidence(data.confidence)) {
    throw new BookIdentifyError('unknown');
  }
  const pages = data.page_count;
  const box = data.cover_box;
  const corners = data.cover_corners;
  return {
    title: data.title,
    author: optionalText(data.author),
    genre: optionalText(data.genre),
    pageCount: typeof pages === 'number' && Number.isInteger(pages) ? pages : null,
    confidence: data.confidence,
    // An implausible box is dropped here; the review screen then uses its centered crop.
    coverBox: isPlausibleCoverBox(box)
      ? { x: box.x, y: box.y, width: box.width, height: box.height }
      : null,
    coverCorners: toCoverCorners(corners),
  };
}

export function createSupabaseBookIdentifier({
  getClient = getSupabaseClient,
  readBase64 = readFileBase64,
}: Deps = {}): BookIdentifier {
  return {
    async identify({ imageUri, mode }, { signal } = {}) {
      if (signal?.aborted) throw abortError();
      let image: string;
      try {
        image = await readBase64(imageUri);
      } catch {
        throw new BookIdentifyError('unknown');
      }
      if (signal?.aborted) throw abortError();

      const { data, error } = await getClient().functions.invoke(IDENTIFY_FUNCTION, {
        body: { image_base64: image, mode },
        signal,
      });
      if (signal?.aborted) throw abortError();
      if (error) {
        if (error instanceof FunctionsHttpError) {
          throw new BookIdentifyError(await httpErrorCode(error.context));
        }
        if (error instanceof FunctionsFetchError) throw new BookIdentifyError('network');
        throw new BookIdentifyError('unknown');
      }
      return toIdentifiedBook(data);
    },
  };
}

export const supabaseBookIdentifier: BookIdentifier = createSupabaseBookIdentifier();
