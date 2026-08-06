import js from '@eslint/js';
import ts from 'typescript-eslint';
import a11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Architectural rules are lint rules.
 *
 * A rule in a document is advisory. A rule in CI is enforced. This
 * matters more than usual on this project because much of the code will
 * be written with AI assistance, and a model does not remember the code
 * review from three weeks ago.
 */
export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    plugins: { 'jsx-a11y': a11y, 'react-hooks': reactHooks },
    rules: {
      /* ── ARCHITECTURE ────────────────────────────────────────
         The Data Access Layer cannot be bypassed. Only @esoko/db
         may touch Prisma; everyone else goes through the DAL, where
         requireCapability() runs before any query.               */
      'no-restricted-imports': ['error', {
        paths: [
          {
            name: '@prisma/client',
            message:
              'Do not import Prisma directly. Use @esoko/db/dal — every query must pass ' +
              'through the Data Access Layer so authorisation is checked. See ADR-0003.',
          },
          {
            name: '@esoko/db',
            importNames: ['prisma'],
            message: 'The Prisma client is internal to @esoko/db. Import a DAL function instead.',
          },
        ],
        patterns: [
          {
            group: ['**/packages/db/src/client*'],
            message: 'Reach the database through @esoko/db/dal only.',
          },
        ],
      }],

      /* ── ACCESSIBILITY — blocking, not advisory ────────────── */
      ...a11y.flatConfigs.recommended.rules,
      'jsx-a11y/no-autofocus': 'error',
      'jsx-a11y/anchor-is-valid': 'error',
      'jsx-a11y/label-has-associated-control': 'error',
      'jsx-a11y/media-has-caption': 'error',

      /* ── REACT HOOKS ──────────────────────────────────────── */
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',

      /* ── TYPE SAFETY ──────────────────────────────────────── */
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'warn',

      /* ── MONEY ────────────────────────────────────────────── */
      'no-restricted-syntax': ['error', {
        selector: "CallExpression[callee.object.name='Number'][callee.property.name='parseFloat']",
        message: 'Never parse money as a float. Use Prisma Decimal or a string.',
      }],
    },
  },
  {
    // The DAL itself is allowed to import Prisma. Nothing else is.
    files: ['packages/db/src/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/target/**'] },
);
