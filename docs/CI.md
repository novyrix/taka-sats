# Continuous integration without GitHub Actions

Every change to Taka Sats has to pass the same set of checks before it is merged. Those checks
live in one script in this repository, `scripts/ci/run.sh`. You can run it on your own computer,
and a maintainer can run it automatically on a server they control. It does not depend on any
CI company.

The repository also has a GitHub Actions workflow (`.github/workflows/ci.yml`). It is kept for
anyone whose GitHub account can run Actions, but Actions may be unavailable (for example when an
account has a billing problem). The script is the source of truth. If the workflow and the script
ever disagree, the script is right.

## Run the checks yourself

You need Git, Node 24, pnpm 11 and bash. On Windows use Git Bash, which comes with Git for
Windows. Docker is needed for the database steps. Without it, pass `--no-db`.

```bash
pnpm install
pnpm ci:local
```

The command is `ci:local` because `pnpm ci` is already a built in pnpm command (a clean
install). Pass options after it:

```bash
pnpm ci:local --e2e --docker        # also run the browser tests and build the Docker image
pnpm ci:local --no-db               # no Docker: skip every step that needs a database
pnpm ci:local --skip build          # leave a step out
pnpm ci:local --only lint,typecheck # run just these
pnpm ci:local --range main..HEAD    # which commits to check for sign off and message format
pnpm ci:local --fail-fast           # stop at the first failure
pnpm ci:local --help                # every option
```

Without `--fail-fast` it runs every step and prints one summary at the end:

```
PASS  install          3s
PASS  format           5s
...
FAIL  test-db       1m51s  exit 1, log: .ci/logs/test-db.log
----------------------------------------------------
FAIL: 10 passed, 1 failed, 4 skipped in 2m40s
```

It exits with status 1 if any step failed, so you can use it in a git hook or any other tool.
Each step's full output is saved in `.ci/logs/<step>.log` (git ignores that folder), and a
machine readable summary is written to `.ci/logs/report.json`. Use `--report FILE` and
`--log-dir DIR` to put them elsewhere.

## What each step checks

| Step         | Command                         | What it protects                                                                 |
| ------------ | ------------------------------- | -------------------------------------------------------------------------------- |
| `install`    | `pnpm install --frozen-lockfile` | The lockfile matches `package.json`. Nothing is silently upgraded.               |
| `format`     | `pnpm format:check`             | One code style (Prettier).                                                       |
| `lint`       | `pnpm lint`                     | ESLint rules, including accessibility and React hooks.                           |
| `typecheck`  | `pnpm typecheck`                | TypeScript strict mode with no `any`.                                            |
| `design`     | `pnpm check:design`             | The design rules: no raw brand colours, no Orange text on light backgrounds.     |
| `spdx`       | `scripts/ci/check-spdx.sh`      | Every source file starts with the licence header.                                |
| `dco`        | `scripts/ci/check-dco.sh`       | Every commit has a `Signed-off-by` line (`git commit -s`). Merge commits are skipped. |
| `commitlint` | `pnpm exec commitlint`          | Commit messages follow Conventional Commits.                                     |
| `build`      | `pnpm build`                    | The production build, including the service worker, compiles.                    |
| `test`       | `pnpm test`                     | Unit tests. Tests that need a database skip themselves.                          |
| `postgres`   | `docker run postgres:17-alpine` | Starts a throwaway database for the next steps (see below).                      |
| `migrate`    | `pnpm db:migrate`               | Every migration applies to an empty database.                                    |
| `test-db`    | `pnpm test` with `DATABASE_URL` | The full suite, including the ledger, payouts and API tests that need Postgres.  |
| `e2e`        | `pnpm e2e` (with `--e2e`)       | The Playwright browser tests of the offline weighing flow and the field story.   |
| `docker`     | `docker build` (with `--docker`) | The production image builds. It is not pushed anywhere.                          |

`dco` and `commitlint` look at a range of commits. By default that is the commits on your branch
that are not on `origin/main` (or `main`). On `main` itself there is nothing to compare, so both
are skipped unless you pass `--range`. Install and the steps that follow it are skipped if
`install` fails, so a broken install gives one clear failure instead of a wall of them.

## The throwaway database

The database steps never touch an existing database. The script:

- starts a new Postgres container with a random name, bound to `127.0.0.1` on a random free
  port, with a random password and an empty in-memory data directory;
- ignores any `DATABASE_URL` already set in your shell;
- removes the container when it finishes, fails, or you press Ctrl+C.

If the script is killed hard (power cut, `kill -9`) a container can be left behind. Remove it with
`docker rm -f $(docker ps -aq --filter label=takasats-ci=1)`. Use `--keep-db` to keep the
container on purpose while you debug, and `--pg-image` to try another Postgres version.

## Browser tests

`--e2e` runs the Playwright suite against a production build and the throwaway database. The
first time, it downloads Chromium (`pnpm exec playwright install chromium`). On a clean Linux
server set `CI_PLAYWRIGHT_DEPS=1` to also install the system libraries, which needs root.

## Hosting your own CI

A maintainer who wants every push and pull request checked automatically can run the small
receiver in [`ci/`](../ci/README.md) on any Linux machine with Docker. It:

- accepts GitHub webhooks and checks their signature;
- runs `scripts/ci/run.sh` for each push to `main` and each pull request, one at a time, in a
  throwaway checkout that has no access to any secret;
- sets a commit status on GitHub (`ci/self-hosted`), so the check shows on the commit and the pull
  request. GitHub's commit status API does not need Actions;
- sends a Telegram message and/or an email when a build fails.

The receiver has no dependencies, and everything it needs is in the `ci/` folder with an install
guide. You can also run the script from cron, a git hook, or any other CI product: they only have
to call `bash scripts/ci/run.sh` and read its exit status or `report.json`.

Pull requests from forks are not built by the receiver unless the author is on a trusted list,
because building runs the author's code on the maintainer's machine. For those, a maintainer
runs `pnpm ci:local` on the branch after reading the change. See the security notes in
[`ci/README.md`](../ci/README.md).

## Troubleshooting

- **"the Docker daemon is not reachable"**: start Docker, or pass `--no-db`.
- **`pnpm ci` does something else**: use `pnpm ci:local`.
- **Windows**: run from Git Bash, not PowerShell or cmd. Docker Desktop must be running.
- **`dco` fails**: add the line to the last commit with `git commit --amend -s --no-edit`, or to
  several with `git rebase --signoff main`.
- **`commitlint` fails**: the message must look like `fix(payouts): short summary`. See
  [`CONTRIBUTING.md`](../CONTRIBUTING.md).
- **`format` fails**: run `pnpm format` and commit the result.
