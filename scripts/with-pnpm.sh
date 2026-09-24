#!/usr/bin/env bash
# **************************************************************************** #
#                                                                              #
#                                                         :::      ::::::::    #
#    with-pnpm.sh                                       :+:      :+:    :+:    #
#                                                     +:+ +:+         +:+      #
#    By: dlesieur <dlesieur@student.42.fr>          +#+  +:+       +#+         #
#                                                 +#+#+#+#+#+   +#+            #
#    Created: 2026/09/20 00:00:00 by dlesieur          #+#    #+#              #
#    Updated: 2026/09/24 00:00:00 by dlesieur         ###   ########.fr        #
#                                                                              #
# **************************************************************************** #
#
# Entrypoint for the `tooling` compose service: activate pnpm, make sure
# dependencies match the manifests, then exec whatever was asked for.
#
# The install is stamped against a hash of the manifests, so a repeated
# `make test` skips it entirely instead of re-resolving the workspace.
#
# Runs as the host uid (`RUN_AS_HOST`) on a rootful daemon: it cannot write
# `/usr/local/bin` (what `corepack enable` wants) or the root-owned compose
# volume at `/pnpm/store`. A corepack shim and a writable store cover both.

set -euo pipefail

cd /app

PNPM_VERSION="${PNPM_VERSION:-10.32.1}"
export COREPACK_HOME="${COREPACK_HOME:-/tmp/corepack}"
mkdir -p "$COREPACK_HOME"

# Prepare the pinned pnpm into COREPACK_HOME (writable for any uid).
corepack prepare "pnpm@${PNPM_VERSION}" --activate

# `corepack enable` fails with EACCES under RUN_AS_HOST — put `pnpm` on PATH ourselves.
SHIM_DIR="${COREPACK_HOME}/shims"
mkdir -p "$SHIM_DIR"
cat >"${SHIM_DIR}/pnpm" <<'EOF'
#!/bin/sh
exec corepack pnpm "$@"
EOF
chmod +x "${SHIM_DIR}/pnpm"
export PATH="${SHIM_DIR}:${PATH}"

# Compose mounts a root-owned store at /pnpm/store. Fall back when it is not writable.
STORE_DIR="${npm_config_store_dir:-${PNPM_HOME:-/pnpm}/store}"
if [ ! -d "$STORE_DIR" ] || [ ! -w "$STORE_DIR" ]; then
	export PNPM_HOME="${PNPM_HOME_FALLBACK:-/tmp/pnpm-home}"
	export npm_config_store_dir="${PNPM_STORE_FALLBACK:-/tmp/pnpm-store}"
	mkdir -p "$PNPM_HOME" "$npm_config_store_dir"
fi

STAMP_DIR="/app/node_modules/.cache"
STAMP="${STAMP_DIR}/deps.sha256"

current="$(cat package.json pnpm-lock.yaml pnpm-workspace.yaml 2>/dev/null | sha256sum | awk '{print $1}')"
cached=""
[ -f "$STAMP" ] && cached="$(cat "$STAMP")"

if [ ! -d /app/node_modules/.pnpm ] || [ "$cached" != "$current" ]; then
	echo "[tooling] installing dependencies…"
	if [ -f /app/pnpm-lock.yaml ]; then
		pnpm install --frozen-lockfile
	else
		pnpm install --no-frozen-lockfile
	fi
	mkdir -p "$STAMP_DIR"
	printf '%s' "$current" >"$STAMP"
else
	echo "[tooling] dependencies up to date"
fi

exec "$@"
