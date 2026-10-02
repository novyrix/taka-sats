# Self-hosted CI receiver

This folder is a small deployment layer for running the project's checks on your own machine
when GitHub Actions is not available or not wanted. It is optional. Contributors never need it:
they run `pnpm ci:local` (see [`docs/CI.md`](../docs/CI.md)).

What it does:

1. Listens for GitHub webhooks (push and pull request).
2. Runs `scripts/ci/run.sh`, one build at a time, in a throwaway checkout.
3. Reports a commit status back to GitHub (the green check or red cross on a commit or pull
   request). The commit status API does not need GitHub Actions.
4. Sends a Telegram message and/or an email when a build fails.

It is a single Node file set with no dependencies (`ci/receiver/`), under 900 lines, so you can
read all of it before you run it.

| File                  | Purpose                                               |
| --------------------- | ----------------------------------------------------- |
| `receiver/server.mjs` | HTTP server, queue, shutdown, `--once` mode           |
| `receiver/github.mjs` | webhook signature check, what to build, commit status |
| `receiver/job.mjs`    | fetch, checkout, run `scripts/ci/run.sh`, read report |
| `receiver/notify.mjs` | Telegram and SMTP (through `curl`) notices            |
| `receiver/config.mjs` | settings from environment variables                   |
| `ci.env.example`      | every setting, with placeholders                      |
| `takasats-ci.service` | systemd unit                                          |

## What you need

- A Linux machine with 2 vCPU and 4 GB of memory or more. A full run builds the app and runs
  about 1,200 tests, so it is not instant: expect a few minutes. Memory is the tight resource;
  the unit file caps the service.
- `git`, `bash`, `curl`, Node 24, pnpm 11 and Docker (for the throwaway Postgres container).
- A public https address that reaches the receiver: a Cloudflare tunnel, a reverse proxy, or
  any other way to forward `POST /webhook` to `127.0.0.1:8787`.
- A GitHub account that can add a webhook and a token to the repository.

## Install

Run as root or with sudo. Replace the placeholders.

```bash
# 1. A dedicated user that may use Docker
useradd --system --create-home --home-dir /var/lib/takasats-ci --shell /usr/sbin/nologin takasats-ci
usermod -aG docker takasats-ci

# 2. The receiver code (a normal checkout of this repository, kept on main)
git clone https://github.com/your-org/your-repo.git /opt/takasats-ci
chown -R root:root /opt/takasats-ci

# 3. Settings (secrets live here, readable only by root)
install -d -m 755 /etc/takasats-ci
install -m 600 /opt/takasats-ci/ci/ci.env.example /etc/takasats-ci/ci.env
${EDITOR:-nano} /etc/takasats-ci/ci.env

# 4. The service
cp /opt/takasats-ci/ci/takasats-ci.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now takasats-ci
systemctl status takasats-ci
curl -s http://127.0.0.1:8787/healthz    # {"ok":true,"queued":0,"running":false}
```

Builds need `pnpm` on the service user's `PATH`. If your system `PATH` for services does not
include it, install it system wide (`npm install -g pnpm@11`) or add `PNPM_HOME` and `PATH` to
`ci.env` through `CI_PASS_ENV`.

### Expose the receiver

With a Cloudflare tunnel, add an ingress rule to the tunnel's configuration and restart it:

```yaml
ingress:
  - hostname: ci.example.org
    service: http://127.0.0.1:8787
  # ...your existing rules...
  - service: http_status:404
```

Then create the DNS record for `ci.example.org` to the tunnel. Any reverse proxy works the same
way. Only `/webhook`, `/healthz` and `/runs/<id>` need to be reachable.

### Connect GitHub

1. **Token.** GitHub, Settings, Developer settings, Fine-grained tokens, Generate new token.
   Resource owner: the repository's owner. Repository access: only this repository. Permission:
   **Commit statuses: Read and write**, nothing else. Put it in `GITHUB_TOKEN`.
2. **Webhook.** Repository, Settings, Webhooks, Add webhook:
   - Payload URL: `https://ci.example.org/webhook`
   - Content type: `application/json`
   - Secret: the value of `GITHUB_WEBHOOK_SECRET`
   - Events: choose "Let me select", tick **Pushes** and **Pull requests**.
3. GitHub sends a `ping` straight away. In the webhook's "Recent deliveries" tab it should show
   a 200 response with the text `ignored: ping`.
4. Optional: in branch protection, require the status check named `ci/self-hosted` (or your
   `CI_STATUS_CONTEXT`) before merging.

### Try it

```bash
# Run one build for a commit on main right now, with no webhook involved. Node loads the
# environment file itself. Add --base <sha> to also check commit messages and sign offs.
# Statuses and notices are sent as usual, so this also tests your token and channels.
sudo -u takasats-ci env STATE_DIRECTORY=/var/lib/takasats-ci \
  node --env-file=/etc/takasats-ci/ci.env /opt/takasats-ci/ci/receiver/server.mjs \
  --once --sha <40 character commit id>
```

Then push a commit to `main`: a pending status appears on it within seconds, then a result.
Follow along with `journalctl -u takasats-ci -f`.

The receiver's own tests exercise the whole path (webhook, build, status, Telegram and email)
against local fakes, without any network: `pnpm ci:receiver:test`.

### Update

```bash
git -C /opt/takasats-ci pull --ff-only
systemctl restart takasats-ci
```

A restart forgets queued builds. Use "Redeliver" on the webhook in GitHub to replay one.

## Security notes

Read these before you expose the receiver.

- **A build runs the code of the commit it tests.** For pushes to your own branches and pull
  requests from your own repository that is your code. For a pull request from a fork it is a
  stranger's code, so forks are ignored unless the author is listed in `CI_TRUSTED_USERS`. Review
  a fork's change before you add its author, or run `pnpm ci:local` on that branch yourself.
- **Docker access is root access on that host.** The build needs Docker for the throwaway
  database, so the service user is in the `docker` group. Run the receiver on a machine (or a
  virtual machine) where that is acceptable, and not next to data you cannot lose. Rootless Docker
  is a better fit if you can set it up.
- **The build gets no secrets.** The runner process receives only a short allow list of
  environment variables. The webhook secret, the GitHub token and the notification credentials
  stay in the receiver and are never passed to the build.
- **The webhook is authenticated** with an HMAC signature, compared in constant time. Anything
  without a valid signature gets a 401 and starts nothing. The receiver listens on `127.0.0.1`
  only; the tunnel or proxy is the only way in.
- **Run pages are public by link.** `/runs/<id>` shows a build's step summary and the end of its
  output, with a 128 bit random id. Builds never see secrets, so the output holds none, but treat
  the links as unlisted rather than private.
- **The token can only write statuses** on one repository. A leaked token cannot read or change
  code. Rotate it if it leaks.

## Troubleshooting

| Symptom                                             | Likely cause                                                                             |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Webhook delivery shows 401                          | The secret in GitHub differs from `GITHUB_WEBHOOK_SECRET`.                               |
| Delivery 200 but no build                           | See the response text in the delivery: wrong branch, fork, deleted branch, other repo.   |
| Status stays pending                                | The build is still running, or the service was restarted mid run. Redeliver the webhook. |
| "could not set commit status ... 403 or 404"        | The token lacks "Commit statuses: Read and write" or is for another repository.          |
| Run ends in `error` with "docker ... not reachable" | The service user is not in the `docker` group, or Docker is stopped.                     |
| `pnpm: command not found` in the run output         | `pnpm` is not on the service `PATH`. See the note after the install steps.               |
| Out of memory during `build`                        | Lower `NODE_OPTIONS`, add swap, or add `--skip build` to `CI_RUN_ARGS`.                  |
| A leftover container named `takasats-ci-pg-...`     | A build was killed hard. `docker rm -f $(docker ps -aq --filter label=takasats-ci=1)`.   |
