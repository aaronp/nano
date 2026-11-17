// Real iframes (happy-dom): the srcdoc, the layer and its sandbox attribute, and frames disposed across rebuilds.
// happy-dom runs no frame script and drops a transferred port, so the frame's side is `serve` on the channel's port2.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: 'http://localhost:3000/app/', settings: { handleDisabledFileLoadingAsSuccess: true } })
import { afterEach, expect, test } from 'bun:test'
import { Type } from 'typebox'
import { Coord, Application, Pod, AppDeployment, Registry, Schema, Interface, Implementation, Op, provide, success, type AppEvent } from '@pritzlaff/nano-core'
import type { ViewTarget } from '@pritzlaff/nano-ui'
import { edgesFor } from '../src/sandbox/edges.ts'
import { openFrame, srcdoc } from '../src/sandbox/frames.ts'
import { serve } from '../src/sandbox/serve.ts'
import { standIn } from '../src/sandbox/stand-in.ts'

const ns = Coord.namespace('acme')

const Text = Schema.define(Type.String(), 'Text')
const Echo = Interface.define('t.Echo', { echo: Op.action(Text, Text) })
const sImpl = Implementation.define(ns.implementationId('s'), { provides: [Echo], make: () => [provide(Echo, { echo: async x => success(x) })] })
const registry = Registry.create()
registry.add(ns.provider([sImpl]))

const layer = () => document.getElementById('nano-sandbox-layer')
const iframes = () => layer()?.querySelectorAll('iframe').length ?? 0
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))

// Each channel openFrame makes: its port2 is served as the frame would serve it.
const Real = MessageChannel
let rendered: Omit<ViewTarget, 'registry'>[] = [], themed: unknown[] = []
globalThis.MessageChannel = class extends Real {
  constructor() { super(); serve(this.port2, async () => sImpl, { render: (_, t) => { rendered.push(t) }, theme: c => { themed.push(c) } }) }
}
afterEach(() => { layer()?.remove(); rendered = []; themed = [] })

async function app() {
  const rts = AppDeployment.assemble({ pods: { s: Pod.lazy(sImpl, { isolation: 'isolated-sandbox' }) }, runtimes: { r: { pods: ['s'], subscriptions: [] } } }, registry)
  if (!rts.ok) throw new Error(rts.fail.reason)
  let a: Application | undefined
  const made = await Application.create(rts.value, { isolate: (_, pod) => standIn(registry.implementation(pod.implementation)!, {
    url: 'mem:acme', open: () => openFrame('isolated-sandbox'), edges: p => edgesFor(a!.deployment(), registry, p),
    onApplied: () => () => {}, warn: () => {}, app: () => a!, readyMs: 500,
  }) })
  if (!made.ok) throw new Error(made.fail.reason)
  return (a = made.value)
}

test('srcdoc makes every import-map URL absolute and escapes <', () => {
  const doc = srcdoc({ imports: { lit: './shared/lit.js', 'x</script>': '/x.js' } }, './sandbox/boot.js', 'https://h.test/app/')
  expect(doc).toContain('"lit":"https://h.test/app/shared/lit.js"')
  expect(doc).toContain('"x\\u003c/script>":"https://h.test/x.js"')
  expect(doc.match(/<\/script>/g)).toHaveLength(2)
  expect(doc).toContain('src="https://h.test/app/sandbox/boot.js"')
})

test('openFrame gives each mode its sandbox attribute, in the one layer', () => {
  const a = openFrame('isolated-sandbox'), b = openFrame('sandbox')
  expect(a.element!.getAttribute('sandbox')).toBe('allow-scripts')
  expect(b.element!.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin')
  expect(a.element!.parentElement).toBe(layer())
  expect(iframes()).toBe(2)
  a.dispose(); b.dispose()
  expect(iframes()).toBe(0)
})

test('given build, close and build again, then the layer holds exactly one iframe', async () => {
  const a = await app()
  expect(await a.call('r', 's').echo!('x')).toEqual(success('x'))
  expect(iframes()).toBe(1)
  expect((await a.restart('s')).ok).toBe(true)   // closed; lazy, so built again by the next call
  expect(await a.call('r', 's').echo!('y')).toEqual(success('y'))
  expect(iframes()).toBe(1)
  await a.close()
  expect(iframes()).toBe(0)
})

test('given the frame renders a view, then its app calls its own pod through the host and hears its events', async () => {
  const a = await app()
  await a.call('r', 's').echo!('warm')   // built
  const t = rendered.at(-1)!, heard: AppEvent[] = []
  expect([t.runtime, t.pod]).toEqual(['r', 's'])
  t.app.listen(e => heard.push(e))
  expect(await t.app.call('r', 's').echo!('v')).toEqual(success('v'))
  expect((await t.app.call('r', 'other').echo!('v')).ok).toBe(false)
  await tick(10)
  expect(heard).toContainEqual(expect.objectContaining({ type: 'sent', to: 's', port: 't.Echo/echo' }))
  expect(heard).toContainEqual(expect.objectContaining({ type: 'delivered', result: success('v') }))
  await a.close()
})

test("given the frame's view, then get reaches its own pod's actions and refuses any other pod", async () => {
  const a = await app()
  await a.call('r', 's').echo!('warm')
  const t = rendered.at(-1)!, rt = t.app.runtime(t.runtime)
  expect(await rt.get(Echo, { pod: 's' }).echo('v')).toBe('v')
  expect(() => rt.get(Echo, { pod: 'other' })).toThrow()
  await a.close()
})

test('a frame gets the theme on <html> when it opens, and again on each theme change', async () => {
  document.documentElement.dataset['theme'] = 'enterprise'; document.documentElement.dataset['mode'] = 'dark'
  const f = openFrame('isolated-sandbox')
  f.element!.dispatchEvent(new Event('load')); await tick(5)
  expect(themed).toEqual([{ theme: 'enterprise', mode: 'dark' }])
  document.documentElement.dataset['mode'] = 'light'
  document.dispatchEvent(new CustomEvent('app-theme-change', { detail: { theme: 'enterprise', mode: 'light' } })); await tick(5)
  expect(themed.at(-1)).toEqual({ theme: 'enterprise', mode: 'light' })
  f.dispose(); const n = themed.length
  document.dispatchEvent(new CustomEvent('app-theme-change', { detail: { theme: 'enterprise', mode: 'dark' } })); await tick(5)
  expect(themed.length).toBe(n)
})
