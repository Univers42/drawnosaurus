#!/usr/bin/env bash
# **************************************************************************** #
#                                                                              #
#                                                         :::      ::::::::    #
#    assert-wasm-freshness.sh                           :+:      :+:    :+:    #
#                                                     +:+ +:+         +:+      #
#    By: dlesieur <dlesieur@student.42.fr>          +#+  +:+       +#+         #
#                                                 +#+#+#+#+#+   +#+            #
#    Created: 2026/09/22 00:00:00 by dlesieur          #+#    #+#              #
#    Updated: 2026/09/22 00:00:00 by dlesieur         ###   ########.fr        #
#                                                                              #
# **************************************************************************** #
#
# Does a change to the Rust crate actually rebuild engine/pkg?
#
# The bug this exists for had no failing test anywhere, because nothing it could
# have failed was wrong: the crate was correct, its 16 zoom tests passed, and the
# browser still ran the previous build. `$(ENGINE_PKG)` had no prerequisites, so it
# meant "build it if absent" — and every target that consumes it (`up`, `dev`,
# `build`, `typecheck`, `test-e2e`) went on serving whatever was already on disk
# after the crate changed underneath it.
#
# So the zoom was fixed in camera.rs, `make up` rebuilt nothing, and the jump was
# reported against a tree that no longer contained it. That is expensive in a way a
# wrong number is not: every other signal says the code is right.
#
# Asserted with `make -n` rather than by building: this is a question about the
# dependency graph, and answering it must not cost a 46s WASM build in CI.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

PKG="engine/pkg/draw_engine.js"
PROBE="engine/crates/draw-engine/src/camera.rs"

if [ ! -f "${PROBE}" ]; then
	echo "[wasm-freshness] ${PROBE} is missing — is the engine submodule checked out?" >&2
	echo "[wasm-freshness] run: git submodule update --init engine" >&2
	exit 1
fi

# A real pkg is not needed: only its mtime relative to the crate is being read, and a
# stand-in avoids making the check depend on having built the thing it is checking.
created_stub=0
if [ ! -f "${PKG}" ]; then
	mkdir -p "$(dirname "${PKG}")"
	touch "${PKG}"
	created_stub=1
fi

cleanup() {
	if [ "${created_stub}" = "1" ]; then
		rm -f "${PKG}"
		rmdir "$(dirname "${PKG}")" 2>/dev/null || true
	fi
}
trap cleanup EXIT

plans_a_rebuild() {
	# `make -n` prints the recipe it *would* run without running it. The wasm target
	# shells out to docker, so its name appearing at all is the signal.
	#
	# Captured before grepping rather than piped into `grep -q`. Under `pipefail` that
	# pipeline inverts its own answer: grep exits at the first match, make dies of
	# SIGPIPE, and the non-zero status says "no match" on exactly the runs that matched.
	local plan
	plan="$(make -n typecheck 2>/dev/null || true)"
	printf '%s' "${plan}" | grep -qi 'wasm'
}

# Timestamps set explicitly, an hour apart, rather than by touching one file and then
# the other. This checkout lives on a network filesystem whose mtime granularity is
# coarse enough that two touches in the same second compare EQUAL — and make treats a
# prerequisite that is not strictly newer as up to date, so the honest version of this
# check reported the bug it was written to catch on a Makefile that was already fixed.
older() { touch -d '1 hour ago' "$1"; }
newer() { touch -d 'now' "$1"; }

failures=0

# 1. pkg newer than the crate: nothing to do. Guards against a rule so eager it
#    rebuilds on every invocation, which would put 46s in front of every target and
#    get the dependency deleted again within a week.
older "${PROBE}"
newer "${PKG}"
if plans_a_rebuild; then
	echo "[wasm-freshness] FAIL: rebuilds even though engine/pkg is up to date" >&2
	failures=$((failures + 1))
else
	echo "[wasm-freshness] ok: up-to-date pkg is left alone"
fi

# 2. crate newer than pkg: must rebuild. This is the one that was broken.
older "${PKG}"
newer "${PROBE}"
if plans_a_rebuild; then
	echo "[wasm-freshness] ok: a change to the crate rebuilds engine/pkg"
else
	echo "[wasm-freshness] FAIL: engine/pkg is stale and nothing rebuilds it." >&2
	echo "[wasm-freshness] \$(ENGINE_PKG) needs the crate sources as prerequisites," >&2
	echo "[wasm-freshness] or every target that consumes it serves the previous build." >&2
	failures=$((failures + 1))
fi

if [ "${failures}" -ne 0 ]; then
	exit 1
fi

echo "[wasm-freshness] green"
