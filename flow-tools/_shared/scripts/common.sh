# Source this file (do not execute it). It drives the user's real Chrome through agent-browser
# and refuses to act on any tab other than the Flow tool named by FLOW_TOOL_ID.
#
#   export FLOW_TOOL_ID=<uuid in .../tool/<uuid>>      required (or FLOW_ALLOW_CREATE=1 while creating a tool)
#   export FLOW_PROJECT_ID=<uuid>                      default: project "Youtube studio"
#   export AGENT_BROWSER_SESSION=<name>                default: flow-builder
#   export FLOW_WORK=<dir>                             scratch files, default /tmp/flow-builder-$USER
#   export FLOW_DOWNLOAD_DIR=<dir>                     where Flow.download lands, default ~/Bản tải về
#
# After sourcing: $AB (pinned agent-browser), guard (returns 1 on the wrong tab), ref '<grep pattern>'
# (prints the first snapshot ref, empty when nothing matches).
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${FLOW_PROJECT_ID:=6c4180b7-8276-4ff6-aa71-0d0abbdcd3a6}"
: "${FLOW_WORK:=/tmp/flow-builder-$USER}"
: "${FLOW_DOWNLOAD_DIR:=$HOME/Bản tải về}"
export AGENT_BROWSER_SESSION="${AGENT_BROWSER_SESSION:-flow-builder}"
mkdir -p "$FLOW_WORK"
AB="agent-browser --auto-connect --pin-tab"
PROJ="flow.google.com/project/$FLOW_PROJECT_ID"

guard() {
  local u; u=$($AB get url 2>&1 | head -1)
  if [ -n "${FLOW_TOOL_ID:-}" ]; then
    case "$u" in *"$PROJ/tool/$FLOW_TOOL_ID"*) return 0;; esac
  elif [ "${FLOW_ALLOW_CREATE:-0}" = "1" ]; then
    case "$u" in *"$PROJ/create-tool"*|*"$PROJ/tool/"*) return 0;; esac
  else
    echo "GUARD: FLOW_TOOL_ID is not set"; return 1
  fi
  echo "GUARD: bound tab is not the Flow tool (${FLOW_TOOL_ID:-new tool}): $u"; return 1
}

ref() { $AB snapshot -i 2>&1 | grep -E "$1" | head -1 | sed -E 's/.*ref=(e[0-9]+).*/\1/'; }

# A hidden tab (another tab in front) freezes the page: the builder's send button and clicks silently do
# nothing. Make the pinned tab the visible one again; no-op when it already is.
ensure_visible() {
  [ "$($AB eval 'document.visibilityState' 2>/dev/null | tr -d '"' | tail -1)" = "visible" ] && return 0
  local id; id=$($AB tab list 2>&1 | grep -E '^\s*→' | sed -E 's/.*\[(t[0-9]+)\].*/\1/' | head -1)
  [ -n "$id" ] && $AB tab "$id" >/dev/null 2>&1
  return 0
}
