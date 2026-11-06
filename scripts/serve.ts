/** Serve a folder of static files: `bun scripts/serve.ts <dir> [port]`. Unknown paths get index.html. */
import { join, normalize } from 'node:path'

const dir = process.argv[2] ?? '.', port = Number(process.argv[3] ?? 3000)
const server = Bun.serve({
  port,
  async fetch(req) {
    const path = normalize(decodeURIComponent(new URL(req.url).pathname)).replace(/^(\.\.[/\\])+/, '')
    const file = Bun.file(join(dir, path === '/' ? 'index.html' : path))
    return (await file.exists()) ? new Response(file) : new Response(Bun.file(join(dir, 'index.html')))
  },
})
console.log(`serving ${dir} at ${server.url}`)
