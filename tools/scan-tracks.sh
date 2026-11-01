#!/usr/bin/env bash
# Find files with more tracks than Samsung's player handles, by asking Plex
# from the TV (the dev build has the server and token; see tools/tveval.sh).
#   tools/scan-tracks.sh [min-tracks=30] [section-key ...]
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIN="${1:-30}"; shift
SECTIONS=$(printf '"%s",' "$@"); SECTIONS="[${SECTIONS%,}]"
[ "$SECTIONS" = '[""]' ] || [ "$SECTIONS" = '[]' ] && SECTIONS=null
"$ROOT/tools/tveval.sh" "var ARGS = { min: $MIN, sections: $SECTIONS }; $(cat "$ROOT/tools/scan-tracks.js")" 1800 \
  | sed 's/^.*eval → //; s/ || /\n/g'
