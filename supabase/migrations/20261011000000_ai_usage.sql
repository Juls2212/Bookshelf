-- Bookshelf: per-user usage log of AI Edge Functions (rate limiting).
-- Run manually in the Supabase SQL Editor. Idempotent: safe to re-run.
-- Only Edge Functions write and read it, with the service role. RLS is enabled with no
-- policies, so app users (anon / authenticated) can never see or change any row.

create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  function_name text not null,
  created_at timestamptz not null default now(),
  constraint ai_usage_function_name_not_blank check (char_length(btrim(function_name)) > 0)
);

-- Counting a user's recent calls of one function (last hour / last day).
create index if not exists ai_usage_user_function_created_idx
  on public.ai_usage (user_id, function_name, created_at);

alter table public.ai_usage enable row level security;

-- No policies on purpose, and no table privileges for client roles.
revoke all on table public.ai_usage from anon, authenticated;
-- The Edge Function (service role) only counts and inserts rows.
grant select, insert on table public.ai_usage to service_role;
