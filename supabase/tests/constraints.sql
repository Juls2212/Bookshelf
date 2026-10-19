-- Bookshelf: input constraints test (20261015000000_input_constraints.sql). Paste the whole file
-- into the Supabase SQL Editor and run it. It creates a temporary user inside a transaction,
-- checks that every out-of-range value is rejected and every value at the limit is accepted, and
-- ROLLS BACK everything at the end. Nothing is left in the database.
-- Expected result: a single row "Input constraints test passed" (and a NOTICE with the same text).
--
-- Needs every migration in supabase/migrations applied, in order.
--
-- Fixed test ids (only exist inside this transaction):
--   user  33333333-3333-4333-8333-333333333333
--   book  99999999-9999-4999-8999-999999999999

begin;

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '33333333-3333-4333-8333-333333333333',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'constraints-test@example.test',
  '{"provider":"email","providers":["email"]}',
  -- 80 characters: the sign-up trigger must cut it to 50, not fail.
  jsonb_build_object('display_name', repeat('n', 80)),
  now(),
  now()
);

do $$
declare
  uid constant uuid := '33333333-3333-4333-8333-333333333333';
  bid constant uuid := '99999999-9999-4999-8999-999999999999';
  stored int;
begin
  -- Sign-up trigger: a long metadata name is truncated.
  select char_length(display_name) into stored from public.profiles where id = uid;
  if stored is distinct from 50 then
    raise exception 'FAIL [trigger]: display_name should be cut to 50, got %', stored;
  end if;

  -- Values exactly at every limit are accepted.
  insert into public.user_books (
    id, user_id, title, author, genre, notes, page_count, current_page, lent_to, lent_at
  )
  values (
    bid, uid, repeat('t', 200), repeat('a', 120), repeat('g', 60), repeat('n', 2000),
    10000, 10000, repeat('l', 80), now()
  );
  update public.profiles set display_name = repeat('d', 50) where id = uid;
end;
$$;

-- Each case must raise a check violation. `bad` runs the statement and fails the test if it
-- is accepted.
create or replace function pg_temp.expect_rejected(label text, statement text)
returns void
language plpgsql
as $$
begin
  execute statement;
  raise exception 'FAIL [%]: the statement was accepted', label;
exception
  when check_violation then
    null;
end;
$$;

do $$
declare
  uid constant text := '33333333-3333-4333-8333-333333333333';
  bid constant text := '99999999-9999-4999-8999-999999999999';
  base constant text :=
    'update public.user_books set ';
  suffix constant text := ' where id = ' || quote_literal(bid);
begin
  perform pg_temp.expect_rejected('title 201',
    base || 'title = repeat(''t'', 201)' || suffix);
  perform pg_temp.expect_rejected('title blank',
    base || 'title = ''   ''' || suffix);
  perform pg_temp.expect_rejected('author 121',
    base || 'author = repeat(''a'', 121)' || suffix);
  perform pg_temp.expect_rejected('genre 61',
    base || 'genre = repeat(''g'', 61)' || suffix);
  perform pg_temp.expect_rejected('notes 2001',
    base || 'notes = repeat(''n'', 2001)' || suffix);
  perform pg_temp.expect_rejected('lent_to 81',
    base || 'lent_to = repeat(''l'', 81)' || suffix);
  perform pg_temp.expect_rejected('page_count 0',
    base || 'page_count = 0' || suffix);
  perform pg_temp.expect_rejected('page_count 10001',
    base || 'page_count = 10001' || suffix);
  perform pg_temp.expect_rejected('current_page -1',
    base || 'current_page = -1' || suffix);
  perform pg_temp.expect_rejected('current_page above page_count',
    base || 'page_count = 300, current_page = 301' || suffix);
  perform pg_temp.expect_rejected('current_page 10001 without page_count',
    base || 'page_count = null, current_page = 10001' || suffix);
  perform pg_temp.expect_rejected('display_name 51',
    'update public.profiles set display_name = repeat(''d'', 51) where id = '
    || quote_literal(uid));
  perform pg_temp.expect_rejected('insert title 201',
    'insert into public.user_books (user_id, title, page_count) values ('
    || quote_literal(uid) || ', repeat(''t'', 201), 10)');
end;
$$;

-- Characters are counted as code points, not bytes: 200 four-byte emoji are accepted.
do $$
begin
  update public.user_books
    set title = repeat(chr(128218), 200)
    where id = '99999999-9999-4999-8999-999999999999';
end;
$$;

do $$
begin
  raise notice 'Input constraints test passed';
end;
$$;

select 'Input constraints test passed' as result;

rollback;
