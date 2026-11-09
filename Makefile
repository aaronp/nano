.PHONY: test install ui dev puzzle
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
