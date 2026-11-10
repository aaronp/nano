// The workspace page on core: its markup and composable.ts, the platform with the worked example, and a flow through it.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()   // another test file may have already (file order differs by OS)
import { expect, test } from 'bun:test'

const { Ops } = await import('@pritzlaff/nano-core')
const { Debounce, Log, Range } = await import('@composable/bundle')
const { PlatformOps: P } = await import('@composable/platform')
await import('../src/boot-theme.ts')   // as main.ts does first: the theme is on <html> before any element upgrades
const page = await Bun.file(new URL('../public/index.html', import.meta.url)).text()
// the page first, as in a browser (module scripts run after parsing): composable.ts adds the dock's entries to it
document.body.innerHTML = page.slice(page.indexOf('<body>') + 6, page.indexOf('</body>'))
const { host } = await import('../src/composable.ts')
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

test('the puzzle prototype and port are gone: no page, nav item, dock widget or served files (they can be imported packages)', async () => {
  for (const id of ['puzzle-prototype', 'puzzle-port']) {
    for (const sel of [`a[href="#/${id}"]`, `app-route[path="/${id}"]`, `template[data-widget="${id}"]`])
      expect(document.querySelector(sel) !== null, sel).toBe(false)   // (a boolean: a failure prints the selector, not the DOM)
  }
  expect(await Bun.file(new URL('../public/puzzle-prototype/PuzzlePrototype.dc.html', import.meta.url)).exists()).toBe(false)
})

test('the dock can add every catalog type that has an element (marked for the drawer), and + Add can make every type', async () => {
  const { catalog } = await import('../src/composable.ts')
  const tagged = Object.entries(catalog).filter(([, e]) => e.tag)
  expect(tagged.length).toBeGreaterThanOrEqual(6)
  for (const [kind, e] of tagged) {
    const t = document.querySelector(`template[data-widget="${kind}"]`)!
    expect(t.innerHTML).toBe(`<${e.tag} keep=""></${e.tag}>`)   // closing sends it to the rack
    expect(t.hasAttribute('data-catalog')).toBe(true)
  }
  const kinds = (await call('platform', P.catalog)).value
  expect(kinds).toEqual(expect.arrayContaining(['range', 'log', 'component-list', 'connection-board']))
})

test('wires:open-panel reopens a rack component as a dock panel showing that instance', async () => {
  const dock = document.querySelector('workspace-dock') as HTMLElement & { addWidget?: (id: string, name?: string) => void }
  const opened: unknown[] = []
  dock.addWidget = (id, name) => { opened.push([id, name]) }
  dock.dispatchEvent(new CustomEvent('wires:open-panel', { bubbles: true, composed: true, detail: { kind: 'range', name: 'ex-range' } }))
  expect(opened).toEqual([['range', 'ex-range']])
})

test('the Workspace dock sits inside <c-wires>, which has the host runtime and the merged catalog', async () => {
  const { catalog } = await import('../src/composable.ts')
  const wires = document.querySelector('app-route[path="/workspace"] c-wires') as HTMLElement & { runtime?: unknown; catalog?: unknown; flipped?: boolean; updateComplete?: Promise<boolean> }
  expect(wires).not.toBeNull()
  expect(wires.querySelector(':scope > workspace-dock')).not.toBeNull()
  expect(wires.runtime).toBe(host)
  expect(wires.catalog).toBe(catalog)
  wires.querySelector('workspace-dock')!.dispatchEvent(new CustomEvent('dock:connections', { bubbles: true, composed: true }))
  await wires.updateComplete
  expect(wires.flipped).toBe(true)
})

test('the nav has a Workspaces group with + and Main, and no component items; Main is a drawer beside its dock', () => {
  const group = document.querySelector('app-shell > [data-workspaces]')!
  expect(group.querySelector('a')!.getAttribute('href')).toBe('#/workspace')
  expect(group.querySelector('button[data-new-workspace]')).not.toBeNull()
  expect(group.nextElementSibling!.textContent!.trim()).toBe('Main')
  expect([...document.querySelectorAll('a[slot="nav"]')].filter(a => a.textContent!.trim().startsWith('+'))).toEqual([])
  expect(document.querySelector('app-route[path="/workspace"] .ws-page > component-drawer')!.getAttribute('for')).toBe('workspace')
})

test('a package\'s catalog joins the running host: the platform can make it, Main\'s dock can add it, its names are taken', async () => {
  const { addCatalog, loadedNames } = await import('../src/composable.ts')
  const { component, state } = await import('@pritzlaff/nano-runes')
  const Timer = component('nano.template/timer', () => { const s = state({ count: 0 }); return { get count() { return s.count } } }, { count: (await import('typebox')).Type.Number({ description: 'The count' }) })
  let changed = 0
  document.addEventListener('catalog:changed', () => { changed++ })
  addCatalog({ timer: { component: Timer, title: 'Timer', tag: 'nano-timer' } }, { name: 'nano-template', url: 'https://x/manifest.json' })
  expect(changed).toBe(1)
  expect(await call('platform', P.createComponent, { kind: 'timer', name: 't1', system: 'host' })).not.toHaveProperty('error')
  expect(host.registry.get('t1')!.component).toBe(Timer)
  const t = document.querySelector('workspace-dock#workspace > template[data-widget="timer"]') as HTMLTemplateElement
  expect([t.dataset.title, t.dataset.package, t.dataset.packageUrl, t.hasAttribute('data-catalog')]).toEqual(['Timer', 'nano-template', 'https://x/manifest.json', true])
  const names = loadedNames()
  expect(names.kinds).toContain('timer'); expect(names.ids).toContain('nano.template/timer'); expect(names.tags).toContain('nano-timer')
  expect(names.kinds).toContain('range')
})

test('the names an import must not take include the page\'s own widgets', async () => {
  const { loadedNames } = await import('../src/composable.ts')
  expect(loadedNames().kinds).toEqual(expect.arrayContaining(['notes', 'chart', 'activity', 'range']))
})

test('importing a package republishes the platform\'s kinds', async () => {
  const { addCatalog } = await import('../src/composable.ts')
  const { Components: C, Ops: O } = await import('@pritzlaff/nano-core')
  const heard: { kind: string }[][] = []
  const spy = C.create({ ns: 't', name: 'kinds-spy' }, () => heard)
  spy.action(O.sink('t', 'take', P.kinds.output!), (h, x) => { h.push(x as { kind: string }[]) })
  host.registry.add('kinds-spy', C.instantiate(spy))
  host.registry.subscribe({ source: 'platform', op: O.key(P.kinds), listener: 'kinds-spy', target: 't/take' })
  addCatalog({ clock: { component: C.create({ ns: 't', name: 'clock' }, () => ({})), title: 'Clock' } }, { name: 'clocks', url: 'https://x/clocks.json' })
  await new Promise(r => setTimeout(r, 0))
  expect(heard.at(-1)?.map(k => k.kind)).toContain('clock')
})

test('the example wiring still connects, with every op typed and described', () => {
  const wired = host.registry.snapshot().subscriptions.filter(s => !s.listener.includes('~view') && s.listener !== 'kinds-spy')
  expect(wired.map(s => `${s.source}→${s.listener}`).sort()).toEqual(['ex-debounce→ex-log', 'ex-input→ex-map', 'ex-map→ex-log', 'ex-range→ex-debounce'])
})
