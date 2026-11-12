.PHONY: serve

# Build dist/ and serve it with CORS, so a host on another origin can import http://localhost:$(PORT)/manifest.json.
PORT ?= 5175
serve:
	bun run build
	bun scripts/serve.ts $(PORT)
