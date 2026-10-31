#!/usr/bin/env bash
# Usage: FLOW_TOOL_ID=<uuid> verify-build.sh <tool-slug>
# Run after every builder build. <tool-slug> is the folder name under tool-snapshots/.
# 1. Extracts the live code (extract-code.sh) into $FLOW_WORK/verify/<slug>/source.
# 2. Lists files the build changed versus tool-snapshots/<slug>/source, with line counts
#    (a big drop means the builder rewrote a file and probably dropped features).
# 3. Runs check-snapshot.sh on the extracted code with the repo's test-scripts and test-data.
# It never touches the repo snapshot: after reviewing the diff, copy the extracted source over it.
# Exit: 0 checks pass, 1 checks fail, 3 guard or extraction failed.
set -u
SLUG="$1"
KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$KIT/../.." && pwd)"
source "$KIT/common.sh"
SNAP="$REPO/tool-snapshots/$SLUG"
[ -d "$SNAP/source" ] || { echo "no snapshot at $SNAP/source"; exit 3; }
OUT="$FLOW_WORK/verify/$SLUG"
mkdir -p "$OUT"
rm -rf -- "${OUT:?}/source" "${OUT:?}/test-scripts" "${OUT:?}/test-data"
$AB frame main >/dev/null 2>&1
bash "$KIT/extract-code.sh" "$OUT/source" > "$OUT/extract.log" 2>&1 || { tail -3 "$OUT/extract.log"; exit 3; }
[ -n "$(ls -A "$OUT/source" 2>/dev/null)" ] || { echo "extraction produced no files"; exit 3; }

echo "== changed files (snapshot lines -> live lines)"
( cd "$OUT/source" && find . -type f | sort ) > "$OUT/live.txt"
( cd "$SNAP/source" && find . -type f | sort ) > "$OUT/snap.txt"
changed=0
while IFS= read -r f; do
  if [ ! -f "$SNAP/source/$f" ]; then echo "  + $f ($(wc -l < "$OUT/source/$f"))"; changed=1
  elif ! cmp -s "$SNAP/source/$f" "$OUT/source/$f"; then
    echo "  ~ $f $(wc -l < "$SNAP/source/$f") -> $(wc -l < "$OUT/source/$f")"; changed=1
  fi
done < "$OUT/live.txt"
comm -13 "$OUT/live.txt" "$OUT/snap.txt" | sed 's/^/  - /'
[ "$changed" = 1 ] || echo "  (no change)"

[ -d "$SNAP/test-scripts" ] && cp -r "$SNAP/test-scripts" "$OUT/"
[ -d "$SNAP/test-data" ] && cp -r "$SNAP/test-data" "$OUT/"
echo "== checks"
bash "$KIT/check-snapshot.sh" "$OUT"
