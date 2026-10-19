-- Phase 10.1: server-side limits for user-typed text and page numbers.
-- Run manually in the Supabase SQL Editor after the previous migrations. Idempotent: safe to
-- run more than once (existing values are cleaned first, constraints are dropped and re-added).
--
-- Same numbers as src/lib/inputLimits.ts (a Jest test checks this file against it):
--   user_books: title 200, author 120, genre 60, notes 2000, lent_to 80, page_count 1-10000,
--               current_page 0-10000 (and never above page_count, an older constraint)
--   profiles:   display_name 50
-- Lengths are characters (code points), what char_length counts.
--
-- Not constrained on purpose: recommendations.rationale and request_context are written by the
-- Edge Functions (model output, already capped there), and recommendations.suggested_* already
-- have their own limits (20261012000000_discovery_recommendations.sql).

-- ---------------------------------------------------------------------------
-- 1. Clean existing values so the constraints can be added. Rows that change get a new
--    updated_at (trigger), so other devices pull the cleaned copy.
-- ---------------------------------------------------------------------------

update public.user_books
  set title = left(btrim(title), 200)
  where char_length(title) > 200;

update public.user_books
  set author = left(author, 120)
  where char_length(author) > 120;

update public.user_books
  set genre = left(genre, 60)
  where char_length(genre) > 60;

update public.user_books
  set notes = left(notes, 2000)
  where char_length(notes) > 2000;

-- A loan needs a non-blank name (user_books_loan_consistency), so trim before cutting.
update public.user_books
  set lent_to = left(btrim(lent_to), 80)
  where char_length(lent_to) > 80;

update public.user_books
  set page_count = 10000
  where page_count > 10000;

update public.user_books
  set current_page = least(current_page, coalesce(page_count, 10000))
  where current_page > coalesce(page_count, 10000);

update public.profiles
  set display_name = left(btrim(display_name), 50)
  where char_length(display_name) > 50;

-- ---------------------------------------------------------------------------
-- 2. Constraints (drop if exists, then add).
-- ---------------------------------------------------------------------------

alter table public.user_books drop constraint if exists user_books_title_length;
alter table public.user_books
  add constraint user_books_title_length check (char_length(title) <= 200);

alter table public.user_books drop constraint if exists user_books_author_length;
alter table public.user_books
  add constraint user_books_author_length check (author is null or char_length(author) <= 120);

alter table public.user_books drop constraint if exists user_books_genre_length;
alter table public.user_books
  add constraint user_books_genre_length check (genre is null or char_length(genre) <= 60);

alter table public.user_books drop constraint if exists user_books_notes_length;
alter table public.user_books
  add constraint user_books_notes_length check (notes is null or char_length(notes) <= 2000);

alter table public.user_books drop constraint if exists user_books_lent_to_length;
alter table public.user_books
  add constraint user_books_lent_to_length check (lent_to is null or char_length(lent_to) <= 80);

alter table public.user_books drop constraint if exists user_books_page_count_range;
alter table public.user_books
  add constraint user_books_page_count_range check (
    page_count is null or page_count between 1 and 10000
  );

-- user_books_current_page_range (initial schema) already keeps current_page between 0 and
-- page_count; this one also caps it when the page count is unknown.
alter table public.user_books drop constraint if exists user_books_current_page_cap;
alter table public.user_books
  add constraint user_books_current_page_cap check (current_page between 0 and 10000);

alter table public.profiles drop constraint if exists profiles_display_name_length;
alter table public.profiles
  add constraint profiles_display_name_length check (
    display_name is null or char_length(display_name) <= 50
  );

-- ---------------------------------------------------------------------------
-- 3. New-user trigger: the name from sign-up metadata is cut to the new limit instead of
--    failing the whole sign-up (same function as the initial schema, 50 instead of 80).
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), 50)
  )
  on conflict (id) do nothing;

  insert into public.reading_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
