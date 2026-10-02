// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Receiver configuration, read from environment variables (systemd loads them from a private
 * env file). Nothing secret is ever written to a log. See ci/ci.env.example for every setting.
 */

import { join, resolve } from 'node:path';

const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;

const list = (value, fallback = []) =>
  value === undefined || value.trim() === ''
    ? fallback
    : value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

const flag = (value, fallback) =>
  value === undefined || value.trim() === ''
    ? fallback
    : ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());

function integer(name, value, fallback, min) {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new Error(`${name} must be an integer of at least ${min}`);
  }
  return parsed;
}

/** @param {Record<string, string | undefined>} env */
export function loadConfig(env, { requireSecret = true } = {}) {
  const errors = [];
  const repo = env.GITHUB_REPO?.trim() || 'novyrix/taka-sats';
  if (!REPO_PATTERN.test(repo)) errors.push('GITHUB_REPO must look like owner/name');
  if (requireSecret && !env.GITHUB_WEBHOOK_SECRET) {
    errors.push('GITHUB_WEBHOOK_SECRET is required (the shared secret set on the GitHub webhook)');
  }

  const stateRoot = env.CI_WORKDIR?.trim() || env.STATE_DIRECTORY?.trim() || './.ci-work';

  let telegram = null;
  if (env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_CHAT_ID) {
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
      errors.push('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set together');
    } else {
      telegram = {
        token: env.TELEGRAM_BOT_TOKEN,
        chatId: env.TELEGRAM_CHAT_ID,
        apiBase: (env.TELEGRAM_API_BASE?.trim() || 'https://api.telegram.org').replace(/\/+$/, ''),
      };
    }
  }

  let smtp = null;
  if (env.SMTP_URL || env.SMTP_FROM || env.SMTP_TO) {
    if (!env.SMTP_URL || !env.SMTP_FROM || list(env.SMTP_TO).length === 0) {
      errors.push('SMTP_URL, SMTP_FROM and SMTP_TO must be set together');
    } else {
      smtp = {
        url: env.SMTP_URL,
        from: env.SMTP_FROM,
        to: list(env.SMTP_TO),
        user: env.SMTP_USER || undefined,
        password: env.SMTP_PASSWORD || undefined,
        requireTls: flag(env.SMTP_STARTTLS, env.SMTP_URL.startsWith('smtp://')),
      };
    }
  }

  let timeoutMinutes = 45;
  let keepRuns = 30;
  let port = 8787;
  try {
    timeoutMinutes = integer('CI_JOB_TIMEOUT_MINUTES', env.CI_JOB_TIMEOUT_MINUTES, 45, 1);
    keepRuns = integer('CI_KEEP_RUNS', env.CI_KEEP_RUNS, 30, 1);
    port = integer('CI_PORT', env.CI_PORT, 8787, 0);
  } catch (error) {
    errors.push(error.message);
  }

  if (errors.length > 0) throw new Error(`Invalid configuration:\n- ${errors.join('\n- ')}`);

  const workdir = resolve(stateRoot);
  return {
    repo,
    webhookSecret: env.GITHUB_WEBHOOK_SECRET ?? '',
    githubToken: env.GITHUB_TOKEN || undefined,
    githubApi: (env.GITHUB_API_URL?.trim() || 'https://api.github.com').replace(/\/+$/, ''),
    cloneUrl: env.CI_CLONE_URL?.trim() || `https://github.com/${repo}.git`,
    branches: list(env.CI_BRANCHES, ['main']),
    trustedUsers: list(env.CI_TRUSTED_USERS).map((user) => user.toLowerCase()),
    statusContext: env.CI_STATUS_CONTEXT?.trim() || 'ci/self-hosted',
    publicUrl: env.CI_PUBLIC_URL?.trim().replace(/\/+$/, '') || undefined,
    bind: env.CI_BIND?.trim() || '127.0.0.1',
    port,
    workdir,
    repoDir: join(workdir, 'repo.git'),
    runsDir: join(workdir, 'runs'),
    runArgs: (env.CI_RUN_ARGS ?? '').split(/\s+/).filter(Boolean),
    timeoutMs: timeoutMinutes * 60_000,
    keepRuns,
    passEnv: [
      'PATH',
      'HOME',
      'LANG',
      'LC_ALL',
      'TMPDIR',
      'DOCKER_HOST',
      'PNPM_HOME',
      'NODE_OPTIONS',
      'XDG_RUNTIME_DIR',
      'SystemRoot',
      'USERPROFILE',
      ...list(env.CI_PASS_ENV),
    ],
    notifyOnSuccess: flag(env.NOTIFY_ON_SUCCESS, false),
    telegram,
    smtp,
  };
}
