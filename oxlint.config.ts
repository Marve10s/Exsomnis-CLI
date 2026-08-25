import { defineConfig } from 'oxlint';

export default defineConfig({
  plugins: ['eslint', 'typescript', 'unicorn', 'oxc', 'import', 'promise'],
  jsPlugins: [
    '@exsomnis/oxlint-plugins/require-disable-description',
    '@exsomnis/oxlint-plugins/forbidden-unknown-cast',
    '@exsomnis/oxlint-plugins/prefer-effect',
  ],
  env: {
    builtin: true,
  },
  categories: {
    correctness: 'error',
    suspicious: 'error',
    perf: 'error',
  },
  ignorePatterns: [
    'node_modules/**',
    'target/**',
    'dist/**',
    'crates/*/index.js',
    'crates/*/index.d.ts',
  ],
  rules: {
    'no-console': 'error',
    'disable-comments/require-description': 'error',
    'unknown-cast/forbidden': 'error',
    'prefer-effect/no-node-path': 'error',
    'prefer-effect/no-node-fs': 'error',
    'typescript/consistent-return': 'off',
    'typescript/explicit-function-return-type': 'off',
    'typescript/explicit-module-boundary-types': 'off',
    'typescript/consistent-type-definitions': 'off',
    'typescript/no-empty-object-type': 'off',
    'typescript/array-type': 'off',
    'unicorn/no-array-callback-reference': 'off',
    'unicorn/no-array-method-this-argument': 'off',
    'import/no-default-export': 'off',
  },
});
