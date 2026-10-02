// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Failure notices. Both channels are optional and independent: Telegram through a bot token
 * (api.telegram.org or your own Bot API server) and plain SMTP through curl, which already
 * speaks SMTP, STARTTLS and SMTPS, so the receiver needs no mail library.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function sendTelegram(cfg, text) {
  const { apiBase, token, chatId } = cfg.telegram;
  try {
    const res = await fetch(`${apiBase}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok ? { ok: true } : { ok: false, error: `Telegram answered ${res.status}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Build a plain text RFC 5322 message with CRLF line endings and an ASCII subject. */
export function buildMail({ from, to, subject, body }) {
  const asciiSubject = subject.replace(/[^\x20-\x7e]/g, '?');
  const lines = [
    `From: ${from}`,
    `To: ${to.join(', ')}`,
    `Subject: ${asciiSubject}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    ...body.split(/\r?\n/),
    '',
  ];
  return lines.join('\r\n');
}

export async function sendEmail(cfg, { subject, body }) {
  const { url, from, to, user, password, requireTls } = cfg.smtp;
  const dir = await mkdtemp(join(tmpdir(), 'takasats-ci-mail-'));
  try {
    const mailFile = join(dir, 'message.eml');
    await writeFile(mailFile, buildMail({ from, to, subject, body }), { mode: 0o600 });
    const args = [
      '--silent',
      '--show-error',
      '--max-time',
      '30',
      '--url',
      url,
      '--mail-from',
      from,
    ];
    for (const rcpt of to) args.push('--mail-rcpt', rcpt);
    args.push('--upload-file', mailFile);
    if (requireTls) args.push('--ssl-reqd');
    if (user) {
      // The credentials go through a private config file, not the command line (ps shows that).
      const confFile = join(dir, 'curl.conf');
      const escaped = `${user}:${password ?? ''}`.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      await writeFile(confFile, `user = "${escaped}"\n`, { mode: 0o600 });
      args.push('--config', confFile);
    }
    return await new Promise((resolve) => {
      const child = spawn('curl', args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', (error) =>
        resolve({ ok: false, error: `could not run curl: ${error.message}` }),
      );
      child.on('close', (code) =>
        resolve(
          code === 0
            ? { ok: true }
            : { ok: false, error: `curl exit ${code}: ${stderr.trim().slice(0, 200)}` },
        ),
      );
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Compose the notice text from a finished run. */
export function describeRun(cfg, run) {
  const failed = run.failedSteps.length > 0 ? run.failedSteps.join(', ') : 'none';
  const head =
    run.state === 'success' ? 'CI passed' : run.state === 'failure' ? 'CI FAILED' : 'CI ERROR';
  const short = run.job.sha.slice(0, 8);
  const lines = [
    `${head}: ${cfg.repo} ${run.job.label} @ ${short}`,
    run.job.subject ? `"${run.job.subject}" by ${run.job.author}` : `by ${run.job.author}`,
    run.state === 'failure' ? `Failed steps: ${failed}` : run.description,
    `Took ${run.durationText}`,
  ];
  if (run.url) lines.push(`Details: ${run.url}`);
  return {
    subject: `[takasats-ci] ${head}: ${run.job.label} @ ${short}`,
    text: lines.join('\n'),
  };
}

/** Send to every configured channel. Never throws; returns a list of problems. */
export async function notify(cfg, run) {
  const problems = [];
  const { subject, text } = describeRun(cfg, run);
  if (cfg.telegram) {
    const result = await sendTelegram(cfg, text);
    if (!result.ok) problems.push(`telegram: ${result.error}`);
  }
  if (cfg.smtp) {
    const result = await sendEmail(cfg, { subject, body: text });
    if (!result.ok) problems.push(`email: ${result.error}`);
  }
  return problems;
}
