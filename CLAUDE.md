# Bookshelf: rules for Claude Code
Stack: React Native + Expo SDK 57 + TypeScript (strict) + Expo Router + Supabase + expo-sqlite. OpenAI only via Supabase Edge Functions.

## Language
- Everything internal in English: files, folders, identifiers, types, DB names, comments, internal errors/codes, tests.
- Only user-facing text is Spanish (neutral): copy, accessibility labels, validation messages, empty states, toasts, AI recommendation content.
- All user-facing strings live in `src/i18n/es.ts` (English keys, Spanish values). Never hardcode Spanish elsewhere. Internal errors are English codes mapped to Spanish by the UI.

## Security
- The app only uses `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- Never add secret keys, service role keys or OpenAI keys to app code. Never read, print or commit `.env`.
- Every table uses RLS by auth.uid().

## Rules
- Do NOT run git commands. The owner manages the repository.
- Implement only what the prompt asks. No extra features or refactors.
- Use `npx expo install` for Expo-managed packages. Justify every new dependency in the report. No global installs.
- Scripts must work on Windows (no bash-only syntax).
- Run `npm run verify` (when it exists) before finishing.
- Never run `npm audit fix --force`.
- End every task with a short report in Spanish (max 12 lines): files changed, dependencies (with versions), commands and results, deviations, risks.

## Architecture
- Routes live in `src/app/` and stay thin. Code in `src/`: design, components, features, db, lib, i18n, stores, types.
- UI never calls Supabase or SQLite directly; it uses repositories/services.
- Reading status: `to_read` | `reading` | `finished`. Ids are client-generated UUIDs.
