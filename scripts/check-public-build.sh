#!/bin/sh
# Checks the SHAPE of the public (browser-only) build, because Cloudflare Pages is
# unforgiving about it and nothing else would notice until a deploy.
#
#   index.html  - the SPA fallback adapter-static writes (fallback: "index.html").
#   no 404.html - on Pages a 404.html replaces the SPA fallback, so deep links 404.
#   .wasm       - the engine must ship, and no file may pass Pages' 25 MiB per-file cap.
#   < 20000     - Pages' per-deployment file cap.
#
# Usage: scripts/check-public-build.sh [build-dir]   (default apps/web/build)
set -eu

dir="${1:-apps/web/build}"
max_bytes=26214400
max_files=20000
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

wasm=$(find "$dir" -type f -name '*.wasm' | head -n 1)
[ -n "$wasm" ] || fail "no .wasm file under $dir"

big=$(find "$dir" -type f -size +"$max_bytes"c)
[ -z "$big" ] || fail "file(s) over $max_bytes bytes: $big"

count=$(find "$dir" -type f | wc -l | tr -d ' ')
[ "$count" -lt "$max_files" ] || fail "$count files, the limit is under $max_files"

[ "$failed" -eq 0 ] || exit 1

wasm_bytes=$(wc -c <"$wasm" | tr -d ' ')
echo "check-public-build: ok - wasm $wasm_bytes bytes, $count files"
