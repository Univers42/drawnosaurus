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
# Compile the engine's two browser crates to wasm32 and emit their wasm-bindgen
# glue into engine/pkg/. Runs inside the image built from docker/wasm.Dockerfile,
# with the engine submodule at /engine (bind-mounted for `make wasm`, COPYed in CI).
#
#   draw-engine -> pkg/draw_engine.js, which engine/src/wasmLoad.ts imports, so
#                  nothing in the web app builds until this has run once;
#   draw-trace  -> pkg/draw_trace.js, the image tracer, loaded only inside the
#                  Web Worker engine/src/vectorize.worker.ts starts.
#
# Built one crate at a time, so cargo does not unify their features and the
# engine's own module never carries the tracer.

set -euo pipefail

ENGINE_DIR="${ENGINE_DIR:-/engine}"
cd "${ENGINE_DIR}"

# wasm-bindgen-cli and each crate's wasm-bindgen dependency must agree exactly, or
# the glue and the .wasm disagree at runtime — a browser-only failure that no
# build step would catch. The crates pin it with `=`, so read it back and compare.
CRATES=(draw-engine draw-trace)
cli_version="$(wasm-bindgen --version | awk '{print $2}')"

for crate in "${CRATES[@]}"; do
	crate_version="$(sed -n 's/^wasm-bindgen = "=\([0-9.]*\)".*/\1/p' "crates/${crate}/Cargo.toml" | head -1)"
	if [ -z "${crate_version}" ]; then
		echo "[wasm] cannot read the pinned wasm-bindgen version from crates/${crate}/Cargo.toml" >&2
		exit 1
	fi
	if [ "${crate_version}" != "${cli_version}" ]; then
		echo "[wasm] version mismatch: ${crate} pins ${crate_version}, CLI is ${cli_version}" >&2
		echo "[wasm] rebuild the image with --build-arg WASM_BINDGEN_VERSION=${crate_version}" >&2
		exit 1
	fi
done

target_dir="${CARGO_TARGET_DIR:-target}"
mkdir -p pkg

for crate in "${CRATES[@]}"; do
	echo "[wasm] ${crate}: cargo build --release --target wasm32-unknown-unknown (wasm-bindgen ${cli_version})"
	cargo build --release --target wasm32-unknown-unknown -p "${crate}"

	echo "[wasm] ${crate}: wasm-bindgen --target web --out-dir pkg"
	wasm-bindgen --target web --out-dir pkg \
		"${target_dir}/wasm32-unknown-unknown/release/${crate//-/_}.wasm"
done

echo "[wasm] emitted:"
ls -l pkg
