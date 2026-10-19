-- Bookshelf: RLS isolation test. Paste the whole file into the Supabase SQL Editor and run it.
-- It creates two temporary users inside a transaction, impersonates them with
-- `set local role` + JWT claims, raises an exception on the first failure and ROLLS BACK
-- everything at the end. Nothing is left in the database.
-- Expected result: a single row "RLS isolation test passed" (and a NOTICE with the same text).
--
-- Needs every migration in supabase/migrations applied, in order (initial schema, the
-- book-covers bucket, ai_usage, 20261012000000_discovery_recommendations.sql and
-- 20261013000000_profile_avatars.sql and 20261014000000_reading_events.sql).
--
-- Fixed test ids (only exist inside this transaction):
--   user A  11111111-1111-4111-8111-111111111111
--   user B  22222222-2222-4222-8222-222222222222
--   book A  aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa
--   book B  bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb
--   rec A   cccccccc-cccc-4ccc-8ccc-cccccccccccc  (shelf recommendation)
--   disc A  dddddddd-dddd-4ddd-8ddd-dddddddddddd  (discovery suggestion, user_book_id null)
--   cover A 11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg
--   avatar A 11111111-1111-4111-8111-111111111111/avatar.jpg  (bucket avatars)
--   event A eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee  (reading_events, book A)

begin;

-- ---------------------------------------------------------------------------
-- 0. Setup as the SQL Editor role: two temporary auth users.
-- ---------------------------------------------------------------------------
insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '11111111-1111-4111-8111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'rls-test-a@example.test',
    '{"provider":"email","providers":["email"]}',
    '{"display_name":"Reader A"}',
    now(),
    now()
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'rls-test-b@example.test',
    '{"provider":"email","providers":["email"]}',
    '{"display_name":"Reader B"}',
    now(),
    now()
  );

-- ---------------------------------------------------------------------------
-- 1. New-user trigger created profile and default preferences.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from public.profiles
    where id = '11111111-1111-4111-8111-111111111111' and display_name = 'Reader A'
  ) then
    raise exception 'FAIL [trigger]: profile for user A was not created';
  end if;
  if not exists (
    select 1 from public.profiles where id = '22222222-2222-4222-8222-222222222222'
  ) then
    raise exception 'FAIL [trigger]: profile for user B was not created';
  end if;
  if not exists (
    select 1 from public.reading_preferences
    where user_id = '11111111-1111-4111-8111-111111111111'
      and favorite_genres = '{}'
      and prioritize_unread and consider_mood and not prefer_short_weekdays
  ) then
    raise exception 'FAIL [trigger]: default reading_preferences for user A missing or wrong';
  end if;
  if not exists (
    select 1 from public.reading_preferences
    where user_id = '22222222-2222-4222-8222-222222222222'
  ) then
    raise exception 'FAIL [trigger]: reading_preferences for user B were not created';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. User A: insert and read own rows.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);

-- user_id comes from the auth.uid() default.
insert into public.user_books (id, title, page_count, reading_status, current_page)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'RLS test book A', 100, 'reading', 10);

-- Reading log: client id, user_id from the auth.uid() default.
insert into public.reading_events (id, book_id, pages_delta, local_date, occurred_at)
values (
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  10,
  '2026-10-14',
  '2026-10-14T09:00:00Z'
);

insert into public.recommendations (id, user_book_id, rationale)
values (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'RLS test rationale'
);

-- "Nuevas aventuras": a suggestion outside the shelf has no user_book_id.
insert into public.recommendations (
  id, kind, user_book_id, suggested_title, suggested_author, suggestion_verified, rationale
)
values (
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'discovery',
  null,
  'RLS test discovery',
  'RLS test author',
  false,
  'RLS test discovery rationale'
);

-- The covers bucket: A's own folder ({user_id}/{book_id}.jpg). The Storage API inserts the
-- same row under the same policies.
insert into storage.objects (bucket_id, name)
values (
  'book-covers',
  '11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg'
);

-- The avatars bucket: A's own folder ({user_id}/avatar.jpg).
insert into storage.objects (bucket_id, name)
values ('avatars', '11111111-1111-4111-8111-111111111111/avatar.jpg');

do $$
declare
  n integer;
begin
  select count(*) into n from public.user_books
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    and user_id = '11111111-1111-4111-8111-111111111111';
  if n <> 1 then raise exception 'FAIL [A]: cannot read own user_books row'; end if;

  select count(*) into n from public.recommendations
  where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  if n <> 1 then raise exception 'FAIL [A]: cannot read own recommendation'; end if;

  select count(*) into n from public.profiles;
  if n <> 1 then raise exception 'FAIL [A]: expected to see exactly 1 profile, saw %', n; end if;

  select count(*) into n from public.reading_preferences;
  if n <> 1 then
    raise exception 'FAIL [A]: expected to see exactly 1 reading_preferences row, saw %', n;
  end if;

  update public.user_books set current_page = 20
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [A]: cannot update own book'; end if;

  update public.profiles set theme = 'dark'
  where id = '11111111-1111-4111-8111-111111111111';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [A]: cannot update own profile'; end if;

  -- reading_events: own row readable; append-only (no update or delete, even for the owner).
  select count(*) into n from public.reading_events
  where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    and user_id = '11111111-1111-4111-8111-111111111111';
  if n <> 1 then raise exception 'FAIL [A]: cannot read own reading event'; end if;
  begin
    update public.reading_events set pages_delta = 99
    where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    raise exception 'FAIL [A]: updated a reading event';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.reading_events where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    raise exception 'FAIL [A]: deleted a reading event';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.reading_events (book_id, id, pages_delta, local_date, occurred_at)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', gen_random_uuid(), 0, '2026-10-14', now());
    raise exception 'FAIL [A]: inserted a reading event without pages';
  exception when check_violation then null;
  end;

  -- Avatar columns: A can set them on its own profile, only with its own path.
  update public.profiles
  set avatar_path = '11111111-1111-4111-8111-111111111111/avatar.jpg', avatar_updated_at = now()
  where id = '11111111-1111-4111-8111-111111111111';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [A]: cannot set own avatar columns'; end if;
  begin
    update public.profiles set avatar_path = '22222222-2222-4222-8222-222222222222/avatar.jpg'
    where id = '11111111-1111-4111-8111-111111111111';
    raise exception 'FAIL [A]: pointed its avatar at B''s folder';
  exception when check_violation then null;
  end;

  -- avatars bucket: own object visible; B's folder is off limits.
  select count(*) into n from storage.objects
  where bucket_id = 'avatars' and name = '11111111-1111-4111-8111-111111111111/avatar.jpg';
  if n <> 1 then raise exception 'FAIL [A]: cannot see own avatar object'; end if;
  begin
    insert into storage.objects (bucket_id, name)
    values ('avatars', '22222222-2222-4222-8222-222222222222/avatar.jpg');
    raise exception 'FAIL [A]: wrote into B''s avatar folder';
  exception when insufficient_privilege then null;
  end;

  -- reading_preferences: own row readable and editable.
  update public.reading_preferences
  set favorite_genres = array['novel', 'poetry'], consider_mood = false
  where user_id = '11111111-1111-4111-8111-111111111111';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [A]: cannot update own reading_preferences'; end if;

  -- recommendations: the shelf row and the discovery row (null book) are both A's.
  select count(*) into n from public.recommendations
  where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    and kind = 'discovery' and user_book_id is null;
  if n <> 1 then raise exception 'FAIL [A]: cannot read own discovery suggestion'; end if;

  update public.recommendations set disposition = 'read_later'
  where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [A]: cannot update own discovery suggestion'; end if;

  select count(*) into n from public.recommendations;
  if n <> 2 then raise exception 'FAIL [A]: expected 2 own recommendations, saw %', n; end if;

  -- The kind checks hold for A too (23514 = check violation).
  begin
    insert into public.recommendations (kind, user_book_id, rationale)
    values ('discovery', null, 'discovery without title');
    raise exception 'FAIL [A]: inserted a discovery suggestion without a title';
  exception when check_violation then null;
  end;
  begin
    insert into public.recommendations (kind, user_book_id, rationale)
    values ('shelf', null, 'shelf without book');
    raise exception 'FAIL [A]: inserted a shelf recommendation without a book';
  exception when check_violation then null;
  end;

  -- ai_usage: no access at all for users (only the Edge Functions' service role).
  begin
    perform 1 from public.ai_usage limit 1;
    raise exception 'FAIL [A]: can read ai_usage';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.ai_usage (user_id, function_name)
    values ('11111111-1111-4111-8111-111111111111', 'identify-book');
    raise exception 'FAIL [A]: can insert into ai_usage (could reset its own rate limit)';
  exception when insufficient_privilege then null;
  end;

  -- book-covers: own object visible; another user's folder is off limits.
  select count(*) into n from storage.objects
  where bucket_id = 'book-covers'
    and name = '11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg';
  if n <> 1 then raise exception 'FAIL [A]: cannot see own cover object'; end if;
  begin
    insert into storage.objects (bucket_id, name)
    values ('book-covers', '22222222-2222-4222-8222-222222222222/planted.jpg');
    raise exception 'FAIL [A]: wrote into B''s cover folder';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. User B: cannot see, change, delete or impersonate A's rows.
-- ---------------------------------------------------------------------------
select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',
  true
);

do $$
declare
  n integer;
  a constant uuid := '11111111-1111-4111-8111-111111111111';
  book_a constant uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  rec_a constant uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  disc_a constant uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  cover_a constant text :=
    '11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg';
  avatar_a constant text := '11111111-1111-4111-8111-111111111111/avatar.jpg';
  event_a constant uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
begin
  -- Visibility
  select count(*) into n from public.user_books where user_id = a or id = book_a;
  if n <> 0 then raise exception 'FAIL [B]: can see A''s user_books'; end if;

  select count(*) into n from public.recommendations
  where user_id = a or id in (rec_a, disc_a);
  if n <> 0 then raise exception 'FAIL [B]: can see A''s recommendations'; end if;

  select count(*) into n from public.recommendations where user_book_id is null;
  if n <> 0 then raise exception 'FAIL [B]: can see A''s discovery suggestions'; end if;

  select count(*) into n from storage.objects
  where bucket_id = 'book-covers' and (name = cover_a or name like a::text || '/%');
  if n <> 0 then raise exception 'FAIL [B]: can see A''s cover objects'; end if;

  select count(*) into n from storage.objects
  where bucket_id = 'avatars' and (name = avatar_a or name like a::text || '/%');
  if n <> 0 then raise exception 'FAIL [B]: can see A''s avatar'; end if;

  select count(*) into n from public.reading_events where user_id = a or id = event_a;
  if n <> 0 then raise exception 'FAIL [B]: can see A''s reading events'; end if;

  select count(*) into n from public.profiles where id = a;
  if n <> 0 then raise exception 'FAIL [B]: can see A''s profile'; end if;

  select count(*) into n from public.reading_preferences where user_id = a;
  if n <> 0 then raise exception 'FAIL [B]: can see A''s reading_preferences'; end if;

  -- Updates affect zero rows
  update public.user_books set title = 'hacked' where id = book_a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [B]: updated A''s book'; end if;

  update public.recommendations set disposition = 'skipped' where id in (rec_a, disc_a);
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [B]: updated A''s recommendations'; end if;

  update storage.objects set name = 'b-took-it.jpg'
  where bucket_id = 'book-covers' and name = cover_a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [B]: updated A''s cover object'; end if;

  update storage.objects set name = 'b-took-it.jpg'
  where bucket_id = 'avatars' and name = avatar_a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [B]: updated A''s avatar object'; end if;

  update public.profiles set avatar_path = null, avatar_updated_at = null where id = a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [B]: removed A''s avatar from the profile'; end if;

  update public.profiles set display_name = 'hacked' where id = a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [B]: updated A''s profile'; end if;

  update public.reading_preferences set consider_mood = false where user_id = a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [B]: updated A''s reading_preferences'; end if;

  -- Deletes affect zero rows
  delete from public.recommendations where id in (rec_a, disc_a);
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [B]: deleted A''s recommendations'; end if;

  -- Newer projects also block direct SQL deletes on storage.objects (protect_delete trigger,
  -- 42501); either way A's object must survive.
  begin
    delete from storage.objects where bucket_id = 'book-covers' and name = cover_a;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL [B]: deleted A''s cover object'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    delete from storage.objects where bucket_id = 'avatars' and name = avatar_a;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL [B]: deleted A''s avatar'; end if;
  exception when insufficient_privilege then null;
  end;

  begin
    insert into storage.objects (bucket_id, name) values ('avatars', avatar_a);
    raise exception 'FAIL [B]: wrote into A''s avatar folder';
  exception when insufficient_privilege or unique_violation then null;
  end;

  -- B can use its own avatar folder.
  insert into storage.objects (bucket_id, name)
  values ('avatars', '22222222-2222-4222-8222-222222222222/avatar.jpg');

  delete from public.user_books where id = book_a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [B]: deleted A''s book'; end if;

  delete from public.reading_preferences where user_id = a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [B]: deleted A''s reading_preferences'; end if;

  delete from public.profiles where id = a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [B]: deleted A''s profile'; end if;

  -- Inserts with A's user_id are rejected (42501 = RLS violation).
  begin
    insert into public.user_books (user_id, title) values (a, 'impersonated');
    raise exception 'FAIL [B]: inserted a book owned by A';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.recommendations (user_id, user_book_id, rationale)
    values (a, book_a, 'impersonated');
    raise exception 'FAIL [B]: inserted a recommendation owned by A';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.recommendations (user_id, kind, suggested_title, rationale)
    values (a, 'discovery', 'impersonated', 'impersonated');
    raise exception 'FAIL [B]: inserted a discovery suggestion owned by A';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into storage.objects (bucket_id, name) values ('book-covers', a::text || '/planted.jpg');
    raise exception 'FAIL [B]: wrote into A''s cover folder';
  exception when insufficient_privilege then null;
  end;

  begin
    perform 1 from public.ai_usage limit 1;
    raise exception 'FAIL [B]: can read ai_usage';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.profiles (id) values (a);
    raise exception 'FAIL [B]: inserted a profile for A';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.reading_preferences (user_id) values (a);
    raise exception 'FAIL [B]: inserted reading_preferences for A';
  exception when insufficient_privilege then null;
  end;

  -- B cannot attach its own recommendation to A's book (composite foreign key).
  begin
    insert into public.recommendations (user_book_id, rationale) values (book_a, 'cross-user');
    raise exception 'FAIL [B]: linked a recommendation to A''s book';
  exception when foreign_key_violation then null;
  end;

  -- B cannot move its own row to A.
  insert into public.user_books (id, title) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'RLS test book B');

  -- reading_events: B cannot write as A, log A's book, or change A's events.
  begin
    insert into public.reading_events (id, user_id, book_id, pages_delta, local_date, occurred_at)
    values (gen_random_uuid(), a, book_a, 5, '2026-10-14', now());
    raise exception 'FAIL [B]: inserted a reading event owned by A';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.reading_events (id, book_id, pages_delta, local_date, occurred_at)
    values (gen_random_uuid(), book_a, 5, '2026-10-14', now());
    raise exception 'FAIL [B]: logged reading on A''s book';
  exception when foreign_key_violation then null;
  end;
  begin
    update public.reading_events set pages_delta = 1 where id = event_a;
    raise exception 'FAIL [B]: updated A''s reading event';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.reading_events where id = event_a;
    raise exception 'FAIL [B]: deleted A''s reading event';
  exception when insufficient_privilege then null;
  end;
  -- B logs its own book.
  insert into public.reading_events (id, book_id, pages_delta, local_date, occurred_at)
  values (gen_random_uuid(), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 3, '2026-10-14', now());
  select count(*) into n from public.reading_events;
  if n <> 1 then raise exception 'FAIL [B]: expected to see only own reading event, saw %', n; end if;
  begin
    update public.user_books set user_id = a where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    raise exception 'FAIL [B]: moved own book to A';
  exception when insufficient_privilege then null;
  end;

  select count(*) into n from public.user_books;
  if n <> 1 then raise exception 'FAIL [B]: expected to see only own book, saw %', n; end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. anon: no access at all (table privileges revoked).
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'profiles', 'reading_preferences', 'user_books', 'recommendations', 'ai_usage',
    'reading_events'
  ]
  loop
    begin
      execute format('select 1 from public.%I limit 1', tbl);
      raise exception 'FAIL [anon]: can select from %', tbl;
    exception when insufficient_privilege then null;
    end;
  end loop;

  begin
    insert into public.user_books (user_id, title)
    values ('11111111-1111-4111-8111-111111111111', 'anon book');
    raise exception 'FAIL [anon]: can insert into user_books';
  exception when insufficient_privilege then null;
  end;

  -- The covers bucket is private: anon sees no objects (no policy for anon).
  if exists (select 1 from storage.objects where bucket_id = 'book-covers') then
    raise exception 'FAIL [anon]: can see objects in book-covers';
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'avatars') then
    raise exception 'FAIL [anon]: can see objects in avatars';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Done.
-- ---------------------------------------------------------------------------
reset role;

do $$
begin
  raise notice 'RLS isolation test passed';
end;
$$;

select 'RLS isolation test passed' as result;

rollback;
