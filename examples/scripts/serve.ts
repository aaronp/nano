/** Serves dist/: `bun scripts/serve.ts [port]` (default 4000), to look at the build on its own. A host imports an
 * app from its own origin only: build into the host's public dir (the nano host copies each to /examples/<name>/). */
import { join, normalize } from 'node:path'

const dist = join(import.meta.dir, '..', 'dist'), port = Number(process.argv[2] ?? 4000)
const server = Bun.serve({
  port,
  async fetch(req) {
    const path = normalize(decodeURIComponent(new URL(req.url).pathname)).replace(/^(\.\.[/\\])+/, '')
    const file = Bun.file(join(dist, path))
    return (await file.exists()) ? new Response(file) : new Response('not found', { status: 404 })
  },
})
console.log(`serving dist/ at ${server.url}`)
