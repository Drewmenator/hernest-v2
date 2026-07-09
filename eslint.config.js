import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // firebase-admin is server-only (Vercel functions). Importing it in
      // client code would bundle a 50MB SDK and leak credential handling.
      'no-restricted-imports': ['error', {
        paths: [{ name: 'firebase-admin', message: 'Server-only — use it in api/ functions, never in src/.' }],
        patterns: [{ group: ['firebase-admin/*'], message: 'Server-only — use it in api/ functions, never in src/.' }],
      }],
    },
  },
])
