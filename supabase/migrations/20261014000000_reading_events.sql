-- Bookshelf: reading log (daily reading statistics).
-- Run manually in the Supabase SQL Editor after the previous migrations. Idempotent.
--
-- Append-only: one row per change of a book's current page, created by the app (client UUID).
-- pages_delta is signed (going back is a correction). local_date is the device's calendar date
-- when the change happened; it is stored, never recomputed, so time zone or daylight saving
-- changes do not move past reading to another day.
-- Users can only read and insert their own rows: there are no update or delete policies.

create table if not exists public.reading_events (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_id uuid not null,
  pages_delta integer not null,
  local_date date not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  -- Composite key: an event can only point to a book of the same user.
  constraint reading_events_user_book_fkey foreign key (book_id, user_id)
    references public.user_books (id, user_id) on delete cascade,
  constraint reading_events_pages_delta_check check (
    pages_delta <> 0 and pages_delta between -100000 and 100000
  )
);

-- Incremental pull (by created_at) and per-day sums.
create index if not exists reading_events_user_local_date_idx
  on public.reading_events (user_id, local_date);
create index if not exists reading_events_user_created_idx
  on public.reading_events (user_id, created_at);
create index if not exists reading_events_book_idx
  on public.reading_events (book_id, user_id);

-- created_at is the server's insert time (the sync cursor), whatever the client sends.
create or replace function public.reading_events_set_created_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists set_created_at on public.reading_events;
create trigger set_created_at
  before insert on public.reading_events
  for each row execute function public.reading_events_set_created_at();

revoke all on table public.reading_events from anon, authenticated;
grant select, insert on table public.reading_events to authenticated;

alter table public.reading_events enable row level security;

drop policy if exists reading_events_select_own on public.reading_events;
create policy reading_events_select_own on public.reading_events
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists reading_events_insert_own on public.reading_events;
create policy reading_events_insert_own on public.reading_events
  for insert to authenticated
  with check ((select auth.uid()) = user_id);
