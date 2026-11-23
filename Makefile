.PHONY: adr agile test test-ui install ui dev dev2 serve-template serve-examples link-templates packages smoke publish template-check template-export
ifdef TMPDIR
export BUN_TMPDIR := $(TMPDIR)
export BUN_INSTALL_CACHE_DIR := $(TMPDIR)/bun-cache
endif

# Each package's tests in its own folder (its own bunfig preloads), stopping at the first that fails.
test:
	@for p in packages/*/; do echo "== $$p"; (cd $$p && bun test --isolate) || exit 1; done

# Browser tests (e2e/*.e2e.ts) in your Chrome; starts `make ui` unless it is running.
test-ui:
	bunx playwright test

install:
	bun install

# Build the ui-workspace host and serve it (PORT=3000 by default).
PORT ?= 3000
ui:
	@cd packages/ui-workspace && bun ../../scripts/quiet.ts bun run --silent build
	@bun scripts/serve.ts packages/ui-workspace/public $(PORT)

# Like ui, but rebuilds on every source change and reloads the page.
dev:
	@cd packages/ui-workspace && bun ../../scripts/quiet.ts bun run --silent build
	@(cd packages/ui-workspace && bun ../../scripts/quiet.ts bun run --silent dev) & trap 'kill $$!' EXIT; bun scripts/serve.ts packages/ui-workspace/public $(PORT) --live

# The second host (packages/host-react) with the workspace, same origin and storage: dev, opened at /react/.
dev2:
	@echo "second host: http://localhost:$(PORT)/react/   (workspace: http://localhost:$(PORT)/)"
	@$(MAKE) --no-print-directory dev PORT=$(PORT)

# Build the template package and serve dist/ at http://localhost:5174 (TEMPLATE_PORT) to look at it. `make ui` imports it
# from its own origin: /examples/template/nano.json (the host build copies the template there).
TEMPLATE_PORT ?= 5174
serve-template:
	$(MAKE) -C templates/nano-template serve PORT=$(TEMPLATE_PORT)

# Build examples/dist (each example, the template, and all of them in one nano.json) and serve it at :4310 (away from Vite's 517x).
EXAMPLES_PORT ?= 4310
serve-examples:
	cd examples && bun scripts/build.ts && bun scripts/serve.ts $(EXAMPLES_PORT)

# Point the templates' @pritzlaff/nano-* at this repo's packages (after a `bun install` in each).
link-templates:
	bun scripts/link-local.ts templates/nano-template

# Build the published packages (@pritzlaff/nano-core, -elements, -ui) into packages/*/dist, ready for npm.
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
	@for p in nano elements ui; do \
	  name=$$(node -p "require('./packages/$$p/dist/package.json').name"); \
	  version=$$(node -p "require('./packages/$$p/dist/package.json').version"); \
	  if npm view "$$name@$$version" version >/dev/null 2>&1; then echo "$$name@$$version is already published"; continue; fi; \
	  echo "publishing $$name@$$version as $$(npm whoami)"; \
	  npm publish "packages/$$p/dist" --access public $(if $(OTP),--otp=$(OTP)) || exit 1; \
	done

# Test and build templates/nano-template against the libraries in this commit (not the published ones).
template-check:
	bun scripts/template-check.ts

# Mirror templates/nano-template to github.com/aaronp/nano-template (main) as one commit, with your git credentials.
template-export:
	scripts/template-export.sh https://github.com/aaronp/nano-template.git

# The decision ledger (docs/adr/decisions.md) and the task board (docs/board/board.md), each served in the browser.
# Edits made in the viewer are not written back: download and save over the file, then commit it.
adr:
	bun run adr

agile:
	bun run agile

# >>> @pritzlaff/project — managed by `project add/remove/update`; edits inside are overwritten
.PHONY: snapshot dashboard risks
snapshot: ; npx project snapshot
dashboard: ; npx project build
risks: ; npx risk-register docs/risks/risks.md
# <<< @pritzlaff/project
