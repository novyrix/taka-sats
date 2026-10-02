#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
#
# Developer Certificate of Origin: every commit in a range carries a Signed-off-by trailer
# (use `git commit -s`). Merge commits are not checked.
#
#   bash scripts/ci/check-dco.sh <base>..<head>
#   bash scripts/ci/check-dco.sh origin/main..HEAD

set -euo pipefail

range="${1:-}"
if [ -z "$range" ]; then
  echo "usage: check-dco.sh <base>..<head>" >&2
  exit 2
fi

commits="$(git rev-list --no-merges "$range")"
checked=0
missing=0
while IFS= read -r sha; do
  [ -n "$sha" ] || continue
  checked=$((checked + 1))
  if ! git log -1 --format='%B' "$sha" | grep -qiE '^Signed-off-by: .+ <.+@.+>'; then
    echo "commit $sha is missing a Signed-off-by trailer (use: git commit -s --amend)"
    missing=$((missing + 1))
  fi
done <<<"$commits"

if [ "$missing" -gt 0 ]; then
  echo "$missing of $checked commits are not signed off"
  exit 1
fi
echo "all $checked commits in $range are signed off"
