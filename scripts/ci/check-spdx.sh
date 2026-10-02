#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
#
# Every source file must declare the project licence in its first five lines.
# Checks tracked files and new, not yet committed files. Type declaration files
# (*.d.ts) and tool config files (*.config.*) are exempt.
#
#   bash scripts/ci/check-spdx.sh

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

checked=0
missing=0

# Reads at most five lines in-process (no subprocess per file, which is slow on Windows).
has_header() {
  local n=0 line
  while [ "$n" -lt 5 ] && IFS= read -r line; do
    case "$line" in *"SPDX-License-Identifier: AGPL-3.0-only"*) return 0 ;; esac
    n=$((n + 1))
  done <"$1"
  return 1
}

while IFS= read -r file; do
  case "$file" in *.d.ts) continue ;; esac
  [ -f "$file" ] || continue # staged for deletion
  checked=$((checked + 1))
  if ! has_header "$file"; then
    echo "missing SPDX-License-Identifier header: $file"
    missing=$((missing + 1))
  fi
done < <(git ls-files --cached --others --exclude-standard -- \
  '*.ts' '*.tsx' '*.mts' '*.mjs' '*.sh' ':!:*.config.*' ':!:next-env.d.ts')

if [ "$missing" -gt 0 ]; then
  echo "$missing of $checked source files are missing the header: // SPDX-License-Identifier: AGPL-3.0-only"
  exit 1
fi
echo "SPDX headers present in all $checked source files"
