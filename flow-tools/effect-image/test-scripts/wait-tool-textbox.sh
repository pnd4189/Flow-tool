# Source this from a script, after common.sh. Waits up to ~30 s for the Effect-Image prompt box and
# sets $T to its ref. Exits the calling script when it is missing, so a fill can never land in the
# builder chat by accident (an empty ref would make `fill "@"` hit whatever has focus).
: "${TOOL_TEXTBOX:=textbox \"Dán danh sách prompt}"
T=""
for _i in 1 2 3 4 5 6 7 8 9 10; do T=$(ref "$TOOL_TEXTBOX"); [ -n "$T" ] && break; sleep 3; done
[ -n "$T" ] || { echo "NO_TOOL_TEXTBOX"; exit 1; }
