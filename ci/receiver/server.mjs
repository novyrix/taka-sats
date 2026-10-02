// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Taka Sats CI receiver. A small, dependency free HTTP service that:
 *   1. accepts GitHub webhooks (push, pull_request) and verifies their HMAC signature,
 *   2. runs `scripts/ci/run.sh` for each one, one build at a time,
 *   3. reports a commit status back to GitHub (works without GitHub Actions),
 *   4. sends a Telegram and/or email notice when a build fails.
 *
 *   node ci/receiver/server.mjs                       # listen for webhooks
 *   node ci/receiver/server.mjs --once --sha <sha> [--base <sha>] [--ref refs/heads/main]
 *                                                     # run one build now, then exit
 *
 * Configuration is environment variables only. See ci/ci.env.example and ci/README.md.
 */

import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.mjs';
import { decideJob, postStatus, verifySignature } from './github.mjs';
import { describeRunDir, isRunId, newRunId, runJob } from './job.mjs';
import { notify } from './notify.mjs';

const MAX_BODY_BYTES = 5 * 1024 * 1024;

const stamp = () => new Date().toISOString();
const defaultLog = (message) => console.log(`${stamp()} ${message}`);

/** Create the receiver. Returns the HTTP server and a few handles for tests and shutdown. */
export function createReceiver(cfg, log = defaultLog) {
  /** @type {{ job: object, id: string }[]} */
  const queue = [];
  /** @type {{ job: object, id: string } | null} */
  let running = null;
  const seenDeliveries = [];
  const idle = [];

  const targetUrl = (id) => (cfg.publicUrl ? `${cfg.publicUrl}/runs/${id}` : undefined);

  async function status(job, state, description, id) {
    if (!cfg.githubToken) return;
    const result = await postStatus(cfg, {
      sha: job.sha,
      state,
      description,
      targetUrl: targetUrl(id),
    });
    if (!result.ok) log(`could not set commit status on ${job.sha.slice(0, 8)}: ${result.error}`);
  }

  async function processItem(item) {
    const { job, id } = item;
    await status(job, 'pending', 'Running on the self-hosted CI', id);
    const result = await runJob(cfg, job, id, log);
    log(
      `run ${id.slice(0, 8)} ${job.label} ${job.sha.slice(0, 8)}: ${result.state}, ${result.description}`,
    );
    await status(job, result.state, result.description, id);
    if (result.state !== 'success' || cfg.notifyOnSuccess) {
      const problems = await notify(cfg, { ...result, job, url: targetUrl(id) });
      for (const problem of problems) log(`notification problem: ${problem}`);
    }
    return result;
  }

  async function drain() {
    if (running) return;
    const next = queue.shift();
    if (!next) {
      while (idle.length > 0) idle.pop()();
      return;
    }
    running = next;
    try {
      await processItem(next);
    } catch (error) {
      log(`run ${next.id.slice(0, 8)} crashed: ${error instanceof Error ? error.message : error}`);
    } finally {
      running = null;
      setImmediate(drain);
    }
  }

  function enqueue(job) {
    const same = (entry) => entry.job.kind === job.kind && entry.job.label === job.label;
    if (running && running.job.sha === job.sha && same(running)) return 'duplicate';
    if (queue.some((entry) => entry.job.sha === job.sha && same(entry))) return 'duplicate';
    const stale = queue.findIndex(same);
    if (stale >= 0) {
      const [old] = queue.splice(stale, 1);
      void status(old.job, 'error', 'Superseded by a newer commit before it started', old.id);
    }
    const item = { job, id: newRunId() };
    queue.push(item);
    void status(job, 'pending', 'Queued on the self-hosted CI', item.id);
    void drain();
    return 'queued';
  }

  async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) throw Object.assign(new Error('too large'), { status: 413 });
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  const reply = (res, code, body, type = 'text/plain; charset=utf-8') => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/healthz') {
        return reply(
          res,
          200,
          { ok: true, queued: queue.length, running: Boolean(running) },
          'application/json',
        );
      }
      const runMatch = /^\/runs\/([0-9a-f]{32})$/.exec(url.pathname);
      if (req.method === 'GET' && runMatch && isRunId(runMatch[1])) {
        const page = await describeRunDir(cfg, runMatch[1]);
        return page === null ? reply(res, 404, 'not found') : reply(res, 200, page);
      }
      if (url.pathname !== '/webhook') return reply(res, 404, 'not found');
      if (req.method !== 'POST') return reply(res, 405, 'method not allowed');

      const raw = await readBody(req);
      if (!verifySignature(cfg.webhookSecret, raw, req.headers['x-hub-signature-256'])) {
        log('rejected a webhook with a missing or wrong signature');
        return reply(res, 401, 'bad signature');
      }
      const delivery = String(req.headers['x-github-delivery'] ?? '');
      if (delivery && seenDeliveries.includes(delivery))
        return reply(res, 200, 'duplicate delivery');
      if (delivery) {
        seenDeliveries.push(delivery);
        if (seenDeliveries.length > 200) seenDeliveries.shift();
      }
      let payload;
      try {
        payload = JSON.parse(raw.toString('utf8'));
      } catch {
        return reply(res, 400, 'body is not JSON');
      }
      const event = String(req.headers['x-github-event'] ?? '');
      if (
        payload?.repository?.full_name &&
        payload.repository.full_name.toLowerCase() !== cfg.repo.toLowerCase()
      ) {
        return reply(res, 200, 'ignored: another repository');
      }
      const decision = decideJob(event, payload, cfg);
      if (!decision.run) {
        log(`ignored ${event}: ${decision.reason}`);
        return reply(res, 200, `ignored: ${decision.reason}`);
      }
      const outcome = enqueue(decision.job);
      log(`${outcome} ${decision.job.label} ${decision.job.sha.slice(0, 8)}`);
      return reply(res, outcome === 'queued' ? 202 : 200, outcome);
    } catch (error) {
      const code = error?.status === 413 ? 413 : 500;
      if (code === 500) log(`request error: ${error instanceof Error ? error.message : error}`);
      return reply(res, code, code === 413 ? 'payload too large' : 'internal error');
    }
  });

  return {
    server,
    enqueue,
    /** Resolves when nothing is queued or running. */
    whenIdle: () =>
      !running && queue.length === 0
        ? Promise.resolve()
        : new Promise((resolve) => idle.push(resolve)),
    runNow: async (job) => processItem({ job, id: newRunId() }),
  };
}

function parseArgs(argv) {
  const args = { once: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--once') args.once = true;
    else if (['--sha', '--base', '--ref'].includes(arg)) {
      args[arg.slice(2)] = argv[i + 1];
      i += 1;
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadConfig(process.env, { requireSecret: !args.once });
  const receiver = createReceiver(cfg);

  if (args.once) {
    if (!args.sha) throw new Error('--once needs --sha <commit>');
    const result = await receiver.runNow({
      kind: 'manual',
      label: args.ref?.replace(/^refs\/heads\//, '') ?? 'manual',
      fetchRef: args.ref ?? `refs/heads/${cfg.branches[0]}`,
      sha: args.sha,
      base: args.base ?? null,
      author: 'manual run',
      subject: '',
    });
    process.exit(result.state === 'success' ? 0 : 1);
  }

  receiver.server.listen(cfg.port, cfg.bind, () => {
    defaultLog(`takasats-ci receiver for ${cfg.repo} listening on ${cfg.bind}:${cfg.port}`);
    defaultLog(
      `branches ${cfg.branches.join(',')}; statuses ${cfg.githubToken ? 'on' : 'OFF (no GITHUB_TOKEN)'}; ` +
        `telegram ${cfg.telegram ? 'on' : 'off'}; email ${cfg.smtp ? 'on' : 'off'}`,
    );
  });
  const stop = () => {
    receiver.server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`${stamp()} ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
