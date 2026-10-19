// Scans the repository for secrets. Never reads `.env` or any `.env.*` file except the
// `.env.example` files (variable names only).
//
// - App code and config (what ships in the bundle) must not even name server-only keys.
// - An OpenAI-style key (sk-...) is forbidden everywhere, including docs and supabase/.
// - The name OPENAI_API_KEY is forbidden everywhere except three exact, value-free forms:
//   the variable name in supabase/functions/.env.example, the Deno.env read in an Edge
//   Function entry point, and the `OPENAI_API_KEY=<placeholder>` setup command in docs/README.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SELF = 'scripts/checkSecrets.mjs';
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.expo',
  'dist',
  'web-build',
  'coverage',
  '.claude',
  '.vscode',
  'android',
  'ios',
]);
/** Supabase CLI cache (project ref, versions); written by `supabase link`. */
const SKIP_PATHS = new Set(['supabase/.temp']);

/** Code and config that end up in the app. */
const APP_PATHS = ['src/', 'app.json', 'package.json', '.env.example'];

const APP_RULES = [
  { id: 'supabase-secret-key-name', pattern: /SUPABASE_SECRET_KEY/ },
  { id: 'service-role', pattern: /service_role/i },
  { id: 'public-env-secret-name', pattern: /EXPO_PUBLIC_[A-Z0-9_]*(SECRET|SERVICE_ROLE|OPENAI)/ },
];

const GLOBAL_RULES = [
  { id: 'openai-style-secret', pattern: /\bsk-[A-Za-z0-9_-]{16,}/ },
  { id: 'supabase-secret-literal', pattern: /sb_secret_[A-Za-z0-9_-]+/ },
  // Legacy anon/service_role keys and session tokens are JWTs: header.payload.signature.
  { id: 'jwt-literal', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/ },
  { id: 'supabase-access-token', pattern: /\bsbp_[A-Za-z0-9]{20,}/ },
  { id: 'private-key-block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

const OPENAI_KEY_NAME = /OPENAI_API_KEY/g;

/** Value-free uses of the OpenAI key name that are allowed, by file. */
function isAllowedKeyNameLine(file, line) {
  if (file === 'supabase/functions/.env.example') return line.trim() === 'OPENAI_API_KEY=';
  if (/^supabase\/functions\/[^/_][^/]*\/index\.ts$/.test(file)) {
    return line.replace(/Deno\.env\.get\('OPENAI_API_KEY'\)/g, '').search(OPENAI_KEY_NAME) < 0;
  }
  if (/^docs\/[^/]+\.md$/.test(file) || file === 'README.md') {
    // Only as a setup placeholder, e.g. OPENAI_API_KEY=<tu-clave>.
    return line.replace(/OPENAI_API_KEY=<[^<>\s]+>/g, '').search(OPENAI_KEY_NAME) < 0;
  }
  return false;
}

function isForbiddenEnvFile(filePath) {
  const name = basename(filePath);
  return name.startsWith('.env') && name !== '.env.example';
}

const toRepoPath = (path) => relative(ROOT, path).split('\\').join('/');

function collectFiles(path, files) {
  if (!existsSync(path) || isForbiddenEnvFile(path)) return;
  const repoPath = toRepoPath(path);
  if (SKIP_PATHS.has(repoPath) || repoPath === SELF) return;
  const stats = statSync(path);
  if (stats.isDirectory()) {
    if (SKIP_DIRS.has(basename(path))) return;
    for (const entry of readdirSync(path)) collectFiles(join(path, entry), files);
  } else if (stats.isFile()) {
    files.push(path);
  }
}

function maskMatch(value) {
  return `${value.slice(0, 4)}***`;
}

const files = [];
collectFiles(ROOT, files);

const findings = [];
for (const path of files) {
  const buffer = readFileSync(path);
  if (buffer.includes(0)) continue; // binary file
  const file = toRepoPath(path);
  const isApp = APP_PATHS.some((prefix) => file === prefix || file.startsWith(prefix));
  const rules = isApp ? [...APP_RULES, ...GLOBAL_RULES] : GLOBAL_RULES;
  buffer
    .toString('utf8')
    .split(/\r?\n/)
    .forEach((line, index) => {
      const report = (rule, match) =>
        findings.push({ file, line: index + 1, rule, preview: maskMatch(match) });
      for (const rule of rules) {
        const match = line.match(rule.pattern);
        if (match) report(rule.id, match[0]);
      }
      if (line.search(OPENAI_KEY_NAME) >= 0 && !isAllowedKeyNameLine(file, line)) {
        report('openai-api-key-name', 'OPENAI_API_KEY');
      }
    });
}

if (findings.length > 0) {
  console.error(`checkSecrets: ${findings.length} potential secret(s) found:`);
  for (const f of findings) console.error(`  ${f.file}:${f.line}  [${f.rule}]  ${f.preview}`);
  process.exit(1);
}

console.log(`checkSecrets: OK (${files.length} files scanned)`);
