#!/usr/bin/env bash
# **************************************************************************** #
#                                                                              #
#                                                         :::      ::::::::    #
#    gateway-stale.sh                                   :+:      :+:    :+:    #
#                                                     +:+ +:+         +:+      #
#    By: dlesieur <dlesieur@student.42.fr>          +#+  +:+       +#+         #
#                                                 +#+#+#+#+#+   +#+            #
#    Created: 2026/09/25 00:00:00 by dlesieur          #+#    #+#              #
#    Updated: 2026/09/25 00:00:00 by dlesieur         ###   ########.fr        #
#                                                                              #
# **************************************************************************** #
#
# Is the running gateway serving the checkout's Caddyfile? Exits 1 if not.
#
# The gateway bind-mounts one file. git replaces a file rather than writing into it,
# so after a pull that changes the Caddyfile the running container still holds the
# old inode: a new route (the /ws one, 2026-09-24) 404s, and the image labels `make
# stale` reads say nothing about it. So the file the container sees is hashed and
# compared with the checkout's. `make up` recreates the gateway, which clears it.
#
# ponytail: reads the mounted file, not Caddy's loaded config — an in-place edit
# without a restart reads as current. Caddy's admin API gives JSON, not a Caddyfile.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

container="${1:?usage: gateway-stale.sh <gateway container id>}"

checked_out="$(sha256sum docker/gateway/Caddyfile | cut -c1-64)"
running="$(docker exec "${container}" sha256sum /etc/caddy/Caddyfile | cut -c1-64)"

echo "gateway:    Caddyfile ${running:0:12} running · ${checked_out:0:12} checked out"
[ "${running}" = "${checked_out}" ]
