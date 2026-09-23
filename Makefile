# **************************************************************************** #
#                                                                              #
#                                                         :::      ::::::::    #
#    Makefile                                           :+:      :+:    :+:    #
#                                                     +:+ +:+         +:+      #
#    By: dlesieur <dlesieur@student.42.fr>          +#+  +:+       +#+         #
#                                                 +#+#+#+#+#+   +#+            #
#    Created: 2026/09/20 00:00:00 by dlesieur          #+#    #+#              #
#    Updated: 2026/09/20 00:00:00 by dlesieur         ###   ########.fr        #
#                                                                              #
# **************************************************************************** #

SHELL := /bin/bash
DC    := docker compose
RUN   := $(DC) run --rm

# Host uid/gid so bind-mounted build output is not left root-owned — but only on a
# rootful daemon. Rootless Docker already maps container root onto the invoking host
# user, so the mount comes out host-owned unaided, and passing an explicit --user
# fails outright: the host uid has no mapping inside the namespace. Lazy `=` so
# `docker info` is only paid for by the recipe that needs the answer.
DOCKER_ROOTLESS = $(shell docker info --format '{{.SecurityOptions}}' 2>/dev/null | grep -q rootless && echo 1)
RUN_AS_HOST     = $(if $(DOCKER_ROOTLESS),,--user "$(shell id -u):$(shell id -g)")

# The generated wasm-bindgen glue. engine/src/wasmLoad.ts imports it, so the web
# build, the typecheck and the web image all fail without it — and it is build
# output, gitignored, absent from a fresh clone.
ENGINE_PKG := engine/pkg/draw_engine.js

# Host-side ports. Defaults avoid the sibling osionos stack, which already uses
# 3000/4000/5173/27017. Override per invocation: `make up API_PORT=4500`.
export API_PORT   ?= 4300
export WEB_PORT   ?= 5273
# The port other computers open — the Share dialog's links point at it. WEB_PORT is on
# 127.0.0.1 only; see docker/gateway/Caddyfile for why it is a port of its own.
export SHARE_PORT ?= 5274
export MONGO_PORT ?= 27019

# `dev` gets its own host ports so a hot-reload server and the built images from
# `up` can run side by side — otherwise starting one silently takes the other's
# port and you debug the wrong build.
export DEV_WEB_PORT ?= 5373
export DEV_API_PORT ?= 4373

# Where other computers reach this one: its network addresses — every real interface, so
# a computer on both the wired network and the Wi-Fi is reachable from both — and the
# links to offer, best first: the computer's DNS name when the network's DNS knows it
# (every seat at 42 Madrid has one), then the addresses, each marked with the network it
# goes over — `wired|http://…` — so the dialog can say who can open it. See
# scripts/lan.sh. Lazy, so only the recipes that need them pay for them. Override with
# `make up LAN_IPS="192.168.1.20 10.0.0.5"`.
LAN_IPS ?= $(shell scripts/lan.sh ips 2>/dev/null)
# Told to the API, which tells the Share dialog. See apps/api/src/share.ts.
export SHARE_LAN_ORIGINS = $(shell scripts/lan.sh origins $(SHARE_PORT) $(LAN_IPS) 2>/dev/null)

# What the images are built from. `.git` is not in the Docker build context, so the
# image cannot find out for itself; these go in as build args, are shown at the foot of
# the main menu, and label the image so `make stale` can compare it with the checkout.
# `-dirty` marks uncommitted changes, which is exactly when a SHA alone would lie.
# `:(exclude)engine` because the submodule has its own stamp.
export BUILD_APP_SHA := $(shell git rev-parse --short HEAD 2>/dev/null || echo unknown)$(shell git diff --quiet HEAD -- . ':(exclude)engine' 2>/dev/null || echo -dirty)
export BUILD_ENGINE_SHA := $(shell git -C engine rev-parse --short HEAD 2>/dev/null || echo unknown)$(shell git -C engine diff --quiet HEAD 2>/dev/null || echo -dirty)

CYAN  := \033[36m
GREEN := \033[32m
RESET := \033[0m

.DEFAULT_GOAL := help

help: ## Show available targets
	@grep -hE '^[a-zA-Z_-]+:.*## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*## "}; {printf "$(CYAN)%-16s$(RESET) %s\n", $$1, $$2}'

all: ## Everything at once: submodule, WASM, deps, quality gate, then the stack
	@$(MAKE) --no-print-directory submodules
	@$(MAKE) --no-print-directory wasm
	@$(MAKE) --no-print-directory install
	@$(MAKE) --no-print-directory quality
	@$(MAKE) --no-print-directory up
	@echo -e "$(GREEN)✔ all green$(RESET)"

submodules: ## Fetch the engine submodule if the clone did not
	@test -f engine/Cargo.toml || { \
		echo "[submodule] engine is empty — fetching"; \
		git submodule update --init engine; \
	}

wasm: submodules ## Build engine/pkg from the Rust crate (required before web build/dev)
	$(DC) build wasm
	$(RUN) $(RUN_AS_HOST) wasm
	@echo -e "$(GREEN)✔ engine/pkg built$(RESET)"

# Everything the WASM is built from. Found rather than listed, so a new module cannot
# be left out of the list and quietly stop triggering a rebuild.
ENGINE_CRATE_SRC := $(shell find engine/crates engine/Cargo.toml engine/Cargo.lock \
	-name '*.rs' -o -name 'Cargo.toml' -o -name 'Cargo.lock' 2>/dev/null)

# Rebuild engine/pkg when it is missing OR older than the crate it came from.
#
# It used to have no prerequisites at all, which meant "build it if absent" and nothing
# more: after a change to the crate — or a `git pull` that brought one — every target
# that merely consumes the pkg (`up`, `dev`, `build`, `typecheck`, `test-e2e`) went on
# serving the previous build. That failure is silent and total. The zoom was fixed in
# camera.rs and the browser kept running the old `exp(-delta * 0.01)`, so the bug was
# reported against a tree that no longer contained it, and `make up` could not talk
# anyone out of it.
#
# The cost of getting this wrong the other way is one unnecessary 46s rebuild — a fresh
# checkout stamps source mtimes at checkout time, which can land newer than a pkg
# restored from a cache. That is the right side to err on.
$(ENGINE_PKG): $(ENGINE_CRATE_SRC)
	@$(MAKE) --no-print-directory wasm

install: ## Install workspace dependencies
	$(RUN) --no-deps tooling pnpm install
	@echo -e "$(GREEN)✔ dependencies installed$(RESET)"

lock: ## Regenerate pnpm-lock.yaml
	$(RUN) --no-deps tooling pnpm install --no-frozen-lockfile --lockfile-only
	@echo -e "$(GREEN)✔ pnpm-lock.yaml updated$(RESET)"

typecheck: $(ENGINE_PKG) ## tsc + svelte-check across the workspace (strict)
	$(RUN) --no-deps tooling pnpm typecheck

lint: ## eslint, zero warnings tolerated
	$(RUN) --no-deps tooling pnpm lint

format: ## prettier --check
	$(RUN) --no-deps tooling pnpm format

test: ## Unit tests (contract, api, web)
	$(RUN) --no-deps tooling pnpm test

conformance: ## What prompt/*.md asks for, and what covers it
	$(RUN) --no-deps tooling pnpm --filter @drawnosaurus/conformance test

test-integration: ## API tests against a real MongoDB
	$(DC) up -d mongo
	$(RUN) tooling pnpm test:integration

quality: $(ENGINE_PKG) ## The gate: typecheck + lint + format + unit tests
	$(RUN) --no-deps tooling pnpm quality
	@echo -e "$(GREEN)✔ quality green$(RESET)"

# Runs on the host, not in a container: Playwright ships its own browser build and the
# image that matches it is a gigabyte, which is a poor trade for a target run by hand.
# `playwright install` is idempotent — a no-op once the browser is cached.
#
# Kept out of `quality` on purpose. That gate runs on every save and has to stay fast;
# a browser is neither fast nor free of the outside world.
test-e2e: $(ENGINE_PKG) ## Browser tests (Playwright) — zoom, scroll, bucket fill
	pnpm exec playwright install --with-deps chromium
	pnpm exec playwright test
	@echo -e "$(GREEN)✔ e2e green$(RESET)"

# Excalidraw, installed and served from third_party for the parity benchmark. Its yarn
# cache goes to sgoinfre because $HOME here is a 4.7G disk that is already full.
parity-deps: oracle ## Install Excalidraw so it can be benchmarked against
	cd third_party/excalidraw && \
		YARN_CACHE_FOLDER=/sgoinfre/students/$(USER)/.yarn-cache \
		corepack yarn install --frozen-lockfile --network-timeout 600000
	@echo -e "$(GREEN)✔ excalidraw ready to race$(RESET)"

parity: $(ENGINE_PKG) ## Benchmark against Excalidraw, both on localhost
	pnpm exec playwright test --config perf/playwright.config.ts
	@echo -e "$(GREEN)✔ parity measured$(RESET)"

verify: quality test-integration ## Everything CI runs
	@echo -e "$(GREEN)✔ verify green$(RESET)"

dev: $(ENGINE_PKG) ## Vite dev server + API with hot reload, on DEV_WEB_PORT and DEV_API_PORT
	$(DC) up -d mongo
	-$(DC) rm -fsv drawnosaurus-api 2>/dev/null
	$(RUN) --no-deps -d --name drawnosaurus-api -p 127.0.0.1:$(DEV_API_PORT):4000 tooling \
		pnpm --filter @drawnosaurus/api dev
	@echo -e "$(GREEN)dev: web http://localhost:$(DEV_WEB_PORT)  api http://localhost:$(DEV_API_PORT)$(RESET)"
	@# --service-ports is useless here: `tooling` is a generic runner and declares no
	@# ports, so it published nothing and the server was unreachable from the host.
	@# The proxy target is the API container by name; inside this container 127.0.0.1
	@# is the container itself, not the API.
	@# VITE_USE_POLLING: the working copy is bind-mounted from a network filesystem, and
	@# inotify does not cross either boundary — without polling Vite never sees an edit
	@# and serves what it compiled at startup, which looks exactly like a change that was
	@# never made and survives any number of rebuilds.
	$(RUN) --no-deps -p $(DEV_WEB_PORT):5173 \
		-e API_PROXY_TARGET=http://drawnosaurus-api:4000 \
		-e VITE_USE_POLLING=1 \
		tooling pnpm --filter @drawnosaurus/web dev

build: $(ENGINE_PKG) ## Build the api and web images
	$(DC) build api web
	@echo -e "$(GREEN)✔ images built$(RESET)"

up: $(ENGINE_PKG) ## Start the stack: mongo + api + web behind the gateway on WEB_PORT
	$(DC) up -d --build mongo api web gateway
	@echo -e "$(GREEN)✔ up: http://localhost:$(WEB_PORT)$(RESET)"
	@first=$$(printf '%s' "$(SHARE_LAN_ORIGINS)" | cut -d, -f1); \
	over=$${first%%|*}; first=$${first#*|}; \
	case "$$over" in \
		wired) who="people on the wired network" ;; \
		wifi) who="people on this Wi-Fi" ;; \
		*) who="people on your network" ;; \
	esac; \
	if [ -n "$$first" ]; then \
		echo -e "$(GREEN)  for $$who: $$first$(RESET)"; \
		case ",$(SHARE_LAN_ORIGINS)" in *,wifi\|*) ;; *,wired\|*) \
			echo "  this computer is not on the Wi-Fi: for anyone there, or elsewhere, run 'make share'";; \
		esac; \
		echo "  open a board and press Share: the link to send is at the top (docs/collaboration.md)"; \
	else \
		echo "  no network address found: only this computer can open it (see docs/collaboration.md)"; \
	fi
	@echo -e "$(GREEN)  built from app $(BUILD_APP_SHA) · engine $(BUILD_ENGINE_SHA)$(RESET)"

# The same as the Share dialog's "Share on the internet" button, for a terminal: the API
# starts the tunnel (apps/api/src/tunnel.ts) and says its public link once it is
# connected. Waits up to a minute.
share: ## Put the running stack on the internet (Cloudflare quick tunnel, no account)
	@curl -fsS -X POST http://127.0.0.1:$(API_PORT)/v1/share/tunnel >/dev/null 2>&1 \
		|| { echo "the stack is not running: run 'make up' first"; exit 1; }
	@for _ in $$(seq 1 60); do \
		info=$$(curl -fsS http://127.0.0.1:$(API_PORT)/v1/share); \
		case "$$info" in \
			*'"state":"on"'*) break ;; \
			*'"state":"failed"'*) echo "the internet link did not open: $$(printf '%s' "$$info" \
				| sed -n 's/.*"message":"\([^"]*\)".*/\1/p')"; exit 1 ;; \
		esac; \
		sleep 1; \
	done; \
	url=$$(printf '%s' "$$info" | sed -n 's/.*"public":"\([^"]*\)".*/\1/p'); \
	[ -n "$$url" ] || { echo "the internet link did not open in time"; exit 1; }; \
	echo -e "$(GREEN)✔ on the internet: $$url$(RESET)"; \
	echo "  open a board and press Share: the internet link is there, with the room key."; \
	echo "  'make unshare', or the Share dialog, closes it."

unshare: ## Take the stack off the internet
	@curl -fsS -X DELETE http://127.0.0.1:$(API_PORT)/v1/share/tunnel >/dev/null 2>&1 || true
	@echo -e "$(GREEN)✔ off the internet$(RESET)"

# Is the running web container built from what is checked out? It exists because a
# container left up while commits land serves the old code, and nothing says so — it
# looks exactly like a fix that did not work. That cost three rounds of debugging a tree
# that no longer had the bug. Exits 1 when stale, so it can gate other targets.
stale: ## Is the running stack built from this checkout? Exits 1 if not
	@id=$$($(DC) ps -q web 2>/dev/null); \
	if [ -z "$$id" ]; then echo "web is not running — nothing to be stale"; exit 0; fi; \
	app=$$(docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' $$id); \
	engine=$$(docker inspect --format '{{ index .Config.Labels "drawnosaurus.engine.revision" }}' $$id); \
	echo "running:    app $${app:-unstamped} · engine $${engine:-unstamped}"; \
	echo "checked out: app $(BUILD_APP_SHA) · engine $(BUILD_ENGINE_SHA)"; \
	if [ "$$app" = "$(BUILD_APP_SHA)" ] && [ "$$engine" = "$(BUILD_ENGINE_SHA)" ]; then \
		echo -e "$(GREEN)✔ current$(RESET)"; \
	else \
		echo -e "\033[31m✖ stale — run 'make up' to rebuild$(RESET)"; exit 1; \
	fi

down: ## Stop and remove containers
	$(DC) down
	@echo -e "$(GREEN)✔ down$(RESET)"

logs: ## Tail service logs
	$(DC) logs -f api web

shell: ## Interactive shell in the tooling container
	$(RUN) --no-deps tooling bash

# The SHA drawnosaurus is held to for Excalidraw parity. Committed; the tree it names
# is not — see .gitignore.
ORACLE_SHA := $(shell sed -n 's/^excalidraw=//p' scripts/oracle-sha.txt)

oracle: ## Fetch the Excalidraw parity reference at the pinned SHA
	@test -d third_party/excalidraw || { \
		echo "[oracle] cloning excalidraw"; \
		git clone --filter=blob:none https://github.com/excalidraw/excalidraw.git \
			third_party/excalidraw; \
	}
	@cd third_party/excalidraw && git fetch --quiet origin $(ORACLE_SHA) 2>/dev/null; \
		git checkout --quiet --detach $(ORACLE_SHA)
	@echo -e "$(GREEN)✔ excalidraw pinned at $(ORACLE_SHA)$(RESET)"

# Regenerating fixtures is deliberate: it re-derives what we are held to. Run it when
# the pin moves, never to make a red test go green.
oracle-fixtures: oracle ## Regenerate the rough.js conformance fixtures
	cd engine/tools/rough-oracle && npm install && npm run generate
	@echo -e "$(GREEN)✔ fixtures regenerated — review the diff before committing$(RESET)"

inspector-smoke: ## End-to-end check of the editor-inspector MCP server (needs `make dev`)
	@test -d tools/editor-inspector/node_modules || (cd tools/editor-inspector && npm install --no-audit --no-fund)
	PLAYWRIGHT_BROWSERS_PATH=$${PLAYWRIGHT_BROWSERS_PATH:-/sgoinfre/students/$$USER/.cache/ms-playwright} \
		node tools/editor-inspector/src/smoke.ts
	@echo -e "$(GREEN)✔ inspector green$(RESET)"

bench: ## Run the engine benchmarks (criterion)
	cd engine && docker compose run --rm --no-deps draw-engine \
		cargo bench --workspace -- --warm-up-time 1 --measurement-time 3
	@echo -e "$(GREEN)✔ benchmarks done$(RESET)"

clean: ## Remove containers, volumes, images, and build output
	$(DC) down -v --rmi local
	rm -rf engine/pkg apps/web/build apps/web/.svelte-kit
	@echo -e "$(GREEN)✔ clean$(RESET)"

.PHONY: all help submodules wasm install lock typecheck lint format test \
	test-integration test-e2e conformance parity parity-deps quality verify dev build up \
	down logs shell clean \
	oracle oracle-fixtures bench inspector-smoke stale
