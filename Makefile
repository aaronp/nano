.PHONY: test install ui
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
