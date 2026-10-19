// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier');

module.exports = defineConfig([
  expoConfig,
  prettierConfig,
  {
    ignores: ['dist/*', '.expo/*', 'coverage/*', 'node_modules/*'],
  },
  {
    // Deno entry points of Edge Functions: npm: imports and Deno globals (deployed with the
    // Supabase CLI). Their pure logic in supabase/functions/_shared is linted.
    ignores: ['supabase/functions/*/index.ts'],
  },
  {
    settings: {
      // Resolve the `@/` alias from tsconfig paths.
      'import/resolver': {
        typescript: { project: './tsconfig.json' },
        node: true,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'openai',
              message: 'OpenAI must only be called through Supabase Edge Functions.',
            },
          ],
          patterns: [
            {
              group: ['openai/*'],
              message: 'OpenAI must only be called through Supabase Edge Functions.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    rules: {
      'no-console': 'off',
    },
  },
]);
