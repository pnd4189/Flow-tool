#!/usr/bin/env bash
# Usage: send-watch.sh <prompt_file> <tail text>
# Sends a prompt to the tool-builder chat ("Chỉnh sửa" mode) and waits for the reply to finish.
# <tail text> = the LAST words of the prompt; the reply is whatever follows them in the chat.
# Detects a hung builder: no reply text after 300 s.
# Exit: 0 done, 1 chat box missing, 2 timeout, 3 guard failed, 4 builder server error, 5 builder hung.
# Builder error (4) or hang (5): reload the tool page, wait ~15 s, run again (see flow-tools/_shared/builder-workflow.md).
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
PF="$1"; TAIL="$2"
guard || exit 3
EDIT=$(ref 'radio "Chỉnh sửa"'); [ -n "$EDIT" ] && $AB click "@$EDIT" >/dev/null 2>&1 && sleep 2
REF=$(ref 'textbox "Bạn muốn'); [ -z "$REF" ] && { echo "no textbox"; exit 1; }
guard || exit 3; $AB fill "@$REF" "$(cat "$PF")" >/dev/null 2>&1; sleep 1; guard || exit 3; $AB press Enter >/dev/null 2>&1
echo "sent $(date +%T)"
for i in $(seq 1 120); do
  sleep 10
  guard >/dev/null || { echo "guard failed"; exit 3; }
  r=$($AB eval "(()=>{const h=[...document.querySelectorAll('h1,h2,h3')].find(x=>/Trình tạo công cụ/.test(x.innerText));let c=h;for(let i=0;i<7&&c;i++){c=c.parentElement; if(c.innerText.length>3000)break};const t=c.innerText;const i=t.lastIndexOf(${TAIL@Q});const a=t.slice(i+${#TAIL});const e=a.lastIndexOf('Bạn muốn tạo gì?');const body=e>=0?a.slice(0,e):a;return JSON.stringify({len:body.trim().length,done:body.includes('thumb_up'),err:body.includes('Đã xảy ra lỗi')})})()" 2>&1)
  len=$(echo "$r" | grep -o 'len\\\?":[0-9]*' | grep -o '[0-9]*$')
  if echo "$r" | grep -q 'done\\\?":true'; then echo "done after $((i*10))s"; exit 0; fi
  if echo "$r" | grep -q 'err\\\?":true'; then echo "builder error after $((i*10))s"; exit 4; fi
  [ $((i % 6)) = 0 ] && echo "t=$((i*10))s reply_len=$len"
  if [ $i -ge 30 ] && [ "${len:-0}" -lt 20 ]; then echo "stuck: no reply after $((i*10))s"; exit 5; fi
done
echo timeout; exit 2
