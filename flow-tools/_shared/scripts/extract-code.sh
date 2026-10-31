#!/usr/bin/env bash
# Usage: extract-code.sh <out_dir>
# Dumps every source file shown in the "Mã" tab of the open Flow tool into <out_dir>, keeping sub-folders.
# The tool's code lives only inside Flow, so run this after each build to keep a readable copy.
# Read-only for the tool: it only switches to "Chỉnh sửa" and the "Mã" tab, then clicks file names.
# Exit: 0 ok, 3 guard failed.
set -u
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
guard || exit 3
OUT="$1"; mkdir -p "$OUT"
EDIT=$(ref 'radio "Chỉnh sửa"'); [ -n "$EDIT" ] && $AB click "@$EDIT" >/dev/null 2>&1 && sleep 2
TAB=$(ref 'tab "Mã"'); $AB click "@$TAB" >/dev/null 2>&1; sleep 2
$AB snapshot -i 2>&1 | grep -E 'button "[A-Za-z0-9_./-]+\.(ts|tsx|css|json)"' | sed -E 's/.*button "([^"]+)".*ref=(e[0-9]+).*/\1 \2/' > "$OUT/.files"
while read -r NAME REF; do
  guard >/dev/null || { echo "guard failed mid-way"; exit 3; }
  $AB click "@$REF" >/dev/null 2>&1
  # wait until the editor shows a different file than before (signature = line count + first 3 lines)
  for w in $(seq 1 20); do
    sleep 0.5
    SIG=$($AB eval "(()=>{const ls=[...document.querySelectorAll('.code-line .line-content')];return ls.length+'|'+ls.slice(0,3).map(l=>l.textContent).join('|')})()" 2>&1)
    [ "$SIG" != "${PREV:-}" ] && break
  done
  PREV="$SIG"; sleep 0.5
  mkdir -p "$OUT/$(dirname "$NAME")"
  $AB eval "JSON.stringify([...document.querySelectorAll('.code-line')].map(l=>{const c=l.querySelector('.line-content');return c?c.textContent:''}))" 2>&1 | python3 -c "
import sys,json
arr=json.loads(json.loads(sys.stdin.read().strip()))
open('$OUT/$NAME','w').write('\n'.join(arr)+'\n')
print('$NAME', len(arr), 'lines')"
done < "$OUT/.files"
rm -f "$OUT/.files"
TAB2=$(ref 'tab "Xem trước"'); [ -n "$TAB2" ] && $AB click "@$TAB2" >/dev/null 2>&1
