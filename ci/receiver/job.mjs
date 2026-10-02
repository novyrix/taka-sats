// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Run one build: fetch the commit into a local bare repository, check it out in a throwaway
 * worktree, run `scripts/ci/run.sh` there with a minimal environment (no tokens, no secrets),
 * read its JSON report, and clean up.
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const REF_PATTERN = /^refs\/(heads\/[\w./-]+|pull\/\d+\/head)$/;

export const newRunId = () => randomBytes(16).toString('hex');
export const isRunId = (value) => /^[0-9a-f]{32}$/.test(value);

/** Run a command to completion. Resolves with { code, stdout, stderr }; never rejects. */
function exec(command, args, { cwd, env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => resolve({ code: 127, stdout, stderr: error.message }));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function gitEnv() {
  return { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'true' };
}

async function git(cfg, args) {
  return exec('git', ['-C', cfg.repoDir, ...args], { env: gitEnv() });
}

async function ensureRepo(cfg) {
  await mkdir(cfg.workdir, { recursive: true });
  if (!existsSync(join(cfg.repoDir, 'HEAD'))) {
    const init = await exec('git', ['init', '--bare', cfg.repoDir], { env: gitEnv() });
    if (init.code !== 0) throw new Error(`git init failed: ${init.stderr.trim()}`);
    await git(cfg, ['remote', 'add', 'origin', cfg.cloneUrl]);
  }
  await git(cfg, ['remote', 'set-url', 'origin', cfg.cloneUrl]);
}

async function fetchCommit(cfg, job) {
  const refs = new Set([job.fetchRef, ...cfg.branches.map((branch) => `refs/heads/${branch}`)]);
  const specs = [...refs].map((ref) => `+${ref}:${ref}`);
  const fetched = await git(cfg, ['fetch', '--no-tags', '--quiet', 'origin', ...specs]);
  if (fetched.code !== 0)
    throw new Error(`git fetch failed: ${fetched.stderr.trim().slice(0, 300)}`);
  const has = await git(cfg, ['cat-file', '-e', `${job.sha}^{commit}`]);
  if (has.code !== 0) {
    // The branch moved on before we got here. Ask for the exact commit.
    await git(cfg, ['fetch', '--no-tags', '--quiet', 'origin', job.sha]);
    const retry = await git(cfg, ['cat-file', '-e', `${job.sha}^{commit}`]);
    if (retry.code !== 0)
      throw new Error(`commit ${job.sha.slice(0, 8)} is not available from the remote`);
  }
}

/** The commits this job is responsible for: where the work started, up to the tested commit. */
async function commitRange(cfg, job) {
  if (job.base) {
    const mergeBase = await git(cfg, ['merge-base', job.base, job.sha]);
    if (mergeBase.code === 0 && SHA_PATTERN.test(mergeBase.stdout.trim())) {
      return `${mergeBase.stdout.trim()}..${job.sha}`;
    }
    const known = await git(cfg, ['cat-file', '-e', `${job.base}^{commit}`]);
    if (known.code === 0) return `${job.base}..${job.sha}`;
  }
  return `${job.sha}^..${job.sha}`;
}

function childEnvironment(cfg) {
  const env = { CI: 'true' };
  for (const name of cfg.passEnv) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  return env;
}

function killTree(child, signal) {
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    // already gone
  }
}

async function removeOldRuns(cfg) {
  try {
    const names = (await readdir(cfg.runsDir)).filter(isRunId);
    const dated = await Promise.all(
      names.map(async (name) => ({ name, time: (await stat(join(cfg.runsDir, name))).mtimeMs })),
    );
    dated.sort((a, b) => b.time - a.time);
    for (const old of dated.slice(cfg.keepRuns)) {
      await rm(join(cfg.runsDir, old.name), { recursive: true, force: true });
    }
  } catch {
    // housekeeping only
  }
}

function formatDuration(seconds) {
  return seconds >= 60
    ? `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`
    : `${seconds}s`;
}

/**
 * @returns {Promise<{ state: 'success'|'failure'|'error', description: string,
 *   failedSteps: string[], durationText: string, runDir: string }>}
 */
export async function runJob(cfg, job, runId, log) {
  const started = Date.now();
  const runDir = join(cfg.runsDir, runId);
  const srcDir = join(runDir, 'src');
  const logsDir = join(runDir, 'logs');
  const reportFile = join(runDir, 'report.json');
  const outputFile = join(runDir, 'output.log');
  const finish = (state, description, failedSteps = []) => ({
    state,
    description,
    failedSteps,
    durationText: formatDuration(Math.round((Date.now() - started) / 1000)),
    runDir,
  });

  if (!SHA_PATTERN.test(job.sha) || !REF_PATTERN.test(job.fetchRef)) {
    return finish('error', 'The webhook carried an unexpected commit or ref');
  }
  if (job.base && !SHA_PATTERN.test(job.base)) {
    return finish('error', 'The webhook carried an unexpected base commit');
  }

  await mkdir(logsDir, { recursive: true });
  await writeFile(
    join(runDir, 'meta.json'),
    JSON.stringify({ runId, job, startedAt: new Date(started).toISOString() }, null, 2),
  );

  let worktreeAdded = false;
  try {
    await ensureRepo(cfg);
    await fetchCommit(cfg, job);
    const range = await commitRange(cfg, job);
    const added = await git(cfg, ['worktree', 'add', '--detach', '--force', srcDir, job.sha]);
    if (added.code !== 0)
      throw new Error(`git worktree failed: ${added.stderr.trim().slice(0, 300)}`);
    worktreeAdded = true;

    const script = join(srcDir, 'scripts', 'ci', 'run.sh');
    if (!existsSync(script))
      return finish('error', 'scripts/ci/run.sh does not exist in this commit');

    log(`run ${runId.slice(0, 8)}: ${job.label} ${job.sha.slice(0, 8)} range ${range}`);
    const output = createWriteStream(outputFile, { flags: 'a' });
    const child = spawn(
      'bash',
      [script, '--range', range, '--report', reportFile, '--log-dir', logsDir, ...cfg.runArgs],
      {
        cwd: srcDir,
        env: childEnvironment(cfg),
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    child.stdout.pipe(output, { end: false });
    child.stderr.pipe(output, { end: false });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child, 'SIGTERM');
      setTimeout(() => killTree(child, 'SIGKILL'), 20_000).unref();
    }, cfg.timeoutMs);
    const code = await new Promise((resolve) => {
      child.on('error', () => resolve(127));
      child.on('close', (exitCode) => resolve(exitCode ?? 1));
    });
    clearTimeout(timer);
    await new Promise((resolve) => output.end(resolve));

    if (timedOut) return finish('error', `Timed out after ${cfg.timeoutMs / 60_000} minutes`);

    let report = null;
    try {
      report = JSON.parse(await readFile(reportFile, 'utf8'));
    } catch {
      return finish('error', `The runner exited with ${code} and wrote no report`);
    }
    const failed = (report.steps ?? [])
      .filter((step) => step.status === 'fail')
      .map((step) => step.name);
    if (report.status === 'pass') {
      const passed = report.counts?.pass ?? 0;
      return finish(
        'success',
        `${passed} checks passed in ${formatDuration(report.durationSeconds ?? 0)}`,
      );
    }
    return finish('failure', `Failed: ${failed.join(', ') || 'see log'}`, failed);
  } catch (error) {
    return finish(
      'error',
      error instanceof Error ? error.message.slice(0, 120) : 'unexpected error',
    );
  } finally {
    if (worktreeAdded) {
      await git(cfg, ['worktree', 'remove', '--force', srcDir]);
    }
    await rm(srcDir, { recursive: true, force: true });
    await git(cfg, ['worktree', 'prune']);
    await removeOldRuns(cfg);
  }
}

/** A plain text page for one run: its metadata, the step summary and the end of the output. */
export async function describeRunDir(cfg, runId) {
  const runDir = join(cfg.runsDir, runId);
  const parts = [];
  try {
    const meta = JSON.parse(await readFile(join(runDir, 'meta.json'), 'utf8'));
    parts.push(`${cfg.repo} ${meta.job.label} ${meta.job.sha}`, `started ${meta.startedAt}`, '');
  } catch {
    return null;
  }
  try {
    const report = JSON.parse(await readFile(join(runDir, 'report.json'), 'utf8'));
    for (const step of report.steps) {
      parts.push(
        `${step.status.toUpperCase().padEnd(4)}  ${step.name.padEnd(11)} ${step.seconds}s  ${step.note}`,
      );
    }
    parts.push('');
  } catch {
    parts.push('(no report yet)', '');
  }
  try {
    const text = await readFile(join(runDir, 'output.log'), 'utf8');
    parts.push('--- end of output ---', text.slice(-60_000));
  } catch {
    // not started
  }
  return parts.join('\n');
}
