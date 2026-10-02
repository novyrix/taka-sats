#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
#
# Back up, restore and PROVE a backup of the Taka Sats Postgres database.
#
#   pg.sh backup  [dir]                     write dir/postgres-<UTC time>.sql.gz (+ .sha256), mode 0600
#   pg.sh restore <file> <target-db> [--replace]
#                                           load a backup into a NEW database (never over the live one)
#   pg.sh check   <file>                    restore into a scratch database, verify the ledger hash
#                                           chain with SQL alone, print PASS/FAIL, drop the scratch DB
#
# Where the database runs (pick one):
#   Container (the Compose stack, or a test container):
#       PG_CONTAINER=<name> PGUSER=<role> PGDATABASE=<live database>
#   Host client tools:
#       DATABASE_URL=<live url>  PG_ADMIN_URL=<url of the maintenance database, for restore/check>
#
# The backup is a plain SQL dump (--no-owner --no-privileges) so it restores into any role. It
# holds participant data: keep it as private as the database itself, and copy it OFF this host.
# See docs/SELF_HOSTING.md ("Backups") for the schedule and the rehearsal procedure.

set -euo pipefail
umask 077

die() { echo "ERROR: $*" >&2; exit 1; }

in_container() { [[ -n "${PG_CONTAINER:-}" ]]; }

# psql against a named database, SQL on stdin or via -c.
psql_in() {
  local db=$1; shift
  if in_container; then
    docker exec -i "$PG_CONTAINER" psql -U "${PGUSER:-postgres}" -d "$db" -v ON_ERROR_STOP=1 -qAt "$@"
  else
    [[ -n "${PG_ADMIN_URL:-}" ]] || die "set PG_CONTAINER or PG_ADMIN_URL"
    psql "$(echo "$PG_ADMIN_URL" | sed -E "s#/[^/?]*(\?.*)?\$#/${db}\1#")" -v ON_ERROR_STOP=1 -qAt "$@"
  fi
}

dump_live() {
  if in_container; then
    [[ -n "${PGDATABASE:-}" ]] || die "set PGDATABASE (the live database name)"
    docker exec "$PG_CONTAINER" pg_dump -U "${PGUSER:-postgres}" -d "$PGDATABASE" --no-owner --no-privileges
  else
    [[ -n "${DATABASE_URL:-}" ]] || die "set PG_CONTAINER+PGDATABASE, or DATABASE_URL"
    pg_dump "$DATABASE_URL" --no-owner --no-privileges
  fi
}

safe_name() { [[ $1 =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || die "database name must be lower case letters, digits and _: '$1'"; }

verify_checksum() {
  local file=$1
  if [[ -f "$file.sha256" ]]; then
    (cd "$(dirname "$file")" && sha256sum -c "$(basename "$file").sha256" >/dev/null) \
      || die "checksum mismatch: $file is not the file that was backed up"
  else
    echo "note: no $file.sha256 beside it, integrity not checked" >&2
  fi
  gzip -t "$file" || die "$file is not a valid gzip file"
}

cmd_backup() {
  local dir=${1:-./backups}
  mkdir -p "$dir"
  local out="$dir/postgres-$(date -u +%Y%m%d-%H%M%S).sql.gz"
  dump_live | gzip -9 > "$out.part"
  gzip -t "$out.part" || { rm -f "$out.part"; die "the dump is not a valid gzip file"; }
  # pg_dump writes this marker last: a truncated dump does not have it.
  gunzip -c "$out.part" | tail -n 5 | grep -q "PostgreSQL database dump complete" \
    || { rm -f "$out.part"; die "the dump is incomplete (no end marker)"; }
  mv "$out.part" "$out"
  (cd "$dir" && sha256sum "$(basename "$out")" > "$(basename "$out").sha256")
  chmod 600 "$out" "$out.sha256"
  echo "$out"
}

cmd_restore() {
  local file=${1:-} target=${2:-} flag=${3:-}
  [[ -n "$file" && -n "$target" ]] || die "usage: pg.sh restore <file> <target-db> [--replace]"
  [[ -f "$file" ]] || die "no such file: $file"
  safe_name "$target"
  if [[ "$target" == "${PGDATABASE:-}" && "${ALLOW_RESTORE_OVER_LIVE:-}" != "yes" ]]; then
    die "'$target' is the live database. Restore into a new name, then switch over deliberately (ALLOW_RESTORE_OVER_LIVE=yes overrides)"
  fi
  verify_checksum "$file"
  local exists
  exists=$(psql_in postgres -c "select 1 from pg_database where datname = '$target'")
  if [[ -n "$exists" ]]; then
    [[ "$flag" == "--replace" ]] || die "database '$target' already exists (pass --replace to drop and recreate it)"
    psql_in postgres -c "drop database \"$target\" with (force)"
  fi
  psql_in postgres -c "create database \"$target\""
  gunzip -c "$file" | psql_in "$target" >/dev/null
  echo "restored $file into database $target"
}

# Counts, plus the ledger hash chain recomputed in SQL: entry_hash = sha256(seq|type|payload|prev).
CHAIN_SQL="
select
  (select count(*) from information_schema.tables where table_schema = 'public') || ' ' ||
  (select count(*) from ledger_entries) || ' ' ||
  (select count(*) from ledger_entries e where e.entry_hash <>
     encode(sha256(convert_to(e.seq::text || '|' || e.entry_type || '|' || e.payload_hash || '|' || coalesce(e.prev_entry_hash, 'GENESIS'), 'UTF8')), 'hex')) || ' ' ||
  (select count(*) from (
     select seq, prev_entry_hash,
            lag(entry_hash) over (order by seq) as prev_actual,
            lag(seq) over (order by seq) as prev_seq
       from ledger_entries) t
    where (t.prev_seq is null and (t.prev_entry_hash is not null or t.seq <> 1))
       or (t.prev_seq is not null and (t.prev_entry_hash is distinct from t.prev_actual or t.seq <> t.prev_seq + 1)))
"

cmd_check() {
  local file=${1:-}
  [[ -f "$file" ]] || die "usage: pg.sh check <file>"
  local scratch="restore_check_$(date -u +%Y%m%d%H%M%S)_$$"
  trap 'psql_in postgres -c "drop database if exists \"'"$scratch"'\" with (force)" >/dev/null 2>&1 || true' EXIT
  cmd_restore "$file" "$scratch" >/dev/null || { echo "FAIL  restore: the backup did not load"; exit 1; }
  echo "PASS  restore: the backup loads into an empty database"

  local tables entries bad_hash bad_link
  read -r tables entries bad_hash bad_link < <(psql_in "$scratch" -c "$CHAIN_SQL" | tr '|' ' ') \
    || { echo "FAIL  verify: could not query the restored database"; exit 1; }
  local status=0
  if [[ "${tables:-0}" -gt 0 ]]; then echo "PASS  schema: $tables tables"; else echo "FAIL  schema: no tables"; status=1; fi
  echo "INFO  ledger: $entries entries"
  if [[ "${bad_hash:-1}" -eq 0 ]]; then echo "PASS  ledger: every entry hash recomputes"; else echo "FAIL  ledger: $bad_hash entries do not recompute"; status=1; fi
  if [[ "${bad_link:-1}" -eq 0 ]]; then echo "PASS  ledger: the chain is unbroken from genesis"; else echo "FAIL  ledger: $bad_link broken links"; status=1; fi
  if [[ $status -eq 0 ]]; then echo "RESULT: the backup restores and verifies"; else echo "RESULT: FAILED"; fi
  exit $status
}

case "${1:-}" in
  backup)  shift; cmd_backup "$@" ;;
  restore) shift; cmd_restore "$@" ;;
  check)   shift; cmd_check "$@" ;;
  *) sed -n '3,22p' "$0"; exit 2 ;;
esac
