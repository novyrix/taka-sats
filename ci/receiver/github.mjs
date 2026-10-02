// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The GitHub side of the receiver: webhook signature check, deciding which events start a
 * build, and the commit status API (which works without GitHub Actions).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const ZERO_SHA = /^0+$/;

/** Constant time check of the `X-Hub-Signature-256` header against the raw request body. */
export function verifySignature(secret, rawBody, header) {
  if (!secret || typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const given = Buffer.from(header.slice('sha256='.length), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Turn a webhook into a job, or say why not.
 *
 * Builds run for pushes to the configured branches and for pull requests that target them.
 * A pull request from a fork is built only when its author is in `trustedUsers`, because a
 * build runs the pull request's own code on this machine.
 *
 * @returns {{ run: true, job: object } | { run: false, reason: string }}
 */
export function decideJob(event, payload, cfg) {
  if (event === 'ping') return { run: false, reason: 'ping' };

  if (event === 'push') {
    const prefix = 'refs/heads/';
    if (typeof payload.ref !== 'string' || !payload.ref.startsWith(prefix)) {
      return { run: false, reason: 'not a branch push' };
    }
    const branch = payload.ref.slice(prefix.length);
    if (!cfg.branches.includes(branch)) {
      return { run: false, reason: `branch ${branch} is not built` };
    }
    if (payload.deleted || !payload.after || ZERO_SHA.test(payload.after)) {
      return { run: false, reason: 'branch deleted' };
    }
    const base = payload.before && !ZERO_SHA.test(payload.before) ? payload.before : null;
    return {
      run: true,
      job: {
        kind: 'push',
        label: branch,
        fetchRef: `refs/heads/${branch}`,
        sha: payload.after,
        base,
        author: payload.pusher?.name ?? payload.sender?.login ?? 'unknown',
        subject: payload.head_commit?.message?.split('\n')[0] ?? '',
      },
    };
  }

  if (event === 'pull_request') {
    const pr = payload.pull_request;
    if (!pr) return { run: false, reason: 'no pull request in payload' };
    if (!['opened', 'synchronize', 'reopened', 'ready_for_review'].includes(payload.action)) {
      return { run: false, reason: `pull request action ${payload.action} is ignored` };
    }
    if (!cfg.branches.includes(pr.base?.ref)) {
      return { run: false, reason: `pull request targets ${pr.base?.ref}, which is not built` };
    }
    const headRepo = pr.head?.repo?.full_name;
    const fork = !headRepo || headRepo.toLowerCase() !== cfg.repo.toLowerCase();
    const author = pr.user?.login ?? 'unknown';
    if (fork && !cfg.trustedUsers.includes(author.toLowerCase())) {
      return {
        run: false,
        reason: `fork pull request from ${author} is not built (not in CI_TRUSTED_USERS)`,
      };
    }
    return {
      run: true,
      job: {
        kind: 'pull_request',
        label: `PR #${pr.number}`,
        fetchRef: `refs/pull/${pr.number}/head`,
        sha: pr.head.sha,
        base: pr.base.sha,
        author,
        subject: pr.title ?? '',
      },
    };
  }

  return { run: false, reason: `event ${event} is ignored` };
}

/**
 * Create a commit status. Needs a token with write access to commit statuses.
 * Retries twice on network errors and 5xx. Never logs the token.
 */
export async function postStatus(cfg, { sha, state, description, targetUrl }) {
  const url = `${cfg.githubApi}/repos/${cfg.repo}/statuses/${sha}`;
  const body = JSON.stringify({
    state,
    context: cfg.statusContext,
    description: description.slice(0, 140),
    ...(targetUrl ? { target_url: targetUrl } : {}),
  });
  let lastError = 'unknown error';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${cfg.githubToken}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': 'takasats-ci-receiver',
          'content-type': 'application/json',
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return { ok: true };
      lastError = `GitHub answered ${res.status}`;
      if (res.status < 500) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  return { ok: false, error: lastError };
}
