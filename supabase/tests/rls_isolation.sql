-- Bookshelf: RLS isolation test. Paste the whole file into the Supabase SQL Editor and run it.
-- It creates two temporary users inside a transaction, impersonates them with
-- `set local role` + JWT claims, raises an exception on the first failure and ROLLS BACK
-- everything at the end. Nothing is left in the database.
-- Expected result: a single row "RLS isolation test passed" (and a NOTICE with the same text).
--
-- Fixed test ids (only exist inside this transaction):
--   user A  11111111-1111-4111-8111-111111111111
--   user B  22222222-2222-4222-8222-222222222222
--   book A  aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa
--   book B  bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb
--   rec A   cccccccc-cccc-4ccc-8ccc-cccccccccccc

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

insert into public.recommendations (id, user_book_id, rationale)
values (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'RLS test rationale'
);

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
begin
  -- Visibility
  select count(*) into n from public.user_books where user_id = a or id = book_a;
  if n <> 0 then raise exception 'FAIL [B]: can see A''s user_books'; end if;

  select count(*) into n from public.recommendations where user_id = a or id = rec_a;
  if n <> 0 then raise exception 'FAIL [B]: can see A''s recommendations'; end if;

  select count(*) into n from public.profiles where id = a;
  if n <> 0 then raise exception 'FAIL [B]: can see A''s profile'; end if;

  select count(*) into n from public.reading_preferences where user_id = a;
  if n <> 0 then raise exception 'FAIL [B]: can see A''s reading_preferences'; end if;

  -- Updates affect zero rows
  update public.user_books set title = 'hacked' where id = book_a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [B]: updated A''s book'; end if;

  update public.recommendations set disposition = 'skipped' where id = rec_a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [B]: updated A''s recommendation'; end if;

  update public.profiles set display_name = 'hacked' where id = a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [B]: updated A''s profile'; end if;

  update public.reading_preferences set consider_mood = false where user_id = a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [B]: updated A''s reading_preferences'; end if;

  -- Deletes affect zero rows
  delete from public.recommendations where id = rec_a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [B]: deleted A''s recommendation'; end if;

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
  foreach tbl in array array['profiles', 'reading_preferences', 'user_books', 'recommendations']
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
