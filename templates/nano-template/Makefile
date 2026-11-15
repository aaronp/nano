.PHONY: serve

# Build dist/ and serve it (to look at it; a host imports from its own origin, see the README).
PORT ?= 5174
serve:
	bun run build
	bun scripts/serve.ts $(PORT)
