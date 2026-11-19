/**
 * The Typing example (File › Examples): every edit of the input goes to the debounce; when typing pauses (or at the
 * latest after max wait) the newest text is upper-cased by map and logged.
 */
import { expect, test } from 'bun:test'
import { Application, AppDeployment, Registry, success, type NanoResult } from '@pritzlaff/nano-core'
import uiProvider from '@pritzlaff/nano-ui'

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

test('typing "h", "hi" then pausing logs "HI" once; the file opens input, debounce and log', async () => {
  const file: AppDeployment = await Bun.file(new URL('./nano.json', import.meta.url)).json()
  expect(file.pods['debounce']!.config).toEqual({ quietMs: 1000, maxWaitMs: 4000 })
  expect((file.layout as { slots: { pod: string }[] }).slots.map(s => s.pod)).toEqual(['input', 'debounce', 'log'])
  const registry = Registry.create()
  must(registry.add(uiProvider))
  const quick = { ...file, pods: { ...file.pods, debounce: { ...file.pods['debounce']!, config: { quietMs: 20, maxWaitMs: 200 } } } }   // the same wiring, faster
  const app = must(await Application.create(must(AppDeployment.assemble(quick, registry)), {}))
  await app.call('main', 'input').change('h')
  await app.call('main', 'input').change('hi')
  await sleep(60)
  expect(await app.call('main', 'log').entries(null)).toEqual(success(['HI']))
})
