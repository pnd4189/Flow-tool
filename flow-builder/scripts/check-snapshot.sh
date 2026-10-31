#!/usr/bin/env bash
# Usage: check-snapshot.sh <tool-dir>
# <tool-dir> holds source/ and, optionally, test-scripts/*.test.ts and test-data/.
# 1. Type-checks source/ with permissive stubs for react, flow-sdk and JSX (catches renamed fields,
#    missing imports, wrong argument counts — the usual builder regressions).
# 2. Bundles each test-scripts/*.test.ts with esbuild (flow-sdk -> stub) and runs it in node.
#    Errors listed in test-scripts/tsc-known-errors.txt (pre-existing, "file: TSxxxx: message" without
#    line numbers) are ignored, so only errors introduced by a new build fail the check.
# Exit 0 only when tsc reports no new errors and every test passes.
set -u
TOOL_DIR="$(cd "$1" && pwd)"
KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TSC=(npx -y -p typescript@5.9.3 tsc)
ESBUILD=(npx -y esbuild@0.27.0)
OUT="$(mktemp -d)"
trap 'rm -rf -- "${OUT:?}"' EXIT
status=0

# Run tsc from inside the tool folder so every error path reads "source/...".
cd "$TOOL_DIR" || exit 1
mapfile -d '' SOURCES < <(find source \( -name '*.ts' -o -name '*.tsx' \) -print0)
# TS7026/TS2786/TS2875/TS2503 only come from the JSX/react stubs, not from the tool code.
TSC_ERRORS=$("${TSC[@]}" --noEmit --jsx preserve --target es2022 --module esnext --moduleResolution bundler \
  --skipLibCheck --strict false --noImplicitAny false --allowImportingTsExtensions --lib es2022,dom \
  "$KIT/tsc-stubs.d.ts" "${SOURCES[@]}" 2>&1 | grep -E 'error TS' | grep -vE 'TS7026|TS2786|TS2875|TS2503')
# Normalise to "relative/file: TSxxxx: message" so line shifts do not count as new errors.
TSC_ERRORS=$(printf '%s\n' "$TSC_ERRORS" | sed -E "s|^([^(]+)\([0-9]+,[0-9]+\): error (TS[0-9]+): |\1: \2: |" | grep -v '^$' | sort -u)
KNOWN="$TOOL_DIR/test-scripts/tsc-known-errors.txt"
if [ -f "$KNOWN" ]; then
  known_count=$(grep -c . "$KNOWN")
  NEW_ERRORS=$(comm -23 <(printf '%s\n' "$TSC_ERRORS" | grep -v '^$') <(sort -u "$KNOWN"))
else
  known_count=0
  NEW_ERRORS="$TSC_ERRORS"
fi
if [ -n "$NEW_ERRORS" ]; then
  echo "tsc: FAIL (new errors)"; echo "$NEW_ERRORS"; status=1
else
  echo "tsc: ok (${#SOURCES[@]} files, $known_count known pre-existing errors ignored)"
fi

shopt -s nullglob
for test in "$TOOL_DIR"/test-scripts/*.test.ts; do
  name="$(basename "$test")"
  if ! "${ESBUILD[@]}" "$test" --bundle --platform=node --format=esm --log-level=error \
      --alias:flow-sdk="$KIT/flow-sdk-stub.js" --outfile="$OUT/$name.mjs"; then
    echo "$name: FAIL (bundle)"; status=1; continue
  fi
  # A test that never settles must fail, not hang the check.
  if TOOL_DIR="$TOOL_DIR" timeout 300 node "$OUT/$name.mjs"; then echo "$name: ok"; else echo "$name: FAIL (exit $?)"; status=1; fi
done
exit $status
