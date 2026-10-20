#!/bin/sh
# Checks the SHAPE of the public (browser-only) build, because Cloudflare Pages is
# unforgiving about it and nothing else would notice until a deploy.
#
#   index.html  - the SPA fallback adapter-static writes (fallback: "index.html").
#   no 404.html - on Pages a 404.html replaces the SPA fallback, so deep links 404.
#   .wasm       - the engine must ship, and no file may pass Pages' 25 MiB per-file cap.
#   < 20000     - Pages' per-deployment file cap.
#   no /v1/boards - the API's board paths: the public build keeps its boards in the browser
#                   (lib/store/browser.ts), so finding them means the server store shipped.
#   _app/env.js - lib/config.ts reads $env/dynamic/public, which SvelteKit serves from this
#                 file at run time; without it, that read fails as the app starts.
#   the relay - the public build's live link points at the relay Worker, and the socket is
#               opened with it: a build without it opens no live link at all.
#
# Usage: scripts/check-public-build.sh [build-dir]   (default apps/web/build)
set -eu

dir="${1:-apps/web/build}"
max_bytes=26214400
max_files=20000
relay_url="${VITE_HYDRAWN_RELAY_URL:-wss://hydrawn-relay.hydrawn.workers.dev/ws}"
failed=0
fail() {
  echo "check-public-build: FAIL $1"
  failed=1
}

[ -d "$dir" ] || {
  echo "check-public-build: FAIL $dir is not a directory"
  exit 1
}

[ -f "$dir/index.html" ] || fail "$dir/index.html is missing"
[ ! -e "$dir/404.html" ] || fail "$dir/404.html exists and would replace the SPA fallback"

wasm=$(find "$dir" -type f -name '*.wasm')
[ -n "$wasm" ] || fail "no .wasm file under $dir"

big=$(find "$dir" -type f -size +"$max_bytes"c)
[ -z "$big" ] || fail "file(s) over $max_bytes bytes: $big"

count=$(find "$dir" -type f | wc -l | tr -d ' ')
[ "$count" -lt "$max_files" ] || fail "$count files, the limit is under $max_files"

api=$(grep -rlF '/v1/boards' "$dir" || true)
[ -z "$api" ] || fail "the API's board paths (/v1/boards) are in: $api"

[ -f "$dir/_app/env.js" ] || fail "$dir/_app/env.js is missing; lib/config.ts reads it at run time"

relay=$(grep -rlF "$relay_url" "$dir" || true)
[ -n "$relay" ] || fail "the relay ($relay_url) is not in the bundle; the live link would open nothing"

[ "$failed" -eq 0 ] || exit 1

wasm_bytes=$(find "$dir" -type f -name '*.wasm' -exec cat {} + | wc -c | tr -d ' ')
echo "check-public-build: ok - wasm $wasm_bytes bytes (all .wasm files), $count files"
