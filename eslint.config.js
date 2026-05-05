'use strict';

/**
 * ESLint flat config (v9+). Targets Node CommonJS for server-side files
 * and browser globals for public/*.js. Tests use Node's built-in node:test.
 *
 * Philosophy: catch real bugs (undefined vars, unused imports, accidental
 * globals) without nitpicking style — Prettier owns formatting.
 */

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  // Baseline — applies to all JS files
  js.configs.recommended,

  // Project-wide rules
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
    },
    rules: {
      // Style is Prettier's job; we keep ESLint focused on correctness.
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off', // server.js logs to console intentionally
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'warn',
      'no-var': 'error',
      'no-prototype-builtins': 'off',
    },
  },

  // Server-side (Node) — server.js, db.js, auth.js, validator/**
  {
    files: [
      'server.js',
      'db.js',
      'auth.js',
      'tokens.js',
      'email.js',
      'validator/**/*.js',
      'scripts/**/*.js',
      'samples/**/*.js',
    ],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // Tests — Node + node:test
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // Browser-side (UI)
  {
    files: ['public/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      // The UI uses inline onclick handlers that reference globals attached
      // via window.foo = … — don't flag those as undefined.
      'no-undef': 'off',
    },
  },

  // Don't lint vendored / generated assets
  {
    ignores: ['node_modules/', 'public/design-system.css', '*.min.js', 'dist/', 'build/'],
  },
];
