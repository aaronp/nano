// The dock deploys through the strategy: a panel's mode picks <c-sandboxed>, <c-sandboxed> creates its instance, and the mode is saved.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { expect, test } from 'bun:test'

const { Registries, Runtimes } = await import('@pritzlaff/nano-core')
const { provide } = await import('@pritzlaff/nano-elements')
const { catalog: bundle } = await import('@composable/bundle')
const { deploy } = await import('../src/sandbox/deploy.ts')
const { defineSandboxed, provideDeploy } = await import('../src/sandbox/sandboxed-el.ts')
const { panelState, readWidgetMode } = await import('../src/lib/dock-layout.ts')
const { panelContent, withMode } = await import('../src/lib/panel-content.ts')
const tick = () => new Promise(r => setTimeout(r, 0))
const cat = {
  range: { ...bundle.range!, modes: ['host', 'isolated-sandbox'], trust: 'trusted', source: { url: 'https://x.test/p.js' } },
  boxed: { ...bundle.range!, modes: ['isolated-sandbox', 'sandbox'], trust: 'sandboxed', source: { url: 'https://x.test/p.js' } },
} as never
const opened: unknown[] = []
const open = ((o: unknown) => { opened.push(o); return { port: new MessageChannel().port1, ready: new Promise<void>(() => {}), dispose() {}, element: document.createElement('iframe') } }) as never

const setup = () => {
  const rt = Runtimes.create(Registries.create('host'))
  provide(document, rt.registry)
  provideDeploy(document, (_r, id, kind, mode, owner) => deploy(rt, id, kind, mode as never, { catalog: cat, open, owner }))
  defineSandboxed()
  return rt
}

test('a panel whose state has a non-host mode shows <c-sandboxed name> and deploys that way', async () => {
  const rt = setup()
  const t = document.createElement('template'); t.innerHTML = '<c-range keep></c-range>'
  const content = withMode(panelContent(document, t), 'range', readWidgetMode({ widget: 'range', mode: 'isolated-sandbox' }), 'r1')
  const el = content.firstElementChild!
  expect(el.localName).toBe('c-sandboxed')
  expect(['kind', 'mode', 'name'].map(a => el.getAttribute(a))).toEqual(['range', 'isolated-sandbox', 'r1'])
  document.body.replaceChildren(content); await tick()
  expect(rt.registry.labels('r1')['nano/deploy']).toBe('isolated-sandbox')
  expect(opened.length).toBe(1)
  expect((el as HTMLElement & { note?: string }).note).toBeUndefined()   // found the frame through the guard wrapper
})

test('a panel for an existing instance labelled nano/deploy≠host shows <c-sandboxed>', () => {
  const rt = setup()
  deploy(rt, 'r2', 'range', 'isolated-sandbox', { catalog: cat, open })
  const mode = rt.registry.labels('r2')['nano/deploy']
  const t = document.createElement('template'); t.innerHTML = '<c-range keep></c-range>'
  expect(withMode(panelContent(document, t), 'range', mode, 'r2').firstElementChild!.localName).toBe('c-sandboxed')
  expect(withMode(panelContent(document, t), 'range', 'host', 'r2').firstElementChild!.localName).toBe('c-range')
  expect(withMode(panelContent(document, t), 'range', undefined, 'r2').firstElementChild!.localName).toBe('c-range')
})

test('the mode is saved in the panel state and restored', () => {
  expect(panelState('range', { model: 'r1', mode: 'sandbox' } as never)).toEqual({ widget: 'range', name: 'r1', mode: 'sandbox' })
  expect(panelState('range', { model: 'r1' })).toEqual({ widget: 'range', name: 'r1' })
  expect(readWidgetMode({ widget: 'range', mode: 'sandbox' })).toBe('sandbox')
  expect(readWidgetMode({ widget: 'range' })).toBeUndefined()
})

test('palette adds use the kind\'s first allowed mode', async () => {
  const rt = setup()
  // a sandboxed kind's template carries its first mode; the panel keeps it, names itself, and saves it
  const t = document.createElement('template'); t.innerHTML = '<c-sandboxed keep kind="boxed" mode="isolated-sandbox"></c-sandboxed>'
  const content = withMode(panelContent(document, t), 'boxed', undefined)
  const el = content.firstElementChild as HTMLElement & { name?: string }
  document.body.replaceChildren(content); await tick()
  expect(rt.registry.labels(el.name!)['nano/deploy']).toBe('isolated-sandbox')
  expect(panelState('boxed', el as never)).toEqual({ widget: 'boxed', name: el.name, mode: 'isolated-sandbox' })
})

test('deployIn deploys into the host, into a platform system, and errors for a registry nobody owns', async () => {
  const { deployIn } = await import('../src/sandbox/deploy.ts')
  const { Components, Ops } = await import('@pritzlaff/nano-core')
  const { platform, PlatformOps: P } = await import('@composable/platform')
  const host = Runtimes.create(Registries.create('host'))
  host.registry.add('platform', Components.instantiate(platform(host, bundle as never)))
  await host.call({ registry: 'host', instance: 'workspace' }, 'platform', Ops.key(P.createSystem), 'lab')
  const lab = (host.registry.get('platform')!.value as { systems: Map<string, { registry: typeof host.registry }> }).systems.get('lab')!
  expect(deployIn(host, cat, host.registry, 'a', 'range', 'host')).toEqual({ value: undefined })
  expect(host.registry.get('a')).toBeDefined()
  expect(deployIn(host, cat, lab.registry, 'b', 'range', 'host')).toEqual({ value: undefined })
  expect(lab.registry.get('b')).toBeDefined(); expect(host.registry.get('b')).toBeUndefined()
  const foreign = Registries.create('foreign')
  expect(deployIn(host, cat, foreign, 'c', 'range', 'host')).toEqual({ error: 'no runtime for registry foreign' })
  expect(host.registry.get('c')).toBeUndefined()
  const imposter = Registries.create('lab')   // same id as a platform system, not its registry
  expect(deployIn(host, cat, imposter, 'd', 'range', 'host')).toEqual({ error: 'no runtime for registry lab' })
  expect(lab.registry.get('d')).toBeUndefined(); expect(imposter.get('d')).toBeUndefined()
})
