// Identifies ONE book (its cover or its spine) from a photo, never a full shelf. The
// implementation is picked by createBookIdentifier (identifierFactory.ts): the Supabase Edge
// Function `identify-book`, or a fake chosen in the dev gallery. The result is only a proposal:
// the user always reviews it before anything is saved.

import type { CropRect } from '@/features/library/coverCrop';

import type { Quad } from './coverGeometry';

export type ScanMode = 'cover' | 'spine';

export type IdentifyConfidence = 'high' | 'medium' | 'low';

export type IdentifiedBook = {
  title: string;
  author: string | null;
  genre: string | null;
  pageCount: number | null;
  confidence: IdentifyConfidence;
  /** Where the front cover is in the photo (fractions of the image), or null if unsure. */
  coverBox: CropRect | null;
  /** The 4 corners of the front cover (fractions of the image), or null if unsure. */
  coverCorners: Quad | null;
};

export const IDENTIFY_ERROR_CODES = [
  'not_a_book',
  'low_confidence',
  'network',
  'timeout',
  'rate_limited',
  'unauthorized',
  'unknown',
] as const;

export type IdentifyErrorCode = (typeof IDENTIFY_ERROR_CODES)[number];

/** Typed failure of an identifier. `message` is the English code. */
export class BookIdentifyError extends Error {
  readonly code: IdentifyErrorCode;

  constructor(code: IdentifyErrorCode) {
    super(code);
    this.name = 'BookIdentifyError';
    this.code = code;
  }
}

export type IdentifyRequest = {
  /** Local file URI of the prepared photo (max 1024 px, JPEG). */
  imageUri: string;
  mode: ScanMode;
};

export type IdentifyOptions = {
  /** Aborting it must stop the request (cancel or timeout). */
  signal?: AbortSignal;
};

export interface BookIdentifier {
  /** Resolves with the identified book or rejects with a BookIdentifyError. */
  identify(request: IdentifyRequest, options?: IdentifyOptions): Promise<IdentifiedBook>;
}

export function toIdentifyErrorCode(error: unknown): IdentifyErrorCode {
  return error instanceof BookIdentifyError ? error.code : 'unknown';
}
