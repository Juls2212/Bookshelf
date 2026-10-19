// Hand-written types for the remote schema in supabase/migrations.
// Keep in sync with the SQL. Timestamps are ISO 8601 strings; uuids are strings.
// Shaped like generated Supabase types so it can be passed to createClient<Database>().
import type { CoverSource, ReadingStatus } from './book';

export type { CoverSource, ReadingStatus };

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type GenreKey =
  'novel' | 'poetry' | 'history' | 'essay' | 'mystery' | 'chronicle' | 'fantasy' | 'biography';

export type RecommendationDisposition = 'suggested' | 'viewed' | 'read_later' | 'skipped';

export type ThemePreference = 'system' | 'light' | 'dark';

/** Private storage bucket for covers. Object path: `{user_id}/{book_id}.jpg`. */
export const BOOK_COVERS_BUCKET = 'book-covers';

/** Private storage bucket for profile photos. Object path: `{user_id}/avatar.jpg`. */
export const AVATARS_BUCKET = 'avatars';

// profiles ------------------------------------------------------------------

export type ProfileRow = {
  id: string;
  display_name: string | null;
  theme: ThemePreference;
  /** Storage path of the profile photo in the avatars bucket, or null without a photo. */
  avatar_path: string | null;
  /** When the photo was last changed (set by the client); other devices refresh when newer. */
  avatar_updated_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ProfileInsert = {
  id: string;
  display_name?: string | null;
  theme?: ThemePreference;
  created_at?: string;
  updated_at?: string;
};

export type ProfileUpdate = Partial<Omit<ProfileRow, 'id'>>;

// reading_preferences -------------------------------------------------------

export type ReadingPreferencesRow = {
  user_id: string;
  favorite_genres: GenreKey[];
  prioritize_unread: boolean;
  consider_mood: boolean;
  prefer_short_weekdays: boolean;
  updated_at: string;
};

export type ReadingPreferencesInsert = {
  user_id: string;
  favorite_genres?: GenreKey[];
  prioritize_unread?: boolean;
  consider_mood?: boolean;
  prefer_short_weekdays?: boolean;
  updated_at?: string;
};

export type ReadingPreferencesUpdate = Partial<Omit<ReadingPreferencesRow, 'user_id'>>;

// user_books ----------------------------------------------------------------

export type UserBookRow = {
  id: string;
  user_id: string;
  title: string;
  author: string | null;
  genre: string | null;
  page_count: number | null;
  cover_path: string | null;
  cover_source: CoverSource | null;
  reading_status: ReadingStatus;
  current_page: number;
  rating: number | null;
  notes: string | null;
  lent_to: string | null;
  lent_at: string | null;
  status_changed_at: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

/** `id` is normally client-generated; `user_id` defaults to auth.uid(). */
export type UserBookInsert = {
  id?: string;
  user_id?: string;
  title: string;
  author?: string | null;
  genre?: string | null;
  page_count?: number | null;
  cover_path?: string | null;
  cover_source?: CoverSource | null;
  reading_status?: ReadingStatus;
  current_page?: number;
  rating?: number | null;
  notes?: string | null;
  lent_to?: string | null;
  lent_at?: string | null;
  status_changed_at?: string;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
};

export type UserBookUpdate = Partial<Omit<UserBookRow, 'id' | 'user_id'>>;

// recommendations -----------------------------------------------------------

/** 'shelf': a book on the user's shelf. 'discovery': a suggested book outside it (7.5). */
export type RecommendationKind = 'shelf' | 'discovery';

export type RecommendationRow = {
  id: string;
  user_id: string;
  /** Null for discovery suggestions (no book on the shelf). */
  user_book_id: string | null;
  rationale: string;
  request_context: Json;
  disposition: RecommendationDisposition;
  created_at: string;
  kind: RecommendationKind;
  suggested_title: string | null;
  suggested_author: string | null;
  suggested_genre: string | null;
  suggested_page_count: number | null;
  suggestion_verified: boolean | null;
};

export type RecommendationInsert = {
  id?: string;
  user_id?: string;
  user_book_id?: string | null;
  kind?: RecommendationKind;
  suggested_title?: string | null;
  suggested_author?: string | null;
  suggested_genre?: string | null;
  suggested_page_count?: number | null;
  suggestion_verified?: boolean | null;
  rationale: string;
  request_context?: Json;
  disposition?: RecommendationDisposition;
  created_at?: string;
};

export type RecommendationUpdate = Partial<Omit<RecommendationRow, 'id' | 'user_id'>>;

// reading_events --------------------------------------------------------------

/** Append-only reading log: one row per change of a book's current page. */
export type ReadingEventRow = {
  id: string;
  user_id: string;
  book_id: string;
  /** Signed page difference (negative = correction). */
  pages_delta: number;
  /** The device's local calendar date when it happened ("YYYY-MM-DD"). */
  local_date: string;
  occurred_at: string;
  /** Server insert time (the pull cursor). */
  created_at: string;
};

export type ReadingEventInsert = Omit<ReadingEventRow, 'created_at'> & { created_at?: string };

// Database ------------------------------------------------------------------

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: ProfileInsert;
        Update: ProfileUpdate;
        Relationships: [];
      };
      reading_preferences: {
        Row: ReadingPreferencesRow;
        Insert: ReadingPreferencesInsert;
        Update: ReadingPreferencesUpdate;
        Relationships: [];
      };
      user_books: {
        Row: UserBookRow;
        Insert: UserBookInsert;
        Update: UserBookUpdate;
        Relationships: [];
      };
      recommendations: {
        Row: RecommendationRow;
        Insert: RecommendationInsert;
        Update: RecommendationUpdate;
        Relationships: [
          {
            foreignKeyName: 'recommendations_user_book_fkey';
            columns: ['user_book_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'user_books';
            referencedColumns: ['id', 'user_id'];
          },
        ];
      };
      reading_events: {
        Row: ReadingEventRow;
        Insert: ReadingEventInsert;
        // Append-only: no update policy exists.
        Update: { [_ in never]: never };
        Relationships: [
          {
            foreignKeyName: 'reading_events_user_book_fkey';
            columns: ['book_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'user_books';
            referencedColumns: ['id', 'user_id'];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
