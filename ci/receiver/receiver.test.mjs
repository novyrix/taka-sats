// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Tests for the CI receiver. Run with: node --test ci/receiver/
 *
 * The end to end cases use a real local git repository as the "remote", a fake `run.sh`, and
 * local fake GitHub, Telegram and SMTP servers. Nothing leaves this machine.
 */

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { loadConfig } from './config.mjs';
import { decideJob, verifySignature } from './github.mjs';
import { buildMail } from './notify.mjs';
import { createReceiver } from './server.mjs';

const SECRET = 'test-webhook-secret';
const baseCfg = { repo: 'acme/widgets', branches: ['main'], trustedUsers: ['alice'] };
const sign = (body) => `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;

describe('verifySignature', () => {
  const body = Buffer.from('{"a":1}');
  test('accepts the right signature', () => {
    assert.equal(verifySignature(SECRET, body, sign(body)), true);
  });
  test('rejects a wrong, missing or malformed signature', () => {
    assert.equal(verifySignature('other', body, sign(body)), false);
    assert.equal(verifySignature(SECRET, body, undefined), false);
    assert.equal(verifySignature(SECRET, body, 'sha256=zz'), false);
    assert.equal(verifySignature(SECRET, Buffer.from('{"a":2}'), sign(body)), false);
    assert.equal(verifySignature('', body, sign(body)), false);
  });
});

describe('decideJob', () => {
  const sha = 'a'.repeat(40);
  const zero = '0'.repeat(40);
  const push = (over = {}) => ({
    ref: 'refs/heads/main',
    before: 'b'.repeat(40),
    after: sha,
    ...over,
  });
  const pr = (over = {}, headRepo = 'acme/widgets', user = 'bob') => ({
    action: 'synchronize',
    pull_request: {
      number: 7,
      title: 'Add a thing',
      user: { login: user },
      base: { ref: 'main', sha: 'c'.repeat(40) },
      head: { sha, repo: { full_name: headRepo } },
    },
    ...over,
  });

  test('a push to a built branch runs', () => {
    const decision = decideJob('push', push(), baseCfg);
    assert.equal(decision.run, true);
    assert.equal(decision.job.sha, sha);
    assert.equal(decision.job.base, 'b'.repeat(40));
  });
  test('a first push has no base', () => {
    assert.equal(decideJob('push', push({ before: zero }), baseCfg).job.base, null);
  });
  test('other branches, deletions and tags are ignored', () => {
    assert.equal(decideJob('push', push({ ref: 'refs/heads/feature' }), baseCfg).run, false);
    assert.equal(decideJob('push', push({ after: zero, deleted: true }), baseCfg).run, false);
    assert.equal(decideJob('push', push({ ref: 'refs/tags/v1' }), baseCfg).run, false);
  });
  test('a same repository pull request runs', () => {
    const decision = decideJob('pull_request', pr(), baseCfg);
    assert.equal(decision.run, true);
    assert.equal(decision.job.fetchRef, 'refs/pull/7/head');
  });
  test('a fork pull request runs only for a trusted user', () => {
    assert.equal(
      decideJob('pull_request', pr({}, 'mallory/widgets', 'mallory'), baseCfg).run,
      false,
    );
    assert.equal(decideJob('pull_request', pr({}, 'alice/widgets', 'Alice'), baseCfg).run, true);
  });
  test('closed pull requests and unrelated events are ignored', () => {
    assert.equal(decideJob('pull_request', pr({ action: 'closed' }), baseCfg).run, false);
    assert.equal(decideJob('issues', {}, baseCfg).run, false);
    assert.equal(decideJob('ping', {}, baseCfg).run, false);
  });
});

describe('loadConfig', () => {
  test('requires the webhook secret for the server', () => {
    assert.throws(() => loadConfig({}), /GITHUB_WEBHOOK_SECRET/);
  });
  test('rejects half configured notification channels', () => {
    assert.throws(
      () => loadConfig({ GITHUB_WEBHOOK_SECRET: 'x', TELEGRAM_BOT_TOKEN: 't' }),
      /together/,
    );
    assert.throws(
      () => loadConfig({ GITHUB_WEBHOOK_SECRET: 'x', SMTP_URL: 'smtp://h' }),
      /together/,
    );
  });
  test('has safe defaults', () => {
    const cfg = loadConfig({ GITHUB_WEBHOOK_SECRET: 'x' });
    assert.equal(cfg.bind, '127.0.0.1');
    assert.deepEqual(cfg.branches, ['main']);
    assert.equal(cfg.telegram, null);
    assert.equal(cfg.smtp, null);
  });
});

test('buildMail makes an ASCII subject and CRLF lines', () => {
  const mail = buildMail({
    from: 'a@example.org',
    to: ['b@example.org'],
    subject: 'Fail \u2014 now',
    body: 'x\ny',
  });
  assert.match(mail, /^Subject: Fail \? now\r\n/m);
  assert.ok(mail.includes('\r\n\r\nx\r\ny\r\n'));
});

describe('end to end', () => {
  let dir;
  let remote;
  let goodSha;
  let badSha;
  let github;
  let telegram;
  let smtp;
  let receiver;
  let base;
  const statuses = [];
  const telegramMessages = [];
  const mails = [];

  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.org', ...args], {
      cwd: remote,
      encoding: 'utf8',
    }).trim();

  const listen = (server) =>
    new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'takasats-ci-test-'));
    remote = join(dir, 'remote');
    mkdirSync(join(remote, 'scripts', 'ci'), { recursive: true });
    git('init', '-q', '-b', 'main');
    // A fake runner: passes unless a file named FAIL exists. Same flags and report shape as run.sh.
    writeFileSync(
      join(remote, 'scripts', 'ci', 'run.sh'),
      [
        '#!/usr/bin/env bash',
        'report=""',
        'while [ $# -gt 0 ]; do case "$1" in --report) report="$2"; shift 2 ;; *) shift ;; esac; done',
        'if [ -f FAIL ]; then',
        '  printf \'{"status":"fail","counts":{"pass":1,"fail":1,"skip":0},"durationSeconds":1,"steps":[{"name":"lint","status":"pass","seconds":1,"note":""},{"name":"test-db","status":"fail","seconds":1,"note":"exit 1"}]}\' > "$report"',
        '  echo "test-db failed"; exit 1',
        'fi',
        'printf \'{"status":"pass","counts":{"pass":2,"fail":0,"skip":0},"durationSeconds":1,"steps":[]}\' > "$report"',
        'echo fine',
        '',
      ].join('\n'),
    );
    git('add', '.');
    git('commit', '-q', '-m', 'feat: first');
    goodSha = git('rev-parse', 'HEAD');
    writeFileSync(join(remote, 'FAIL'), 'x');
    git('add', '.');
    git('commit', '-q', '-m', 'fix: break it');
    badSha = git('rev-parse', 'HEAD');

    github = createHttpServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        statuses.push({ url: req.url, auth: req.headers.authorization, ...JSON.parse(body) });
        res.writeHead(201).end('{}');
      });
    });
    telegram = createHttpServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        telegramMessages.push({ url: req.url, ...JSON.parse(body) });
        res.writeHead(200).end('{"ok":true}');
      });
    });
    // A minimal SMTP server: enough of the protocol for curl to deliver one message.
    smtp = createTcpServer((socket) => {
      let data = false;
      let mail = '';
      socket.write('220 test ESMTP\r\n');
      socket.on('data', (chunk) => {
        const text = String(chunk);
        if (data) {
          mail += text;
          if (mail.endsWith('\r\n.\r\n')) {
            data = false;
            mails.push(mail);
            socket.write('250 queued\r\n');
          }
          return;
        }
        for (const line of text.split('\r\n').filter(Boolean)) {
          const verb = line.slice(0, 4).toUpperCase();
          if (verb === 'EHLO' || verb === 'HELO') socket.write('250 test\r\n');
          else if (verb === 'DATA') {
            data = true;
            mail = '';
            socket.write('354 go\r\n');
          } else if (verb === 'QUIT') socket.end('221 bye\r\n');
          else socket.write('250 ok\r\n');
        }
      });
    });
    const [githubPort, telegramPort, smtpPort] = await Promise.all([
      listen(github),
      listen(telegram),
      listen(smtp),
    ]);

    const cfg = loadConfig({
      GITHUB_WEBHOOK_SECRET: SECRET,
      GITHUB_TOKEN: 'fake-token',
      GITHUB_REPO: 'acme/widgets',
      GITHUB_API_URL: `http://127.0.0.1:${githubPort}`,
      CI_CLONE_URL: remote,
      CI_WORKDIR: join(dir, 'work'),
      CI_PUBLIC_URL: 'https://ci.example.org',
      TELEGRAM_BOT_TOKEN: '123:abc',
      TELEGRAM_CHAT_ID: '42',
      TELEGRAM_API_BASE: `http://127.0.0.1:${telegramPort}`,
      SMTP_URL: `smtp://127.0.0.1:${smtpPort}`,
      SMTP_STARTTLS: 'false',
      SMTP_FROM: 'ci@example.org',
      SMTP_TO: 'owner@example.org, second@example.org',
    });
    receiver = createReceiver(cfg, (line) => process.env.CI_TEST_LOG && console.log(line));
    const port = await listen(receiver.server);
    base = `http://127.0.0.1:${port}`;
  });

  after(() => {
    for (const server of [receiver?.server, github, telegram, smtp]) server?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const post = async (payload, { event = 'push', signature, delivery } = {}) => {
    const body = JSON.stringify(payload);
    return fetch(`${base}/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': event,
        'x-hub-signature-256': signature ?? sign(body),
        ...(delivery ? { 'x-github-delivery': delivery } : {}),
      },
      body,
    });
  };
  const pushPayload = (after, before) => ({
    ref: 'refs/heads/main',
    before,
    after,
    repository: { full_name: 'acme/widgets' },
    head_commit: { message: 'feat: something\n\nbody' },
    pusher: { name: 'dev' },
  });

  test('an unsigned or wrongly signed webhook is rejected and starts nothing', async () => {
    const res = await post(pushPayload(goodSha, '0'.repeat(40)), {
      signature: 'sha256=' + '0'.repeat(64),
    });
    assert.equal(res.status, 401);
    assert.equal(statuses.length, 0);
  });

  test('a push to main is built and reports pending then success', async () => {
    const res = await post(pushPayload(goodSha, '0'.repeat(40)), { delivery: 'd1' });
    assert.equal(res.status, 202);
    await receiver.whenIdle();
    const mine = statuses.filter((s) => s.url.endsWith(goodSha));
    assert.deepEqual(
      mine.map((s) => s.state),
      ['pending', 'pending', 'success'],
    );
    assert.equal(mine[0].auth, 'Bearer fake-token');
    assert.equal(mine[0].context, 'ci/self-hosted');
    assert.match(mine[2].description, /2 checks passed/);
    assert.match(mine[2].target_url, /^https:\/\/ci\.example\.org\/runs\/[0-9a-f]{32}$/);
    assert.equal(telegramMessages.length, 0, 'no notice for a passing build');
    assert.equal(mails.length, 0);
  });

  test('a repeated delivery is ignored', async () => {
    const res = await post(pushPayload(goodSha, '0'.repeat(40)), { delivery: 'd1' });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'duplicate delivery');
  });

  test('a failing build reports failure and notifies Telegram and email', async () => {
    const res = await post(pushPayload(badSha, goodSha), { delivery: 'd2' });
    assert.equal(res.status, 202);
    await receiver.whenIdle();
    const mine = statuses.filter((s) => s.url.endsWith(badSha));
    assert.deepEqual(
      mine.map((s) => s.state),
      ['pending', 'pending', 'failure'],
    );
    assert.equal(mine[2].description, 'Failed: test-db');

    assert.equal(telegramMessages.length, 1);
    assert.match(telegramMessages[0].url, /^\/bot123:abc\/sendMessage$/);
    assert.equal(telegramMessages[0].chat_id, '42');
    assert.match(telegramMessages[0].text, /CI FAILED: acme\/widgets main @ /);
    assert.match(telegramMessages[0].text, /Failed steps: test-db/);

    assert.equal(mails.length, 1);
    assert.match(mails[0], /Subject: \[takasats-ci\] CI FAILED: main @ /);
    assert.match(mails[0], /Failed steps: test-db/);
    assert.match(mails[0], /RCPT|owner@example\.org/);
  });

  test('a fork pull request from an unknown user is not built', async () => {
    const before = statuses.length;
    const res = await post(
      {
        action: 'opened',
        repository: { full_name: 'acme/widgets' },
        pull_request: {
          number: 9,
          title: 'x',
          user: { login: 'mallory' },
          base: { ref: 'main', sha: goodSha },
          head: { sha: badSha, repo: { full_name: 'mallory/widgets' } },
        },
      },
      { event: 'pull_request' },
    );
    assert.equal(res.status, 200);
    assert.match(await res.text(), /^ignored: fork pull request/);
    assert.equal(statuses.length, before);
  });

  test('a webhook for another repository is ignored', async () => {
    const res = await post({
      ...pushPayload(goodSha, goodSha),
      repository: { full_name: 'other/repo' },
    });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /another repository/);
  });

  test('the health check answers', async () => {
    const res = await fetch(`${base}/healthz`);
    assert.deepEqual(await res.json(), { ok: true, queued: 0, running: false });
  });

  test('a run page is served for a real id only', async () => {
    const url = statuses.find((s) => s.url.endsWith(badSha) && s.target_url).target_url;
    const page = await fetch(`${base}${new URL(url).pathname}`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /test-db failed/);
    assert.equal((await fetch(`${base}/runs/${'0'.repeat(32)}`)).status, 404);
    assert.equal((await fetch(`${base}/runs/..%2f..%2fetc`)).status, 404);
  });
});
