/** Serves dist/ for the preview: `bun scripts/serve.ts [port]` (default 4000). Any origin may fetch from it, so a
 * host on another port can import the package from its manifest. */
import { join, normalize } from 'node:path'

const dist = join(import.meta.dir, '..', 'dist'), port = Number(process.argv[2] ?? 4000)
const server = Bun.serve({
  port,
  async fetch(req) {
    const path = normalize(decodeURIComponent(new URL(req.url).pathname)).replace(/^(\.\.[/\\])+/, '')
    const file = Bun.file(join(dist, path === '/' ? 'index.html' : path))
    const cors = { 'access-control-allow-origin': '*' }
    return (await file.exists()) ? new Response(file, { headers: cors }) : new Response('not found', { status: 404, headers: cors })
  },
})
console.log(`preview at ${server.url}`)
