-- Bookshelf: profile photos (avatars).
-- Run manually in the Supabase SQL Editor after the previous migrations. Idempotent.
--
-- profiles gets the avatar's storage path and the moment the photo was last changed. The client
-- sets avatar_updated_at (other devices download the photo again when it is newer). The
-- existing grants (table-level select/insert/update to authenticated) and the
-- profiles_update_own policy (id = auth.uid()) already cover the new columns.
--
-- Private bucket "avatars": object path {user_id}/avatar.jpg. Each user can only read, write
-- and delete objects inside the folder named after their auth.uid() (same model as book-covers).

alter table public.profiles
  add column if not exists avatar_path text,
  add column if not exists avatar_updated_at timestamptz;

alter table public.profiles
  drop constraint if exists profiles_avatar_path_check;
alter table public.profiles
  add constraint profiles_avatar_path_check check (
    avatar_path is null
    or (char_length(avatar_path) <= 200 and avatar_path = id::text || '/avatar.jpg')
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  false,
  2097152, -- 2 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists avatars_select_own on storage.objects;
create policy avatars_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists avatars_insert_own on storage.objects;
create policy avatars_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists avatars_delete_own on storage.objects;
create policy avatars_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
