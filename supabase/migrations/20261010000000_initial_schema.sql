-- Bookshelf: initial remote schema with Row Level Security.
-- Run manually in the Supabase SQL Editor. Idempotent: safe to re-run.
-- Every table is private to its owner via auth.uid().

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  theme text not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_theme_check check (theme in ('system', 'light', 'dark'))
);

create table if not exists public.reading_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  favorite_genres text[] not null default '{}',
  prioritize_unread boolean not null default true,
  consider_mood boolean not null default true,
  prefer_short_weekdays boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint reading_preferences_genres_check check (
    favorite_genres <@ array[
      'novel', 'poetry', 'history', 'essay', 'mystery', 'chronicle', 'fantasy', 'biography'
    ]::text[]
  )
);

create table if not exists public.user_books (
  -- Clients generate their own UUIDs (offline-first); the default is a fallback.
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  author text,
  genre text,
  page_count integer,
  -- Storage object path inside the private "book-covers" bucket: {user_id}/{book_id}.jpg
  cover_path text,
  cover_source text,
  reading_status text not null default 'to_read',
  current_page integer not null default 0,
  rating smallint,
  notes text,
  lent_to text,
  lent_at timestamptz,
  status_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Soft delete so deletions can sync to other devices.
  deleted_at timestamptz,
  -- Target of the composite foreign key from recommendations (same owner only).
  constraint user_books_id_user_id_key unique (id, user_id),
  constraint user_books_title_not_blank check (char_length(btrim(title)) > 0),
  constraint user_books_page_count_positive check (page_count is null or page_count > 0),
  constraint user_books_cover_source_check check (
    cover_source is null or cover_source in ('camera', 'gallery')
  ),
  constraint user_books_cover_path_owner check (
    cover_path is null or cover_path like (user_id::text || '/%')
  ),
  constraint user_books_reading_status_check check (
    reading_status in ('to_read', 'reading', 'finished')
  ),
  constraint user_books_current_page_range check (
    current_page >= 0 and (page_count is null or current_page <= page_count)
  ),
  constraint user_books_rating_range check (rating is null or rating between 1 and 5),
  constraint user_books_loan_consistency check (
    (lent_to is null and lent_at is null)
    or (lent_to is not null and lent_at is not null and char_length(btrim(lent_to)) > 0)
  )
);

create table if not exists public.recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  user_book_id uuid not null,
  rationale text not null,
  request_context jsonb not null default '{}'::jsonb,
  disposition text not null default 'suggested',
  created_at timestamptz not null default now(),
  -- Composite key: a recommendation can only point to a book of the same user.
  constraint recommendations_user_book_fkey foreign key (user_book_id, user_id)
    references public.user_books (id, user_id) on delete cascade,
  constraint recommendations_disposition_check check (
    disposition in ('suggested', 'viewed', 'read_later', 'skipped')
  ),
  constraint recommendations_context_is_object check (jsonb_typeof(request_context) = 'object')
);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_updated_at on public.profiles;
create trigger set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.reading_preferences;
create trigger set_updated_at
  before update on public.reading_preferences
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.user_books;
create trigger set_updated_at
  before update on public.user_books
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- New user bootstrap: profile + default reading preferences
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
    left(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), 80)
  )
  on conflict (id) do nothing;

  insert into public.reading_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index if not exists user_books_user_id_updated_at_idx
  on public.user_books (user_id, updated_at);

create index if not exists user_books_user_id_reading_status_idx
  on public.user_books (user_id, reading_status)
  where deleted_at is null;

create index if not exists recommendations_user_id_created_at_idx
  on public.recommendations (user_id, created_at desc);

-- Supports the cascade from user_books and lookups by book.
create index if not exists recommendations_user_book_id_idx
  on public.recommendations (user_book_id, user_id);

-- ---------------------------------------------------------------------------
-- Privileges: no access for anon; authenticated gets only row-level DML.
-- (Revoking ALL also removes TRUNCATE, which RLS does not cover.)
-- ---------------------------------------------------------------------------

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.reading_preferences from anon, authenticated;
revoke all on table public.user_books from anon, authenticated;
revoke all on table public.recommendations from anon, authenticated;

grant select, insert, update, delete on table public.profiles to authenticated;
grant select, insert, update, delete on table public.reading_preferences to authenticated;
grant select, insert, update, delete on table public.user_books to authenticated;
grant select, insert, update, delete on table public.recommendations to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- (select auth.uid()) is evaluated once per statement instead of once per row.
-- WITH CHECK on insert/update prevents moving a row to another owner.
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.reading_preferences enable row level security;
alter table public.user_books enable row level security;
alter table public.recommendations enable row level security;

-- profiles (owner column: id)
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists profiles_delete_own on public.profiles;
create policy profiles_delete_own on public.profiles
  for delete to authenticated
  using ((select auth.uid()) = id);

-- reading_preferences (owner column: user_id)
drop policy if exists reading_preferences_select_own on public.reading_preferences;
create policy reading_preferences_select_own on public.reading_preferences
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists reading_preferences_insert_own on public.reading_preferences;
create policy reading_preferences_insert_own on public.reading_preferences
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists reading_preferences_update_own on public.reading_preferences;
create policy reading_preferences_update_own on public.reading_preferences
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists reading_preferences_delete_own on public.reading_preferences;
create policy reading_preferences_delete_own on public.reading_preferences
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- user_books (owner column: user_id)
drop policy if exists user_books_select_own on public.user_books;
create policy user_books_select_own on public.user_books
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists user_books_insert_own on public.user_books;
create policy user_books_insert_own on public.user_books
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists user_books_update_own on public.user_books;
create policy user_books_update_own on public.user_books
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists user_books_delete_own on public.user_books;
create policy user_books_delete_own on public.user_books
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- recommendations (owner column: user_id)
drop policy if exists recommendations_select_own on public.recommendations;
create policy recommendations_select_own on public.recommendations
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists recommendations_insert_own on public.recommendations;
create policy recommendations_insert_own on public.recommendations
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists recommendations_update_own on public.recommendations;
create policy recommendations_update_own on public.recommendations
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists recommendations_delete_own on public.recommendations;
create policy recommendations_delete_own on public.recommendations
  for delete to authenticated
  using ((select auth.uid()) = user_id);
