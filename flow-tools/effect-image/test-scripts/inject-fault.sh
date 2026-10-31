# Source after common.sh. Defines inject <radio-pattern> <count> for Effect-Image's built-in fault injection
# (header icon "monitor_heart" -> "Giả lập lỗi sinh ảnh"). The next <count> Flow.generate.image calls throw
# the chosen error instead of calling Flow; the count buttons are 1, 2, 3, 5, 10, 20, 30.
#   inject '1\. Tạm thời' 5     transient error: retried, must not pause the run
#   inject '3\. An toàn' 1      safety policy: prompt is rewritten once
#   inject '4\. Hạn mức' 1      quota: stops new images, finishes the rest, reports unstarted prompts
#   inject '5\. Timeout' 1      hangs 120 s then times out
inject() {
  local pat="$1" n="$2" M F r c K C
  M=$(ref 'button "monitor_heart"'); [ -z "$M" ] && { echo no_monitor; return 1; }; $AB click "@$M" >/dev/null 2>&1; sleep 1.5
  F=$(ref 'button "bug_report Giả lập lỗi sinh ảnh"'); [ -z "$F" ] && { echo no_tab; return 1; }; $AB click "@$F" >/dev/null 2>&1; sleep 1
  r=$(ref "radio \"$pat"); [ -z "$r" ] && { echo no_radio; return 1; }; $AB click "@$r" >/dev/null 2>&1; sleep 0.4
  c=$($AB snapshot -i 2>&1 | grep -E "^\s*- button \"$n\" " | head -1 | sed -E 's/.*ref=(e[0-9]+).*/\1/'); [ -z "$c" ] && { echo no_count; return 1; }; $AB click "@$c" >/dev/null 2>&1; sleep 0.4
  K=$(ref 'Kích hoạt giả lập'); $AB snapshot -i 2>&1 | grep -E 'Kích hoạt giả lập' | cut -c1-70; $AB click "@$K" >/dev/null 2>&1; sleep 1
  C=$(ref 'button "close"'); $AB click "@$C" >/dev/null 2>&1; sleep 1
}
