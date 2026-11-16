/** `Application.load`: the document is checked before any module is imported; a non-ok response is not-found. */
import { expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Application } from '../src/index.ts'

const failOf = async (p: Promise<unknown>) => ((await p.catch(e => e)) as { fail: { type: string; reason: string } }).fail

test('a malformed nano.json fails invalid-input with nothing imported', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nano-load-'))
  writeFileSync(join(dir, 'mod.js'), 'globalThis.__nanoLoadImported = true; export default {}')
  for (const [i, doc] of [{ pods: {}, runtimes: 5, modules: { m: './mod.js' } }, { modules: { m: './mod.js' } },
    { pods: {}, runtimes: {}, modules: { m: './mod.js' }, extra: 1 }].entries()) {
    writeFileSync(join(dir, `nano${i}.json`), JSON.stringify(doc))
    expect((await failOf(Application.load(pathToFileURL(join(dir, `nano${i}.json`))))).type).toBe('invalid-input')
  }
  expect((globalThis as { __nanoLoadImported?: boolean }).__nanoLoadImported).toBeUndefined()
})

test('a non-ok response is not-found, carrying the status', async () => {
  const server = Bun.serve({ port: 0, fetch: () => new Response('no', { status: 404 }) })
  try {
    const fail = await failOf(Application.load(`http://localhost:${server.port}/nano.json`))
    expect(fail.type).toBe('not-found')
    expect(fail.reason).toContain('404')
  } finally { server.stop(true) }
})
