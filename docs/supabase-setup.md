# Supabase setup

The app never runs SQL against the database. The owner runs these files manually in the
Supabase dashboard (**SQL Editor → New query → paste → Run**). All files are idempotent, so
re-running them is safe.

## 1. Run the migrations (in this order)

1. `supabase/migrations/20261010000000_initial_schema.sql`
   Tables `profiles`, `reading_preferences`, `user_books`, `recommendations`; the
   `set_updated_at` and `handle_new_user` triggers; indexes; grants; RLS policies.
2. `supabase/migrations/20261010000100_storage_covers.sql`
   Private bucket `book-covers` (5 MB; JPEG, PNG, WebP) and its storage policies.
   Object path convention: `{user_id}/{book_id}.jpg`.

After running them, check **Database → Tables**: every table must show "RLS enabled".

## 2. Run the RLS isolation test

1. Open `supabase/tests/rls_isolation.sql`, paste the whole file into a new SQL Editor query
   and run it.
2. Expected result: one row `RLS isolation test passed`. Any failure stops the script with an
   error that starts with `FAIL [...]` and says which check broke.
3. The script runs inside a transaction and ends with `ROLLBACK`: the two temporary users
   and their rows are never saved.

Run it again after any change to tables or policies.

## 3. Dashboard checklist (Authentication)

- **Sign In / Providers → Email**: enabled.
- **Confirm email**: off during development (users can sign in right after signing up).
  Turn it back on before a public release.
- **Minimum password length**: 8.
- **URL Configuration → Site URL**: the default `http://localhost:3000` is fine for now. It
  is only used in links inside auth emails; update it when deep links or a web page exist.
- **Email rate limits**: the built-in email service only sends a few emails per hour and is
  meant for testing. Expect "rate limit exceeded" errors if you sign up many test accounts
  with confirmation on; configure a custom SMTP provider before real users arrive.

## Keys

The app only uses `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
Never put a secret key, database password or any other private credential in the app or in
this repository.
