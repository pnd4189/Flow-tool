#!/usr/bin/env bash
# Usage: send-prompt.sh <prompt_file> <marker>
# Sends a prompt to the tool-builder chat ("Chỉnh sửa" mode) and waits for the reply to finish.
# <marker> = unique text from the START of the prompt; the reply is whatever follows it in the chat.
# When the builder answers "Đã xảy ra lỗi" it clicks "Thử lại" then "Bắt đầu tạo", up to 3 times.
# It cannot detect a builder that hangs without answering; use send-watch.sh for that.
# Exit: 0 done, 1 chat box missing, 2 timeout, 3 guard failed, 4 builder error persists.
set -u
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
PF="$1"; MARKER="$2"
guard || exit 3
EDIT=$(ref 'radio "Chỉnh sửa"'); [ -n "$EDIT" ] && $AB click "@$EDIT" >/dev/null 2>&1 && sleep 2
REF=$(ref 'textbox "Bạn muốn')
[ -z "$REF" ] && { echo "chat textbox not found"; exit 1; }
guard || exit 3
$AB fill "@$REF" "$(cat "$PF")" >/dev/null 2>&1; sleep 1; guard || exit 3; $AB press Enter >/dev/null 2>&1
echo "sent $(date +%T)"
for i in $(seq 1 120); do
  sleep 6
  d=$($AB eval "(()=>{const h=[...document.querySelectorAll('h1,h2,h3')].find(x=>/Trình tạo công cụ/.test(x.innerText));let c=h;for(let i=0;i<7&&c;i++){c=c.parentElement; if(c.innerText.length>3000)break};const t=c.innerText;const idx=t.lastIndexOf(${MARKER@Q});return idx>=0 && t.slice(idx).includes('thumb_up')})()" 2>&1)
  if [ "$d" = "true" ]; then echo "done after $((i*6))s"; exit 0; fi
  tail=$($AB eval "(()=>{const h=[...document.querySelectorAll('h1,h2,h3')].find(x=>/Trình tạo công cụ/.test(x.innerText));let c=h;for(let i=0;i<7&&c;i++){c=c.parentElement; if(c.innerText.length>3000)break};return c.innerText.slice(-160)})()" 2>&1)
  if echo "$tail" | grep -q 'Đã xảy ra lỗi'; then
    RETRIES=$(( ${RETRIES:-0} + 1 )); [ $RETRIES -gt 3 ] && { echo "builder error persists"; exit 4; }
    echo "builder server error -> retry $RETRIES"
    R=$(ref 'button "[^"]*Thử lại'); [ -n "$R" ] && $AB click "@$R" >/dev/null 2>&1; sleep 2
    B=$(ref 'button "Bắt đầu tạo"'); guard && [ -n "$B" ] && $AB click "@$B" >/dev/null 2>&1
  fi
  [ $((i % 10)) = 0 ] && echo "t=$((i*6))s building..."
done
echo "timeout"; exit 2
