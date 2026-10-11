-- Bookshelf: private bucket for book covers.
-- Run manually in the Supabase SQL Editor after the initial schema. Idempotent.
-- Object path convention: {user_id}/{book_id}.jpg
-- Each user can only touch objects inside the folder named after their auth.uid().

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'book-covers',
  'book-covers',
  false,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists book_covers_select_own on storage.objects;
create policy book_covers_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'book-covers'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists book_covers_insert_own on storage.objects;
create policy book_covers_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'book-covers'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists book_covers_update_own on storage.objects;
create policy book_covers_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'book-covers'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'book-covers'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists book_covers_delete_own on storage.objects;
create policy book_covers_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'book-covers'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
