#!/usr/bin/env bash
# Usage: watch-downloads.sh <project-name>
# Counts finished clips by watching the download folder only (no browser calls), so it also works while
# the Flow tab is hidden. Run `touch "$FLOW_WORK/auto_start.stamp"` right before starting the run.
# Prints every change; stops when "<project>_manifest.json" appears (the last file a run writes) or after 25 min.
# Exit: 0 manifest seen, 2 timeout.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../../../flow-tools/_shared/scripts/common.sh"
P="$1"; t0=$(date +%s); prev=-1; n=0
for i in $(seq 1 100); do
  sleep 15
  n=$(find "$FLOW_DOWNLOAD_DIR" -maxdepth 1 -name "${P}_[0-9]*.mp4" -newer "$FLOW_WORK/auto_start.stamp" | wc -l)
  [ "$n" != "$prev" ] && echo "$(( $(date +%s)-t0 ))s clips=$n"; prev=$n
  if find "$FLOW_DOWNLOAD_DIR" -maxdepth 1 -name "${P}_manifest.json" -newer "$FLOW_WORK/auto_start.stamp" | grep -q .; then
    echo "manifest at $(( $(date +%s)-t0 ))s clips=$n"; exit 0
  fi
done
echo "timeout clips=$n"; exit 2
