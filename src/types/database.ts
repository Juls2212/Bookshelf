// Hand-written types for the remote schema in supabase/migrations.
// Keep in sync with the SQL. Timestamps are ISO 8601 strings; uuids are strings.
// Shaped like generated Supabase types so it can be passed to createClient<Database>().
import type { CoverSource, ReadingStatus } from './book';

export type { CoverSource, ReadingStatus };

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type GenreKey =
  'novel' | 'poetry' | 'history' | 'essay' | 'mystery' | 'chronicle' | 'fantasy' | 'biography';

export type RecommendationDisposition = 'suggested' | 'viewed' | 'read_later' | 'skipped';

export type ThemePreference = 'system' | 'light' | 'dark';

/** Private storage bucket for covers. Object path: `{user_id}/{book_id}.jpg`. */
export const BOOK_COVERS_BUCKET = 'book-covers';

// profiles ------------------------------------------------------------------

export type ProfileRow = {
  id: string;
  display_name: string | null;
  theme: ThemePreference;
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

export type RecommendationRow = {
  id: string;
  user_id: string;
  user_book_id: string;
  rationale: string;
  request_context: Json;
  disposition: RecommendationDisposition;
  created_at: string;
};

export type RecommendationInsert = {
  id?: string;
  user_id?: string;
  user_book_id: string;
  rationale: string;
  request_context?: Json;
  disposition?: RecommendationDisposition;
  created_at?: string;
};

export type RecommendationUpdate = Partial<Omit<RecommendationRow, 'id' | 'user_id'>>;

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
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
