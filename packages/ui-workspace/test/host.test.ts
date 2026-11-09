// The workspace page on core: its markup and composable.ts, the platform with the worked example, and a flow through it.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
GlobalRegistrator.register()
import { expect, test } from 'bun:test'

const { Ops } = await import('@composable/core')
const { Debounce, Log, Range } = await import('@composable/bundle')
const { PlatformOps: P } = await import('@composable/platform')
const page = await Bun.file(new URL('../public/index.html', import.meta.url)).text()
const { host } = await import('../src/composable.ts')
document.body.innerHTML = page.slice(page.indexOf('<body>') + 6, page.indexOf('</body>'))
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))
const me = { registry: 'host', instance: 'test' }
const call = (id: string, op: any, arg: unknown = null) => host.call(me, id, Ops.key(op), arg) as Promise<any>

test('the platform lists the host system with the worked example, wired', async () => {
  await tick()
  const [hostSystem] = (await call('platform', P.systems)).value
  expect(hostSystem.id).toBe('host')
  const ids = hostSystem.instances.map((i: any) => i.id)
  expect(ids).toEqual(expect.arrayContaining(['platform', 'ex-range', 'ex-debounce', 'ex-log', 'ex-input', 'ex-map']))
  expect(hostSystem.subscriptions.filter((s: any) => !s.listener.includes('~view'))).toHaveLength(4)   // views subscribe too
})

test('moving the example range flows through the debounce into the log', async () => {
  await call('ex-debounce', Debounce.ops.setQuiet, 10)
  await call('ex-range', Range.ops.set, 7); await call('ex-range', Range.ops.set, 8)
  await tick(40)
  const entries = (await call('ex-log', Log.ops.entries)).value
  expect(entries.at(-1).value).toEqual([7, 8])
})

test('the page elements attach to the example instead of making their own', async () => {
  await tick()
  const el = document.querySelector('c-range[name="ex-range"]')
  expect(el).not.toBeNull()
  expect(host.registry.snapshot().instances.filter(i => i.id === 'ex-range')).toHaveLength(1)
})

test('<puzzle-prototype> shows the original prototype page, served beside the app', async () => {
  await import('../src/components/puzzle-prototype.ts')
  const el = document.createElement('puzzle-prototype')
  document.body.append(el)
  const frame = el.shadowRoot!.querySelector('iframe')!
  expect(frame.getAttribute('src')).toBe('./puzzle-prototype/PuzzlePrototype.dc.html')
  for (const f of ['PuzzlePrototype.dc.html', 'support.js', 'vendor/react.js', 'vendor/react-dom.js'])
    expect(await Bun.file(new URL(`../public/puzzle-prototype/${f}`, import.meta.url)).exists()).toBe(true)
  expect(document.querySelector('a[href="#/puzzle-prototype"]')).not.toBeNull()
  el.remove()
})
