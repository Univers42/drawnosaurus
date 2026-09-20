#!/usr/bin/env bash
# **************************************************************************** #
#                                                                              #
#                                                         :::      ::::::::    #
#    with-pnpm.sh                                       :+:      :+:    :+:    #
#                                                     +:+ +:+         +:+      #
#    By: dlesieur <dlesieur@student.42.fr>          +#+  +:+       +#+         #
#                                                 +#+#+#+#+#+   +#+            #
#    Created: 2026/09/20 00:00:00 by dlesieur          #+#    #+#              #
#    Updated: 2026/09/20 00:00:00 by dlesieur         ###   ########.fr        #
#                                                                              #
# **************************************************************************** #
#
# Entrypoint for the `tooling` compose service: activate pnpm, make sure
# dependencies match the manifests, then exec whatever was asked for.
#
# The install is stamped against a hash of the manifests, so a repeated
# `make test` skips it entirely instead of re-resolving the workspace.

set -euo pipefail

cd /app

corepack enable >/dev/null 2>&1 || true
corepack prepare "pnpm@${PNPM_VERSION:-10.32.1}" --activate >/dev/null 2>&1 || true

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
