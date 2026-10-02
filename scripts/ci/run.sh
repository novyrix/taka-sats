#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
#
# Taka Sats CI runner. This script is the source of truth for "does this change pass".
# It does not depend on any CI vendor: run it on your laptop, on a server, or from a webhook.
#
#   pnpm ci:local                      run every default step
#   pnpm ci:local --e2e --docker       also run the Playwright suite and the Docker image build
#   pnpm ci:local --range main..HEAD   check the sign off and message of these commits
#   pnpm ci:local --skip build,docker  leave named steps out
#
# Needs: bash, git, Node 24, pnpm 11. Docker is needed for the database steps, the optional
# image build and nothing else (use --no-db to run without it).
#
# Steps, in order:
#   install format lint typecheck design spdx dco commitlint build test
#   postgres migrate test-db   (a throwaway Postgres container, removed on exit)
#   e2e docker                 (only with --e2e / --docker)
#
# Options:
#   --range A..B      commit range for the dco and commitlint steps (default: the commits on this
#                     branch that are not on origin/main or main; skipped when there are none)
#   --report FILE     machine readable JSON report (default: .ci/logs/report.json)
#   --log-dir DIR     one log file per step (default: .ci/logs)
#   --e2e             run the Playwright suite (needs `pnpm exec playwright install chromium`)
#   --docker          build the production Docker image (does not push it)
#   --skip a,b        skip these steps by name
#   --only a,b        run only these steps
#   --no-db           skip postgres, migrate, test-db and e2e (no Docker needed)
#   --fail-fast       stop at the first failing step (default: run all, report all)
#   --keep-db         leave the throwaway Postgres container running (for debugging)
#   --pg-image IMG    Postgres image (default postgres:17-alpine, or $CI_PG_IMAGE)
#   -h, --help        this text
#
# Exit status: 0 when no step failed, 1 when a step failed, 2 for a usage error.
#
# The database container gets a random free port on 127.0.0.1, a random password and a fresh
# data directory. The script never connects to any other database, and it ignores any
# DATABASE_URL already in your environment.

set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# ---------------------------------------------------------------- options

RANGE="${CI_RANGE:-}"
LOG_DIR="${CI_LOG_DIR:-$ROOT/.ci/logs}"
REPORT=""
WITH_E2E=0
WITH_DOCKER=0
NO_DB=0
FAIL_FAST=0
KEEP_DB=0
SKIP=","
ONLY=""
PG_IMAGE="${CI_PG_IMAGE:-postgres:17-alpine}"

usage_error() {
  echo "run.sh: $1" >&2
  echo "Try: bash scripts/ci/run.sh --help" >&2
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --range) [ $# -ge 2 ] || usage_error "--range needs a value"; RANGE="$2"; shift 2 ;;
    --report) [ $# -ge 2 ] || usage_error "--report needs a value"; REPORT="$2"; shift 2 ;;
    --log-dir) [ $# -ge 2 ] || usage_error "--log-dir needs a value"; LOG_DIR="$2"; shift 2 ;;
    --skip) [ $# -ge 2 ] || usage_error "--skip needs a value"; SKIP="$SKIP$2,"; shift 2 ;;
    --only) [ $# -ge 2 ] || usage_error "--only needs a value"; ONLY=",$2,"; shift 2 ;;
    --pg-image) [ $# -ge 2 ] || usage_error "--pg-image needs a value"; PG_IMAGE="$2"; shift 2 ;;
    --e2e) WITH_E2E=1; shift ;;
    --docker) WITH_DOCKER=1; shift ;;
    --no-db) NO_DB=1; shift ;;
    --fail-fast) FAIL_FAST=1; shift ;;
    --keep-db) KEEP_DB=1; shift ;;
    -h | --help)
      sed -n '4,38p' "${BASH_SOURCE[0]}" | sed -e 's/^# \{0,1\}//'
      exit 0
      ;;
    *) usage_error "unknown option: $1" ;;
  esac
done

mkdir -p "$LOG_DIR"
LOG_DIR="$(cd "$LOG_DIR" && pwd)"
[ -n "$REPORT" ] || REPORT="$LOG_DIR/report.json"
rm -f "$LOG_DIR"/*.log "$REPORT"

# Behave like a CI machine: no prompts, no telemetry, no git hook installation.
export CI="${CI:-true}"
export HUSKY=0
export NEXT_TELEMETRY_DISABLED=1
export SERWIST_SUPPRESS_TURBOPACK_WARNING=1
# Never let a shell's own database leak into a run. The database steps set it explicitly.
unset DATABASE_URL

# Git Bash on Windows rewrites arguments that look like unix paths (docker run --tmpfs /var/...).
# Switch that off for docker only: other tools, pnpm among them, rely on it.
docker() { MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*" command docker "$@"; }

# ---------------------------------------------------------------- bookkeeping

STEP_NAMES=()
STEP_STATUS=()
STEP_SECS=()
STEP_NOTE=()
FAILED=0
STOPPED=0
INSTALL_OK=1
PG_OK=0
PG_NAME="takasats-ci-pg-$$-$RANDOM"
STATE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/takasats-ci.XXXXXX")"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
START_SECONDS=$SECONDS

cleanup() {
  local rc=$?
  if [ "$KEEP_DB" != 1 ]; then
    docker rm -f -v "$PG_NAME" >/dev/null 2>&1 || true
  else
    echo "Leaving Postgres container $PG_NAME running (--keep-db). Remove it with: docker rm -f -v $PG_NAME"
  fi
  rm -rf "$STATE_DIR"
  return $rc
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

json_str() {
  # Quote a string for JSON: control characters become spaces, then escape \ and ".
  printf '%s' "$1" | tr '\t\n\r' '   ' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

fmt_secs() {
  local s=$1
  if [ "$s" -ge 60 ]; then
    printf '%dm%02ds' $((s / 60)) $((s % 60))
  else
    printf '%ds' "$s"
  fi
}

record() { # name status seconds note
  STEP_NAMES+=("$1")
  STEP_STATUS+=("$2")
  STEP_SECS+=("$3")
  STEP_NOTE+=("$4")
}

selected() { # is this step wanted by --only / --skip?
  case "$SKIP" in *",$1,"*) return 1 ;; esac
  if [ -n "$ONLY" ]; then
    case "$ONLY" in *",$1,"*) return 0 ;; *) return 1 ;; esac
  fi
  return 0
}

# run_step NAME FUNCTION: runs FUNCTION in a subshell, streams and logs its output.
run_step() {
  local name=$1 fn=$2 log="$LOG_DIR/$1.log" start rc
  if ! selected "$name"; then
    record "$name" SKIP 0 "not selected"
    return 0
  fi
  if [ "$STOPPED" = 1 ]; then
    record "$name" SKIP 0 "stopped after an earlier failure (--fail-fast)"
    return 0
  fi
  printf '\n==> %s\n' "$name"
  start=$SECONDS
  set +e
  (
    set -Eeuo pipefail
    "$fn"
  ) 2>&1 | tee "$log"
  rc=${PIPESTATUS[0]}
  set -e
  if [ "$rc" -eq 0 ]; then
    record "$name" PASS $((SECONDS - start)) ""
  else
    record "$name" FAIL $((SECONDS - start)) "exit $rc, log: $log"
    FAILED=1
    if [ "$FAIL_FAST" = 1 ]; then STOPPED=1; fi
    if [ "$name" = install ]; then INSTALL_OK=0; fi
  fi
  return 0
}

skip_step() { # name reason
  if selected "$1"; then
    record "$1" SKIP 0 "$2"
  else
    record "$1" SKIP 0 "not selected"
  fi
}

# ---------------------------------------------------------------- the steps

step_install() { pnpm install --frozen-lockfile; }
step_format() { pnpm format:check; }
step_lint() { pnpm lint; }
step_typecheck() { pnpm typecheck; }
step_design() { pnpm check:design; }
step_spdx() { bash scripts/ci/check-spdx.sh; }
step_dco() { bash scripts/ci/check-dco.sh "$RANGE"; }
step_commitlint() { pnpm exec commitlint --from "${RANGE%%..*}" --to "${RANGE##*..}" --verbose; }
step_build() { pnpm build; }
step_test() { pnpm test; } # no DATABASE_URL: database suites skip themselves

step_postgres() {
  command -v docker >/dev/null 2>&1 || { echo "docker is not installed. Install it or pass --no-db."; return 1; }
  docker info >/dev/null 2>&1 || { echo "the Docker daemon is not reachable. Start it or pass --no-db."; return 1; }
  local password="ci$RANDOM$RANDOM$RANDOM"
  # 127.0.0.1::5432 lets Docker pick a free host port, so this can never clash with another database.
  docker run -d --rm --name "$PG_NAME" --label takasats-ci=1 \
    -e POSTGRES_USER=ci -e POSTGRES_PASSWORD="$password" -e POSTGRES_DB=takasats_ci \
    -p 127.0.0.1::5432 --tmpfs /var/lib/postgresql/data \
    "$PG_IMAGE" -c fsync=off -c synchronous_commit=off -c full_page_writes=off >/dev/null
  local port="" tries=0
  until [ -n "$port" ]; do
    port="$(docker port "$PG_NAME" 5432/tcp 2>/dev/null | head -n 1 | sed -e 's/.*://')"
    tries=$((tries + 1))
    [ "$tries" -lt 20 ] || { echo "Docker did not publish a port for $PG_NAME"; return 1; }
    [ -n "$port" ] || sleep 1
  done
  # Postgres starts a temporary server (unix socket only) while it initialises, then restarts.
  # Asking over TCP inside the container only succeeds for the real server.
  tries=0
  until docker exec "$PG_NAME" pg_isready -h 127.0.0.1 -U ci -d takasats_ci >/dev/null 2>&1; do
    tries=$((tries + 1))
    [ "$tries" -lt 90 ] || { echo "Postgres did not become ready in 90 seconds"; docker logs --tail 20 "$PG_NAME" || true; return 1; }
    sleep 1
  done
  printf 'postgresql://ci:%s@127.0.0.1:%s/takasats_ci' "$password" "$port" >"$STATE_DIR/database-url"
  echo "throwaway Postgres $PG_NAME ready on 127.0.0.1:$port (image $PG_IMAGE)"
}

step_migrate() { DATABASE_URL="$(cat "$STATE_DIR/database-url")" pnpm db:migrate; }
step_test_db() { DATABASE_URL="$(cat "$STATE_DIR/database-url")" pnpm test; }

step_e2e() {
  export DATABASE_URL
  DATABASE_URL="$(cat "$STATE_DIR/database-url")"
  export AUTH_SECRET="e2e-ci-only-not-a-real-secret"
  export E2E=1
  if [ "${CI_PLAYWRIGHT_DEPS:-0}" = 1 ]; then
    pnpm exec playwright install --with-deps chromium
  else
    pnpm exec playwright install chromium
  fi
  pnpm e2e
}

step_docker() {
  command -v docker >/dev/null 2>&1 || { echo "docker is not installed."; return 1; }
  local tag="takasats-ci-app:$$"
  docker build -f docker/Dockerfile --target app -t "$tag" .
  docker rmi -f "$tag" >/dev/null 2>&1 || true
}

# ---------------------------------------------------------------- go

HEAD_SHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
SUBJECT="$(git log -1 --format=%s 2>/dev/null || true)"

echo "Taka Sats CI  ($BRANCH @ ${HEAD_SHA:0:12})"
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  echo "Note: the working tree has uncommitted changes. They are checked too, but the commit range is not."
fi

if [ -z "$RANGE" ]; then
  # Default range: this branch's own commits, relative to origin/main or main.
  for candidate in origin/main main; do
    if git rev-parse --verify -q "$candidate^{commit}" >/dev/null; then
      base="$(git merge-base "$candidate" HEAD || true)"
      if [ -n "$base" ] && [ "$base" != "$HEAD_SHA" ]; then RANGE="$base..$HEAD_SHA"; fi
      break
    fi
  done
fi
case "$RANGE" in
  "" | *..*) ;;
  *) usage_error "--range must look like A..B" ;;
esac

run_step install step_install
pnpm_step() { # name fn
  if [ "$INSTALL_OK" = 1 ]; then run_step "$1" "$2"; else skip_step "$1" "install failed"; fi
}
pnpm_step format step_format
pnpm_step lint step_lint
pnpm_step typecheck step_typecheck
pnpm_step design step_design
run_step spdx step_spdx

if [ -z "$RANGE" ]; then
  skip_step dco "no commits to check (on the base branch; pass --range A..B)"
  skip_step commitlint "no commits to check (on the base branch; pass --range A..B)"
elif [ -z "$(git rev-list --no-merges "$RANGE" 2>/dev/null | head -n 1)" ]; then
  skip_step dco "range $RANGE has no commits"
  skip_step commitlint "range $RANGE has no commits"
else
  run_step dco step_dco
  pnpm_step commitlint step_commitlint
fi

pnpm_step build step_build
pnpm_step test step_test

if [ "$NO_DB" = 1 ]; then
  skip_step postgres "--no-db"
  skip_step migrate "--no-db"
  skip_step test-db "--no-db"
  if [ "$WITH_E2E" = 1 ]; then skip_step e2e "--no-db"; fi
else
  if selected postgres && { selected migrate || selected test-db || { [ "$WITH_E2E" = 1 ] && selected e2e; }; }; then
    run_step postgres step_postgres
    if [ -s "$STATE_DIR/database-url" ]; then PG_OK=1; fi
  else
    skip_step postgres "not selected"
  fi
  if [ "$PG_OK" = 1 ] && [ "$INSTALL_OK" = 1 ]; then
    run_step migrate step_migrate
    run_step test-db step_test_db
    if [ "$WITH_E2E" = 1 ]; then run_step e2e step_e2e; fi
  else
    reason="no database"
    if [ "$INSTALL_OK" != 1 ]; then reason="install failed"; fi
    skip_step migrate "$reason"
    skip_step test-db "$reason"
    if [ "$WITH_E2E" = 1 ]; then skip_step e2e "$reason"; fi
  fi
fi
if [ "$WITH_E2E" != 1 ]; then skip_step e2e "optional, pass --e2e"; fi

if [ "$WITH_DOCKER" = 1 ]; then
  run_step docker step_docker
else
  skip_step docker "optional, pass --docker"
fi

# ---------------------------------------------------------------- summary and report

DURATION=$((SECONDS - START_SECONDS))
FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [ "$FAILED" = 1 ]; then OVERALL=fail; else OVERALL=pass; fi

printf '\n==================== CI summary ====================\n'
npass=0
nfail=0
nskip=0
i=0
while [ "$i" -lt "${#STEP_NAMES[@]}" ]; do
  status="${STEP_STATUS[$i]}"
  case "$status" in PASS) npass=$((npass + 1)) ;; FAIL) nfail=$((nfail + 1)) ;; *) nskip=$((nskip + 1)) ;; esac
  printf '%-4s  %-11s %7s  %s\n' "$status" "${STEP_NAMES[$i]}" "$(fmt_secs "${STEP_SECS[$i]}")" "${STEP_NOTE[$i]}"
  i=$((i + 1))
done
printf -- '----------------------------------------------------\n'
printf '%s: %d passed, %d failed, %d skipped in %s\n' "$(echo "$OVERALL" | tr a-z A-Z)" "$npass" "$nfail" "$nskip" "$(fmt_secs "$DURATION")"

i=0
while [ "$i" -lt "${#STEP_NAMES[@]}" ]; do
  if [ "${STEP_STATUS[$i]}" = FAIL ]; then
    printf '\n--- last lines of %s ---\n' "${STEP_NAMES[$i]}"
    tail -n 25 "$LOG_DIR/${STEP_NAMES[$i]}.log" || true
  fi
  i=$((i + 1))
done

mkdir -p "$(dirname "$REPORT")"
{
  printf '{\n'
  printf '  "tool": "takasats-ci",\n'
  printf '  "status": "%s",\n' "$OVERALL"
  printf '  "commit": "%s",\n' "$(json_str "$HEAD_SHA")"
  printf '  "branch": "%s",\n' "$(json_str "$BRANCH")"
  printf '  "subject": "%s",\n' "$(json_str "$SUBJECT")"
  printf '  "range": "%s",\n' "$(json_str "$RANGE")"
  printf '  "startedAt": "%s",\n' "$STARTED_AT"
  printf '  "finishedAt": "%s",\n' "$FINISHED_AT"
  printf '  "durationSeconds": %d,\n' "$DURATION"
  printf '  "counts": { "pass": %d, "fail": %d, "skip": %d },\n' "$npass" "$nfail" "$nskip"
  printf '  "logDir": "%s",\n' "$(json_str "$LOG_DIR")"
  printf '  "steps": [\n'
  i=0
  total="${#STEP_NAMES[@]}"
  while [ "$i" -lt "$total" ]; do
    sep=","
    if [ "$i" -eq $((total - 1)) ]; then sep=""; fi
    printf '    { "name": "%s", "status": "%s", "seconds": %d, "note": "%s" }%s\n' \
      "${STEP_NAMES[$i]}" "$(echo "${STEP_STATUS[$i]}" | tr A-Z a-z)" "${STEP_SECS[$i]}" \
      "$(json_str "${STEP_NOTE[$i]}")" "$sep"
    i=$((i + 1))
  done
  printf '  ]\n}\n'
} >"$REPORT"
echo "Report: $REPORT"

[ "$FAILED" = 0 ] || exit 1
exit 0
