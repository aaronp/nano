/**
 * The nano-app CLI's server: the app, the project folder and the build folder on loopback, one writable file, rebuild events.
 * GET precedence: the app first (index.html at `/`, and only files the app has, so a project file can never shadow `/main.js`),
 * then the project folder, then `out`. Every candidate is resolved and must stay inside its root.
 */
import { rename, stat, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

export interface Options {
  app: string; project: string; out: string;
  /** The project-relative URL path of the opened file, e.g. `/nano.json`: the page's meta names it and it is the only PUT target. */
  file: string;
  port: () => number;
  events: { subscribe(controller: ReadableStreamDefaultController<Uint8Array>): void };
}

const isFile = (p: string) => stat(p).then(s => s.isFile(), () => false);
/** `root`/`path` if it stays inside `root`, else undefined. */
const inside = (root: string, path: string) => { const f = resolve(root, '.' + path); return f.startsWith(resolve(root) + sep) ? f : undefined; };
const text = (s: string, status: number, type = 'text/plain') => new Response(s, { status, headers: { 'content-type': type } });

export function handler(o: Options): (req: Request) => Promise<Response> {
  return async req => {
    const url = new URL(req.url);
    const p0 = req.headers.get('host'), port = o.port();
    if (!p0 || ![`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(p0)) return text('Forbidden host', 403);
    let path: string;
    try { path = decodeURIComponent(url.pathname); } catch { return text('Not found', 404); }
    if (path.includes('\0') || path.split('/').includes('..')) return text('Not found', 404);

    if (req.method === 'PUT') {
      // No preflight is ever answered, so a cross-site page cannot get here.
      const target = path === o.file ? inside(o.project, path) : undefined;
      if (!target || !(await isFile(target))) return text('Not writable', 403);
      try {
        const tmp = `${target}.nano-app-tmp`;
        await writeFile(tmp, new Uint8Array(await req.arrayBuffer()));
        await rename(tmp, target);   // whole file or nothing
        return new Response(null, { status: 204 });
      } catch (e) { return text(e instanceof Error ? e.message : String(e), 500); }
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return text('Method not allowed', 405);

    if (path === '/__nano-app/events') {
      const body = new ReadableStream<Uint8Array>({ start: c => o.events.subscribe(c) });
      return new Response(body, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } });
    }
    if (path === '/') {
      const html = await Bun.file(join(o.app, 'index.html')).text();
      const meta = `<meta name="nano-app-file" content="${o.file.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">`;
      return text(/<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => m + meta) : meta + html, 200, 'text/html; charset=utf-8');
    }
    for (const root of [o.app, o.project, o.out]) {
      const f = inside(root, path);
      if (f && await isFile(f)) {
        const type = extname(f) === '.json' ? 'application/json' : Bun.file(f).type;
        return new Response(Bun.file(f), { headers: { 'content-type': type, 'cache-control': 'no-store' } });
      }
    }
    return text('Not found', 404);
  };
}
