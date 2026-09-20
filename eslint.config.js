import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * One flat config for the whole workspace.
 *
 * Beyond the usual correctness rules, this encodes the two architectural
 * boundaries the README describes, so they are enforced rather than merely
 * documented: the server's layering, and the rule that frontend features never
 * import from one another.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
      'packages/shared/dist/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        // Resolves each file to its own tsconfig, which a workspace needs.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { 'import-x': importX },
    rules: {
      // Unused arguments prefixed with _ are a deliberate signal, not an oversight.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // Floating promises are how background work silently disappears; this is
      // the single most valuable rule in a codebase with timers and workers.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { arguments: false, attributes: false } },
      ],
      eqeqeq: ['error', 'smart'],
      'no-console': ['error', { allow: ['error'] }],
      'prefer-const': 'error',
      'object-shorthand': 'error',
    },
  },

  // ---------------------------------------------------------------- server
  {
    files: ['server/**/*.ts', 'packages/shared/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: [
            // Repositories know about SQL and nothing else.
            { target: './server/src/repositories', from: './server/src/services' },
            { target: './server/src/repositories', from: './server/src/controllers' },
            { target: './server/src/repositories', from: './server/src/routes' },
            { target: './server/src/repositories', from: './server/src/middlewares' },
            { target: './server/src/repositories', from: './server/src/engine' },

            // Services hold business logic and must not reach back up to HTTP.
            { target: './server/src/services', from: './server/src/controllers' },
            { target: './server/src/services', from: './server/src/routes' },
            { target: './server/src/services', from: './server/src/middlewares' },

            // The execution engine runs in a process with no HTTP server at all.
            { target: './server/src/engine', from: './server/src/controllers' },
            { target: './server/src/engine', from: './server/src/routes' },
            { target: './server/src/engine', from: './server/src/middlewares' },
          ],
        },
      ],
    },
  },
  {
    // The worker container has no Express in it. Importing it here would compile
    // and then be wrong, so the boundary is worth stating out loud.
    files: [
      'server/src/services/**/*.ts',
      'server/src/repositories/**/*.ts',
      'server/src/engine/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'express',
              message:
                'Layers below the controllers must not know about HTTP. Take the values you need as arguments.',
            },
          ],
        },
      ],
    },
  },
  {
    // The migrator reads arbitrary rows back from information_schema, and the
    // config loader has to report a bad environment before the logger exists.
    files: ['server/src/lib/migrator.ts', 'server/src/config/env.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      'no-console': 'off',
    },
  },
  {
    files: ['server/tests/**/*.ts'],
    rules: {
      // Test fakes are cast into place deliberately.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // ------------------------------------------------------------------- web
  {
    files: ['web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: [
            // Features are composed at the app layer, never wired to each other.
            {
              target: './web/src/features/tasks',
              from: './web/src/features',
              except: ['./tasks'],
            },
            {
              target: './web/src/features/analytics',
              from: './web/src/features',
              except: ['./analytics'],
            },
            {
              target: './web/src/features/workers',
              from: './web/src/features',
              except: ['./workers'],
            },
            // Shared components stay shared: anything depending on a feature is
            // not shared, it is part of that feature.
            { target: './web/src/components', from: './web/src/features' },
          ],
        },
      ],
    },
  },

  // Config files run in Node and sit outside the app's tsconfigs.
  {
    files: ['*.config.{js,ts}', '**/*.config.{js,ts}', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
    ...tseslint.configs.disableTypeChecked,
  },

  // Must stay last: turns off everything that fights with the formatter.
  prettier,
);
