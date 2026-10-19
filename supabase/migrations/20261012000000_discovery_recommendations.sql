-- Phase 7.5: "Nuevas aventuras". A recommendation can now be a book that is NOT on the user's
-- shelf ('discovery'): it has no user_book_id, only the suggested title/author/genre/pages and
-- whether an open catalog confirmed it exists. Shelf recommendations ('shelf') are unchanged.
--
-- Idempotent: safe to run more than once. Existing rows become kind = 'shelf' (the default).
-- RLS and the existing policies (owner column user_id) apply to the new columns as they are.
-- The composite foreign key (user_book_id, user_id) stays: with MATCH SIMPLE (the default) it
-- is not checked when user_book_id is null, which is exactly the discovery case.

alter table public.recommendations
  alter column user_book_id drop not null;

alter table public.recommendations
  add column if not exists kind text not null default 'shelf',
  add column if not exists suggested_title text,
  add column if not exists suggested_author text,
  add column if not exists suggested_genre text,
  add column if not exists suggested_page_count integer,
  add column if not exists suggestion_verified boolean;

alter table public.recommendations
  drop constraint if exists recommendations_kind_check;
alter table public.recommendations
  add constraint recommendations_kind_check check (kind in ('shelf', 'discovery'));

-- A shelf recommendation points to a book; a discovery one carries a title instead.
alter table public.recommendations
  drop constraint if exists recommendations_kind_fields_check;
alter table public.recommendations
  add constraint recommendations_kind_fields_check check (
    (kind = 'shelf' and user_book_id is not null)
    or (
      kind = 'discovery'
      and suggested_title is not null
      and char_length(btrim(suggested_title)) > 0
    )
  );

alter table public.recommendations
  drop constraint if exists recommendations_suggested_lengths_check;
alter table public.recommendations
  add constraint recommendations_suggested_lengths_check check (
    (suggested_title is null or char_length(suggested_title) <= 300)
    and (suggested_author is null or char_length(suggested_author) <= 200)
    and (suggested_genre is null or char_length(suggested_genre) <= 40)
    and (suggested_page_count is null or suggested_page_count between 1 and 10000)
  );

-- The function reads the user's latest discovery suggestions to avoid repeating them.
create index if not exists recommendations_user_kind_created_idx
  on public.recommendations (user_id, kind, created_at desc);
