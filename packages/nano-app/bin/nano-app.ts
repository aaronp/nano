#!/usr/bin/env bun
// nano-app <nano.json> [--out dist] [--build "bun run build"]: serve the app and the project on 127.0.0.1, open it.
// PORT picks the port (default: any free one); NO_OPEN=1 skips opening a browser.
import { existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { events } from '../src/events.ts';
import { handler } from '../src/serve.ts';
import { watch } from '../src/watch.ts';

const { values, positionals } = (await import('node:util')).parseArgs({
  args: Bun.argv.slice(2), allowPositionals: true,
  options: { out: { type: 'string', default: 'dist' }, build: { type: 'string', default: 'bun run build' } },
});
const [json] = positionals;
if (!json) { console.error('Usage: nano-app <nano.json> [--out dist] [--build "bun run build"]'); process.exit(1); }
const abs = resolve(json);
if (!existsSync(abs)) { console.error(`nano-app: cannot read ${json}`); process.exit(1); }
const project = dirname(abs);
const beside = fileURLToPath(new URL('../app', import.meta.url));
const app = existsSync(beside) ? beside : fileURLToPath(new URL('../../ui-workspace/public', import.meta.url));
const ev = events();

const server: { port?: number } = Bun.serve({
  hostname: '127.0.0.1', port: Number(process.env['PORT'] ?? 0), idleTimeout: 0,
  fetch: handler({ app, project, out: resolve(project, values.out), file: '/' + basename(abs), port: () => server.port!, events: ev }),
});
const { first } = watch(project, values.build.split(/\s+/).filter(Boolean), ev.tell);
const url = `http://127.0.0.1:${server.port}/`;
console.log(`Serving ${abs} at ${url}  (Ctrl-C to stop)`);
if (process.env['NO_OPEN'] !== '1') {
  await first;   // the page needs ./index.js and the `rebuilt` event: open it after the first build, pass or fail
  try { Bun.spawn([process.platform === 'darwin' ? 'open' : 'xdg-open', url], { stdio: ['ignore', 'ignore', 'ignore'] }).exited.catch(() => {}); } catch { /* no opener */ }
}
