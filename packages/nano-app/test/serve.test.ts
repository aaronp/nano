import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handler } from '../src/serve.ts';
import { watch } from '../src/watch.ts';

let root: string, h: (r: Request) => Promise<Response>;
const req = (path: string, init: RequestInit & { host?: string } = {}) =>
  h(new Request('http://127.0.0.1:9' + path, { ...init, headers: { host: init.host ?? '127.0.0.1:9' } }));
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'nano-app-'));
  for (const d of ['app', 'project', 'out']) mkdirSync(join(root, d));
  writeFileSync(join(root, 'app/index.html'), '<!doctype html><html><head><title>x</title></head></html>');
  writeFileSync(join(root, 'app/main.js'), 'app main');
  writeFileSync(join(root, 'project/main.js'), 'project main');
  writeFileSync(join(root, 'project/nano.json'), '{}');
  writeFileSync(join(root, 'project/other.json'), '{}');
  writeFileSync(join(root, 'out/index.js'), 'out index');
  writeFileSync(join(root, 'secret'), 'no');
  h = handler({ app: join(root, 'app'), project: join(root, 'project'), out: join(root, 'out'), file: '/nano.json', port: () => 9, events: { subscribe() {} } });
});
afterAll(() => void Bun.spawnSync(['rm', '-rf', root]));

test('the page is the app index with the meta', async () => {
  const r = await req('/');
  expect(r.headers.get('content-type')).toContain('text/html');
  expect(await r.text()).toContain('<head><meta name="nano-app-file" content="/nano.json"><title>');
});
test('app files win, then the project, then out', async () => {
  expect(await (await req('/main.js')).text()).toBe('app main');
  expect(await (await req('/nano.json')).text()).toBe('{}');
  expect(await (await req('/index.js')).text()).toBe('out index');
});
test('a foreign Host is 403', async () => expect((await req('/', { host: 'evil.com:9' })).status).toBe(403));
test('escaping the project is 404', async () => {
  for (const p of ['/../secret', '/%2e%2e/secret', '/..%2fsecret', '/%2e%2e%2fsecret']) expect((await req(p)).status).toBe(404);
});
test('PUT replaces the opened file only', async () => {
  expect((await req('/nano.json', { method: 'PUT', body: '{"a":1}' })).status).toBe(204);
  expect(readFileSync(join(root, 'project/nano.json'), 'utf8')).toBe('{"a":1}');
  expect(readdirSync(join(root, 'project')).some(f => f.includes('tmp'))).toBe(false);
  for (const p of ['/other.json', '/missing.json', '/main.js']) expect((await req(p, { method: 'PUT', body: 'x' })).status).toBe(403);
});
test('OPTIONS is 405 with no CORS headers', async () => {
  const r = await req('/nano.json', { method: 'OPTIONS' });
  expect(r.status).toBe(405);
  expect([...r.headers.keys()].some(k => k.startsWith('access-control'))).toBe(false);
});
test('events are a stream', async () => expect((await req('/__nano-app/events')).headers.get('content-type')).toBe('text/event-stream'));
test('/index.html carries the meta too', async () => expect(await (await req('/index.html')).text()).toContain('nano-app-file'));
test('a symlink out of the project is 404, and not writable', async () => {
  symlinkSync(join(root, 'secret'), join(root, 'project/link.json'));
  expect((await req('/link.json')).status).toBe(404);
  expect((await h(new Request('http://127.0.0.1:9/link.json', { method: 'PUT', body: 'x', headers: { host: '127.0.0.1:9' } }))).status).toBe(403);
  expect(readFileSync(join(root, 'secret'), 'utf8')).toBe('no');
});
test('watch without src/ does not throw', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nano-app-w-'));
  watch(dir, ['true'], () => {})();
});
