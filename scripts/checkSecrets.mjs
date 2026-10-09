// Scans app code and config for secrets that must never ship in the client bundle.
// Never reads `.env` or any `.env.*` file except `.env.example`.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TARGETS = ['src', 'app.json', 'package.json', '.env.example'];
const SKIP_DIRS = new Set(['node_modules', '.expo', 'dist', 'coverage']);

const RULES = [
  { id: 'supabase-secret-key-name', pattern: /SUPABASE_SECRET_KEY/ },
  { id: 'service-role', pattern: /service_role/i },
  { id: 'openai-api-key-name', pattern: /OPENAI_API_KEY/ },
  { id: 'openai-style-secret', pattern: /sk-[A-Za-z0-9]{20,}/ },
  { id: 'supabase-secret-literal', pattern: /sb_secret_/ },
  { id: 'public-env-secret-name', pattern: /EXPO_PUBLIC_[A-Z0-9_]*(SECRET|SERVICE_ROLE|OPENAI)/ },
];

function isForbiddenEnvFile(filePath) {
  const name = basename(filePath);
  return name.startsWith('.env') && name !== '.env.example';
}

function collectFiles(path, files) {
  if (!existsSync(path) || isForbiddenEnvFile(path)) return;
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
for (const target of TARGETS) collectFiles(join(ROOT, target), files);

const findings = [];
for (const file of files) {
  const buffer = readFileSync(file);
  if (buffer.includes(0)) continue; // binary file
  const lines = buffer.toString('utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const rule of RULES) {
      const match = line.match(rule.pattern);
      if (match) {
        findings.push({
          file: relative(ROOT, file).split('\\').join('/'),
          line: index + 1,
          rule: rule.id,
          preview: maskMatch(match[0]),
        });
      }
    }
  });
}

if (findings.length > 0) {
  console.error(`checkSecrets: ${findings.length} potential secret(s) found:`);
  for (const f of findings) console.error(`  ${f.file}:${f.line}  [${f.rule}]  ${f.preview}`);
  process.exit(1);
}

console.log(`checkSecrets: OK (${files.length} files scanned)`);
