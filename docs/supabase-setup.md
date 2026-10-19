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
3. `supabase/migrations/20261011000000_ai_usage.sql` and
   `supabase/migrations/20261012000000_discovery_recommendations.sql` (see `docs/ai-setup.md`).
4. `supabase/migrations/20261013000000_profile_avatars.sql`
   Profile photo columns (`avatar_path`, `avatar_updated_at`) and the private bucket `avatars`
   (2 MB; JPEG, PNG, WebP) with its storage policies. Object path: `{user_id}/avatar.jpg`.
5. `supabase/migrations/20261014000000_reading_events.sql`
   Append-only reading log `reading_events` (select and insert of own rows only; no update or
   delete), used for the daily reading statistics.
6. `supabase/migrations/20261015000000_input_constraints.sql` (phase 10.1)
   Server-side limits (CHECK constraints) for user-typed text and page numbers. It first cuts
   any existing value that is too long, then drops and re-adds each constraint, so it is safe to
   re-run. Limits (characters): `user_books` title 200, author 120, genre 60, notes 2000,
   `lent_to` 80, `page_count` 1-10000, `current_page` 0-10000 (and never above `page_count`);
   `profiles.display_name` 50. It also updates `handle_new_user` to cut the sign-up name to 50.
   The same numbers live in `src/lib/inputLimits.ts`.

After running them, check **Database → Tables**: every table must show "RLS enabled".

## 2. Run the RLS isolation test

1. Open `supabase/tests/rls_isolation.sql`, paste the whole file into a new SQL Editor query
   and run it.
2. Expected result: one row `RLS isolation test passed`. Any failure stops the script with an
   error that starts with `FAIL [...]` and says which check broke.
3. The script runs inside a transaction and ends with `ROLLBACK`: the two temporary users
   and their rows are never saved.

Run it again after any change to tables or policies.

Then run `supabase/tests/constraints.sql` the same way. Expected result: one row
`Input constraints test passed`. It checks that every limit of migration 6 rejects the value
just over it (and accepts the value at the limit), and also ends with `ROLLBACK`.

## 3. Dashboard checklist (Authentication)

- **Sign In / Providers → Email**: enabled.
- **Confirm email**: **disable it** (Authentication → Sign In / Providers → Email → turn off
  "Confirm email"). The app has no verification-code step: after sign-up the user goes straight
  into the app. If you leave it on, sign-up still works, but Supabase returns no session and the
  app shows "Confirma tu correo" and sends the user back to log in once the link is opened.
- **Minimum password length**: 8 (the app also caps passwords at 72 characters, the most bcrypt
  uses).
- **URL Configuration → Site URL**: the default `http://localhost:3000` is fine for now. It
  is only used in links inside auth emails; update it when deep links or a web page exist.
- **Email rate limits**: the built-in email service only sends a few emails per hour and is
  meant for testing. With **Confirm email** off, sign-up sends no email; password recovery
  still does, so configure a custom SMTP provider before real users arrive.

## Keys

The app only uses `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
Never put a secret key, database password or any other private credential in the app or in
this repository.

## Limitación conocida: recuperar la contraseña

«¿Olvidaste tu contraseña?» llama a `resetPasswordForEmail`, y Supabase envía un correo de
recuperación a esa dirección. **La app todavía no puede completar el cambio**: el enlace del correo
no abre una pantalla de Bookshelf para escribir la contraseña nueva (no hay enlace profundo ni
página web de restablecimiento configurados). Los textos de la app lo dicen tal cual y no
prometen un restablecimiento dentro de la app.

Mientras tanto, si alguien necesita cambiar su contraseña, puede hacerse desde el panel de
Supabase (**Authentication → Users → Send password recovery** o cambiando la contraseña del
usuario), o añadiendo más adelante una URL de redirección y una pantalla de restablecimiento.
