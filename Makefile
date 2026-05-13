# openclaw-hawkins — operator + developer Makefile.
# Thin wrapper over npm scripts so adopters get a consistent surface even
# without remembering the npm script names. Run `make help` for the catalog.

.DEFAULT_GOAL := help

## ----------------------------------------------------------------------------
## Help
## ----------------------------------------------------------------------------

.PHONY: help
help: ## Show this help.
	@awk 'BEGIN {FS = ":.*?## "} \
	  /^## ----/ {next} \
	  /^## / {section = substr($$0, 4); printf "\n  \033[1m%s\033[0m\n", section; next} \
	  /^[a-zA-Z0-9_.-]+:.*?## / {printf "    \033[36m%-20s\033[0m %s\n", $$1, $$2}' \
	  $(MAKEFILE_LIST)
	@echo ""

## ----------------------------------------------------------------------------
## Setup
## ----------------------------------------------------------------------------

.PHONY: install
install: ## Install npm dependencies (clean install if package-lock present).
	@if [ -f package-lock.json ]; then npm ci; else npm install; fi

.PHONY: build
build: ## Compile TypeScript into dist/.
	npm run build

.PHONY: watch
watch: ## Recompile on change.
	npm run watch

## ----------------------------------------------------------------------------
## Quality
## ----------------------------------------------------------------------------

.PHONY: test
test: ## Run the test suite once.
	npm test

.PHONY: coverage
coverage: ## Run tests with coverage; fails under thresholds.
	npm run coverage

.PHONY: smoke
smoke: ## Run smoke tests against real services (gated on env vars; see tests/smoke/).
	npm run smoke

.PHONY: lint
lint: ## Run eslint.
	npm run lint

.PHONY: format
format: ## Auto-format with prettier + apply eslint --fix.
	npm run format
	npx eslint --fix src tests

.PHONY: format-check
format-check: ## Check formatting only (CI-friendly).
	npm run format:check

.PHONY: typecheck
typecheck: ## Run tsc --noEmit.
	npm run typecheck

.PHONY: check
check: lint format-check typecheck test ## All quality gates in one shot.

## ----------------------------------------------------------------------------
## Specialists + Database
## ----------------------------------------------------------------------------

.PHONY: setup-agents
setup-agents: ## Create the 6 OpenClaw specialist agents on this host.
	./scripts/setup.sh

.PHONY: bootstrap-db
bootstrap-db: ## Apply vines/schema.sql via the configured MARIADB_URL.
	./scripts/bootstrap-vines-db.sh

.PHONY: init-db
init-db: build ## Apply vines/schema.sql via the Node CLI (alternative to bootstrap-db).
	node dist/cli.js init-db

## ----------------------------------------------------------------------------
## House-keeping
## ----------------------------------------------------------------------------

.PHONY: clean
clean: ## Remove caches, build artefacts, and node_modules.
	rm -rf dist coverage .vitest-cache .eslintcache node_modules
