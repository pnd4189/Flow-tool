#!/usr/bin/env bash
# Usage: watch-auto.sh   (run right after clicking "Chạy tự động ngay"; `touch "$FLOW_WORK/auto_start.stamp"` first)
# Polls the auto-run panel every 10 s and prints stage counters plus the number of files downloaded
# since the stamp. Needs the Flow tab visible. For a hidden tab use watch-downloads.sh instead.
# Exit: 0 finished, 2 timeout (20 min), 3 guard failed, 4 quota stop.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../../../flow-builder/scripts/common.sh"
prev=""
for i in $(seq 1 120); do
  sleep 10
  guard >/dev/null || { echo "guard failed"; exit 3; }
  $AB snapshot 2>&1 > "$FLOW_WORK/snap_auto.txt"; t=$(python3 "$KIT_DIR/tooltext.py" "$FLOW_WORK/snap_auto.txt")
  cols=$(echo "$t" | grep -oE '(Sinh ảnh|Chọn hiệu ứng|Tách lớp|Dựng video|Đã tải xuống)( \| [0-9]+ \| / \| [0-9]+)' | tr '\n' ' ')
  fin=$(echo "$t" | grep -oE 'Đã hoàn tất tất cả mục|Đã dừng[^|]{0,40}|Xong [0-9]+/[0-9]+ (clip|ảnh|mục)[^|]{0,60}' | head -1)
  dl=$(find "$FLOW_DOWNLOAD_DIR" -maxdepth 1 -newer "$FLOW_WORK/auto_start.stamp" -type f 2>/dev/null | wc -l)
  line="$cols | files=$dl"
  [ "$line" != "$prev" ] && echo "$((i*10))s $line"; prev="$line"
  [ -n "$fin" ] && { echo "FINISHED: $fin"; sleep 15; find "$FLOW_DOWNLOAD_DIR" -maxdepth 1 -newer "$FLOW_WORK/auto_start.stamp" -type f -printf '%f %s\n'; exit 0; }
  echo "$t" | grep -qiE 'Quota exceeded|HÀNG ĐỢI ĐÃ DỪNG' && { echo "QUOTA STOP"; exit 4; }
done
echo timeout; exit 2
