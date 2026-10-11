export type ReadingStatus = 'to_read' | 'reading' | 'finished';

export type CoverSource = 'camera' | 'gallery';

export interface Book {
  /** Client-generated UUID. */
  id: string;
  title: string;
  author: string | null;
  genre: string | null;
  pageCount: number | null;
  /** Object path in the private covers bucket: `{user_id}/{book_id}.jpg`. */
  coverPath: string | null;
  coverSource: CoverSource | null;
  /**
   * Runtime-only display URL (signed URL or local file). Never persisted; resolved from
   * `coverPath` by the cover service.
   */
  coverUri?: string | null;
  readingStatus: ReadingStatus;
  currentPage: number | null;
  /** 1-5, null when not rated. */
  rating: number | null;
  notes: string | null;
  lentTo: string | null;
  /** ISO 8601 timestamps. */
  lentAt: string | null;
  createdAt: string;
  updatedAt: string;
  statusChangedAt: string | null;
}
