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
export MONGO_PORT ?= 27019

# `dev` gets its own host ports so a hot-reload server and the built images from
# `up` can run side by side — otherwise starting one silently takes the other's
# port and you debug the wrong build.
export DEV_WEB_PORT ?= 5373
export DEV_API_PORT ?= 4373

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

# Order-only-style guard for the targets that merely *consume* engine/pkg: build it
# when it is missing, leave it alone when it is there. `wasm` stays the way to force
# a rebuild after touching the crate.
$(ENGINE_PKG):
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

test-integration: ## API tests against a real MongoDB
	$(DC) up -d mongo
	$(RUN) tooling pnpm test:integration

quality: $(ENGINE_PKG) ## The gate: typecheck + lint + format + unit tests
	$(RUN) --no-deps tooling pnpm quality
	@echo -e "$(GREEN)✔ quality green$(RESET)"

verify: quality test-integration ## Everything CI runs
	@echo -e "$(GREEN)✔ verify green$(RESET)"

dev: $(ENGINE_PKG) ## Vite dev server + API with hot reload, on DEV_WEB_PORT and DEV_API_PORT
	$(DC) up -d mongo
	-$(DC) rm -fsv drawnosaurus-api 2>/dev/null
	$(RUN) --no-deps -d --name drawnosaurus-api -p $(DEV_API_PORT):4000 tooling \
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

up: $(ENGINE_PKG) ## Start mongo + api + web
	$(DC) up -d --build mongo api web
	@echo -e "$(GREEN)✔ up: web http://localhost:$(WEB_PORT)  api http://localhost:$(API_PORT)$(RESET)"

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

bench: ## Run the engine benchmarks (criterion)
	cd engine && docker compose run --rm --no-deps draw-engine \
		cargo bench --workspace -- --warm-up-time 1 --measurement-time 3
	@echo -e "$(GREEN)✔ benchmarks done$(RESET)"

clean: ## Remove containers, volumes, images, and build output
	$(DC) down -v --rmi local
	rm -rf engine/pkg apps/web/build apps/web/.svelte-kit
	@echo -e "$(GREEN)✔ clean$(RESET)"

.PHONY: all help submodules wasm install lock typecheck lint format test \
	test-integration quality verify dev build up down logs shell clean \
	oracle oracle-fixtures bench
