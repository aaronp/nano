/** Serve a folder of static files: `bun scripts/serve.ts <dir> [port] [--live]`. Unknown paths get index.html.
 * With --live, pages reload themselves whenever a file in the folder changes. */
import { readdirSync, statSync } from 'node:fs'
import { join, normalize } from 'node:path'

const args = process.argv.slice(2), live = args.includes('--live')
const [dir = '.', port = '3000'] = args.filter(a => a !== '--live')
const RELOAD = `<script>new EventSource('/__live').onmessage = () => location.reload()</script>`

// live reload: each page holds an event stream open; a change in the folder tells them all to reload
const clients = new Set<ReadableStreamDefaultController>()
// ponytail: polls modification times every 300ms (file-change events don't reach every environment); fine for a small folder
const stamp = () => readdirSync(dir, { recursive: true }).reduce((n, f) => { try { return n + statSync(join(dir, String(f))).mtimeMs } catch { return n } }, 0)
if (live) {
  let last = stamp(), changedAt = 0
  setInterval(() => {
    const now = stamp()
    if (now !== last) { last = now; changedAt = Date.now() }
    else if (changedAt && Date.now() - changedAt >= 100) { changedAt = 0; clients.forEach(c => c.enqueue('data: reload\n\n')) }   // once it has settled
  }, 300)
}
const stream = () => {
  let me: ReadableStreamDefaultController
  return new Response(new ReadableStream({ start(c) { me = c; clients.add(c); c.enqueue(': live\n\n') }, cancel() { clients.delete(me) } }),
    { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } })
}

const server = Bun.serve({
  port: Number(port),
  idleTimeout: 0,   // keeps the live-reload streams open
  async fetch(req) {
    const path = normalize(decodeURIComponent(new URL(req.url).pathname)).replace(/^(\.\.[/\\])+/, '')
    if (live && path === '/__live') return stream()
    const found = Bun.file(join(dir, path === '/' ? 'index.html' : path))
    const file = (await found.exists()) ? found : Bun.file(join(dir, 'index.html'))
    // any origin may fetch: an isolated-sandbox iframe (an opaque origin) loads boot.js and the shared modules from here
    const cors = { 'access-control-allow-origin': '*' }
    if (live && file.type.startsWith('text/html')) return new Response((await file.text()).replace('</body>', RELOAD + '</body>'), { headers: { 'content-type': file.type, ...cors } })
    return new Response(file, { headers: cors })
  },
})
console.log(`\n  nano  serving ${dir}${live ? ', rebuilding and reloading on change' : ''}\n\n  ➜  Local:   ${server.url}\n  ➜  press Ctrl+C to stop\n`)
