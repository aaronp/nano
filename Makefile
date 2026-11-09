.PHONY: test install ui dev puzzle packages smoke publish
ifdef TMPDIR
export BUN_TMPDIR := $(TMPDIR)
export BUN_INSTALL_CACHE_DIR := $(TMPDIR)/bun-cache
endif

test:
	bun test

install:
	bun install

# Build the ui-workspace host and serve it (PORT=3000 by default).
PORT ?= 3000
ui:
	cd packages/ui-workspace && bun run build
	bun scripts/serve.ts packages/ui-workspace/public $(PORT)

# Like ui, but rebuilds on every source change and reloads the page.
dev:
	cd packages/ui-workspace && bun run build
	(cd packages/ui-workspace && bun run dev) & trap 'kill $$!' EXIT; bun scripts/serve.ts packages/ui-workspace/public $(PORT) --live

# The puzzle editor: the same host, on its Connections page.
puzzle:
	@echo "Puzzle editor: http://localhost:$(PORT)/#/connections"
	@$(MAKE) --no-print-directory ui PORT=$(PORT)

# Build the published packages (@pritzlaff/nano-core, -runes, -elements) into packages/*/dist, ready for npm.
packages:
	bun scripts/build-packages.ts

# Install the built packages into a scratch folder as a stranger would, type-check and run a consumer.
smoke: packages
	bun scripts/smoke-packages.ts

# Publish the built packages to npm from this machine (after `npm login`; with 2FA, npm asks for a code, or pass
# OTP=123456). Builds and smoke-tests first; a version
# already on npm is skipped. CI publishes the same way on a v* tag (publish.yml), with provenance.
publish: smoke
	@npm whoami >/dev/null 2>&1 || { echo "Not logged in to npm: run 'npm login' first."; exit 1; }
	@for p in core runes elements; do \
	  name=$$(node -p "require('./packages/$$p/dist/package.json').name"); \
	  version=$$(node -p "require('./packages/$$p/dist/package.json').version"); \
	  if npm view "$$name@$$version" version >/dev/null 2>&1; then echo "$$name@$$version is already published"; continue; fi; \
	  echo "publishing $$name@$$version as $$(npm whoami)"; \
	  npm publish "packages/$$p/dist" --access public $(if $(OTP),--otp=$(OTP)) || exit 1; \
	done
