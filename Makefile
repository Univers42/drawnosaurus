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

# Host uid/gid so bind-mounted build output is not left root-owned.
UIDGID := $(shell id -u):$(shell id -g)

# Host-side ports. Defaults avoid the sibling osionos stack, which already uses
# 3000/4000/5173/27017. Override per invocation: `make up API_PORT=4500`.
export API_PORT   ?= 4300
export WEB_PORT   ?= 5273
export MONGO_PORT ?= 27019

CYAN  := \033[36m
GREEN := \033[32m
RESET := \033[0m

.DEFAULT_GOAL := help

help: ## Show available targets
	@grep -hE '^[a-zA-Z_-]+:.*## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*## "}; {printf "$(CYAN)%-16s$(RESET) %s\n", $$1, $$2}'

wasm: ## Build engine/pkg from the Rust crate (required before web build/dev)
	$(DC) build wasm
	$(RUN) --user "$(UIDGID)" wasm
	@echo -e "$(GREEN)✔ engine/pkg built$(RESET)"

install: ## Install workspace dependencies
	$(RUN) --no-deps tooling pnpm install
	@echo -e "$(GREEN)✔ dependencies installed$(RESET)"

lock: ## Regenerate pnpm-lock.yaml
	$(RUN) --no-deps tooling pnpm install --no-frozen-lockfile --lockfile-only
	@echo -e "$(GREEN)✔ pnpm-lock.yaml updated$(RESET)"

typecheck: ## tsc + svelte-check across the workspace (strict)
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

quality: ## The gate: typecheck + lint + format + unit tests
	$(RUN) --no-deps tooling pnpm quality
	@echo -e "$(GREEN)✔ quality green$(RESET)"

verify: quality test-integration ## Everything CI runs
	@echo -e "$(GREEN)✔ verify green$(RESET)"

dev: ## Vite dev server + API with hot reload, on WEB_PORT and API_PORT
	$(DC) up -d mongo
	$(RUN) --no-deps --service-ports -d --name drawnosaurus-api tooling \
		pnpm --filter @drawnosaurus/api dev
	$(RUN) --no-deps --service-ports tooling pnpm --filter @drawnosaurus/web dev

build: ## Build the api and web images
	$(DC) build api web
	@echo -e "$(GREEN)✔ images built$(RESET)"

up: ## Start mongo + api + web
	$(DC) up -d --build mongo api web
	@echo -e "$(GREEN)✔ up: web http://localhost:$(WEB_PORT)  api http://localhost:$(API_PORT)$(RESET)"

down: ## Stop and remove containers
	$(DC) down
	@echo -e "$(GREEN)✔ down$(RESET)"

logs: ## Tail service logs
	$(DC) logs -f api web

shell: ## Interactive shell in the tooling container
	$(RUN) --no-deps tooling bash

clean: ## Remove containers, volumes, images, and build output
	$(DC) down -v --rmi local
	rm -rf engine/pkg apps/web/build apps/web/.svelte-kit
	@echo -e "$(GREEN)✔ clean$(RESET)"

.PHONY: help wasm install lock typecheck lint format test test-integration \
	quality verify dev build up down logs shell clean
