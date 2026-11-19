// The Ring page (#/ring): the shared time bar and <nano-ring>, handed the page's time machine; and the factory that
// rebuilds the host's app for it, its own `deploy` bound to the rebuilt app, every deployment allowed.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { expect, test } from 'bun:test'
import { Application, AppDeployment, Registry, type NanoResult } from '@pritzlaff/nano-core'
import uiProvider, { memoryStore, timeMachine, type Ticker } from '@pritzlaff/nano-ui'
import { hand } from '../src/boot-wiring.ts'
import { deployPod, hostProvider } from '../src/host-deploy.ts'
import { shadowCreate } from '../src/history.ts'

const page = await Bun.file(new URL('../public/index.html', import.meta.url)).text()
const route = (path: string) => page.match(new RegExp(`<app-route path="${path}"[^>]*>([\\s\\S]*?)</app-route>`))![1]!
const ticker: Ticker = { now: () => 0, frame: () => () => {} }

test('the #/ring page has the bar and nano-ring, handed the page\'s tm', async () => {
  for (const p of ['/desk', '/messages', '/ring']) {
    document.body.innerHTML = route(p)
    expect([...document.querySelectorAll('nav.wiring-views a')].map(a => a.textContent)).toEqual(['Connections', 'Desk', 'Messages', 'Ring'])
    expect(document.querySelector('nav.wiring-views [aria-current="page"]')!.getAttribute('href')).toBe(`#${p}`)
  }
  document.body.innerHTML = route('/ring')
  const store = memoryStore(), tm = await timeMachine({ store, listen: () => () => {} }, { ticker })
  const driver = { driving: null }, ring = { app: {}, registry: {}, create: async () => undefined, show: () => true, views: { 'example.raft/node': 'raft-glyph' } }
  hand(document, { tm, store, driver }, ring)
  const bar = document.querySelector('nano-time-machine') as unknown as Record<string, unknown>
  const el = document.querySelector('nano-ring') as unknown as Record<string, unknown>
  expect(bar).toMatchObject({ tm, store, driver })
  expect(el).toMatchObject({ tm, store, ...ring })
})

test('the shadow factory binds its own deploy to the rebuilt app and allows every deployment', async () => {
  const registry = Registry.create()
  let live: Application | undefined
  registry.add(uiProvider); registry.add(hostProvider(() => live!))
  const d: AppDeployment = { pods: { deploy: deployPod }, runtimes: { main: { pods: ['deploy'], subscriptions: [] } } }
  const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
  live = must(await Application.create(must(AppDeployment.assemble(d, registry)), { deploymentPolicy: { isAllowed: () => ({ approved: false, reason: 'no' }) } }))
  const shadow = must(await shadowCreate(registry)(d))
  const r = await (shadow.call('main', 'deploy') as unknown as { deploy(a: unknown): Promise<{ ok: boolean }> }).deploy({ pods: {}, runtimes: { x: { pods: [], subscriptions: [] } } })
  expect(r.ok).toBe(true)
  expect(Object.keys(shadow.deployment().runtimes)).toEqual(['main', 'x'])
  expect(Object.keys(live.deployment().runtimes)).toEqual(['main'])
  await shadow.close(); await live.close()
})
