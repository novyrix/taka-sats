// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Conventional Commits, enforced by the `commit-msg` hook and in CI
 * (Code Style Guide §11). Types are the standard set the guide names.
 */
const config = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'refactor', 'test', 'docs', 'chore', 'build', 'ci', 'perf', 'revert'],
    ],
    'body-max-line-length': [1, 'always', 100],
  },
};

export default config;
