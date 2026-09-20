#!/usr/bin/env bash
# **************************************************************************** #
#                                                                              #
#                                                         :::      ::::::::    #
#    wasm-build.sh                                      :+:      :+:    :+:    #
#                                                     +:+ +:+         +:+      #
#    By: dlesieur <dlesieur@student.42.fr>          +#+  +:+       +#+         #
#                                                 +#+#+#+#+#+   +#+            #
#    Created: 2026/09/20 00:00:00 by dlesieur          #+#    #+#              #
#    Updated: 2026/09/20 00:00:00 by dlesieur         ###   ########.fr        #
#                                                                              #
# **************************************************************************** #
#
# Compile the draw-engine crate to wasm32 and emit the wasm-bindgen glue into
# engine/pkg/. Runs inside the image built from docker/wasm.Dockerfile, with the
# engine submodule at /engine (bind-mounted for `make wasm`, COPYed in CI).
#
# The generated engine/pkg/draw_engine.js is what engine/src/wasmLoad.ts imports,
# so nothing in the web app builds until this has run once.

set -euo pipefail

ENGINE_DIR="${ENGINE_DIR:-/engine}"
cd "${ENGINE_DIR}"

# wasm-bindgen-cli and the crate's wasm-bindgen dependency must agree exactly, or
# the glue and the .wasm disagree at runtime — a browser-only failure that no
# build step would catch. The crate pins it with `=`, so read it back and compare.
crate_version="$(sed -n 's/^wasm-bindgen = "=\([0-9.]*\)".*/\1/p' crates/draw-engine/Cargo.toml | head -1)"
cli_version="$(wasm-bindgen --version | awk '{print $2}')"

if [ -z "${crate_version}" ]; then
	echo "[wasm] cannot read the pinned wasm-bindgen version from crates/draw-engine/Cargo.toml" >&2
	exit 1
fi

if [ "${crate_version}" != "${cli_version}" ]; then
	echo "[wasm] version mismatch: crate pins ${crate_version}, CLI is ${cli_version}" >&2
	echo "[wasm] rebuild the image with --build-arg WASM_BINDGEN_VERSION=${crate_version}" >&2
	exit 1
fi

target_dir="${CARGO_TARGET_DIR:-target}"

echo "[wasm] cargo build --release --target wasm32-unknown-unknown (wasm-bindgen ${cli_version})"
cargo build --release --target wasm32-unknown-unknown -p draw-engine

echo "[wasm] wasm-bindgen --target web --out-dir pkg"
mkdir -p pkg
wasm-bindgen --target web --out-dir pkg \
	"${target_dir}/wasm32-unknown-unknown/release/draw_engine.wasm"

echo "[wasm] emitted:"
ls -l pkg
