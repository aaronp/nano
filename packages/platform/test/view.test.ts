import { expect, test } from 'bun:test'
import { Components, Ops, Registries, Runtimes } from '@pritzlaff/nano-core'
import { provide } from '@pritzlaff/nano-elements'
import { catalog, Log, Range } from '@composable/bundle'
import { definePlatform, platform, PlatformOps as P } from '../src'

definePlatform()
const tick = () => new Promise(r => setTimeout(r, 0))
type El = HTMLElement & { updateComplete: Promise<boolean> }

const mount = async () => {
  const host = Runtimes.create(Registries.create('host'))
  host.registry.add('platform', Components.instantiate(platform(host, catalog)))
  const call = (op: any, arg: unknown = null) => host.call({ registry: 'host', instance: 't' }, 'platform', Ops.key(op), arg) as Promise<any>
  await call(P.createComponent, { kind: 'range', name: 'r', system: 'host' })
  await call(P.createComponent, { kind: 'log', name: 'l', system: 'host' })
  await call(P.createSystem, 'lab')
  provide(document, host.registry)
  document.body.innerHTML = '<c-platform></c-platform>'
  const el = document.querySelector('c-platform') as El
  const settle = async () => { for (let i = 0; i < 4; i++) { await tick(); await el.updateComplete } }
  await settle()
  const $ = (sel: string) => el.shadowRoot!.querySelector(sel) as HTMLElement | null
  const $$ = (sel: string) => [...el.shadowRoot!.querySelectorAll(sel)] as HTMLElement[]
  const button = (text: string) => $$('button').find(b => b.textContent!.trim() === text)!
  const type = async (sel: string, v: string, ev = 'input') => { const i = $(sel) as HTMLInputElement; i.value = v; i.dispatchEvent(new Event(ev)); await settle() }
  // the tree's rows live in <nano-tree>'s shadow root
  const tree = () => $('nano-tree') as HTMLElement & { shadowRoot: ShadowRoot }
  const t$ = (sel: string) => tree().shadowRoot.querySelector(sel) as HTMLElement | null
  const t$$ = (sel: string) => [...tree().shadowRoot.querySelectorAll(sel)] as HTMLElement[]
  const item = (id: string) => t$(`[role="treeitem"][data-id="${id}"]`)
  const row = (id: string) => item(id)!.querySelector('.line') as HTMLElement
  return { host, el, call, settle, $, $$, button, type, tree, t$, t$$, item, row }
}

test('the filter hides what does not match', async () => {
  const { item, type } = await mount()
  expect(item('c:host/r')).not.toBeNull()
  await type('input[name="filter"]', 'warn')
  expect(item('c:host/r')).toBeNull()
  expect(item('c:host/l')).not.toBeNull()
  expect(item(`o:host/l/${Ops.key(Log.ops.warn)}`)).not.toBeNull()
})

test('systems show their components and count; components their ops (kind and types); systems start open', async () => {
  const { item, row, settle } = await mount()
  expect(item('s:host')!.getAttribute('aria-expanded')).toBe('true')
  expect(row('s:host').querySelector('.count')!.textContent).toBe('3')   // the platform, r and l
  expect(item('c:host/r')!.getAttribute('aria-expanded')).toBe('false')
  row('c:host/r').click(); await settle()
  const value = item(`o:host/r/${Ops.key(Range.ops.value)}`)!
  expect(value.querySelector('.kind')!.textContent).toBe('source')
  ;(value.querySelector('.chev') as HTMLElement).click(); await settle()
  expect(item(`o:host/r/${Ops.key(Range.ops.value)}`)!.querySelector('.body')!.textContent).toContain('→')
})

test('select an action, then connect it to a fitting one; ones that do not fit get no connect button; disconnect', async () => {
  const { host, item, row, t$, settle } = await mount()
  row('c:host/r').click(); await settle()
  row(`o:host/r/${Ops.key(Range.ops.value)}`).click(); await settle()
  ;(item('c:host/l')!.querySelector('.chev') as HTMLElement).click(); await settle()
  expect(t$(`[data-connect="host/l/${Ops.key(Log.ops.info)}"]`)).not.toBeNull()
  expect(t$(`[data-connect="host/l/${Ops.key(Log.ops.entries)}"]`)).toBeNull()
  t$(`[data-connect="host/l/${Ops.key(Log.ops.info)}"]`)!.click(); await settle()
  const linked = () => host.registry.snapshot().subscriptions.some(s => s.source === 'r' && s.listener === 'l')
  expect(linked()).toBe(true)
  const conn = t$('[data-id^="x:host/"]')!
  expect(conn.textContent).toContain('r · ')
  ;(conn.querySelector('[aria-label="Disconnect"]') as HTMLElement).click(); await settle()
  expect(linked()).toBe(false)
})

test('by component: add a component to another system', async () => {
  const { call, button, t$, settle } = await mount()
  button('By component').click(); await settle()
  t$('[data-toggle="c:r"]')!.click(); await settle()
  const pick = t$('select[name="add-to-r"]') as HTMLSelectElement
  pick.value = 'lab'; pick.dispatchEvent(new Event('change')); await settle()
  t$('[aria-label="Add r to system"]')!.click(); await settle()
  const lab = (await call(P.systems)).value[1]
  expect(lab.instances.map((i: any) => i.id)).toContain('r')
})

test('Add creates a component from the catalog', async () => {
  const { call, button, type, $, settle } = await mount()
  button('+ Add').click(); await settle()
  const kind = $('select[name="kind"]') as HTMLSelectElement
  kind.value = 'debounce'; kind.dispatchEvent(new Event('change'))
  await type('input[name="name"]', 'd1')
  button('Create').click(); await settle()
  expect((await call(P.systems)).value[0].instances.map((i: any) => i.id)).toContain('d1')
})

test('the tree lists connections, not the hidden subscriptions of views', async () => {
  const { t$$ } = await mount()
  expect(t$$('[data-id^="x:"]')).toHaveLength(0)   // <c-platform> itself subscribes to the platform, in host
})

test('by component: the add button never targets a system the component is already in', async () => {
  const { call, button, t$, settle } = await mount()
  button('By component').click(); await settle()
  t$('[data-toggle="c:r"]')!.click(); await settle()
  const pick = t$('select[name="add-to-r"]') as HTMLSelectElement
  pick.value = 'lab'; pick.dispatchEvent(new Event('change')); await settle()
  t$('[aria-label="Add r to system"]')!.click(); await settle()
  await call(P.createSystem, 'third'); await settle()
  t$('[aria-label="Add r to system"]')!.click(); await settle()   // 'lab' already holds r: this goes to 'third'
  const systems = (await call(P.systems)).value
  expect(systems[2].instances.map((i: any) => i.id)).toContain('r')
})

test('a component can be selected and unselected; a selection made elsewhere opens the tree to it, without taking focus', async () => {
  const { call, settle, item, row, tree } = await mount()
  row('c:host/r').click(); await settle()
  expect((await call(P.selected)).value).toEqual({ system: 'host', instance: 'r' })
  expect(item('c:host/r')!.getAttribute('aria-selected')).toBe('true')
  expect(item(`o:host/l/${Ops.key(Log.ops.info)}`)).toBeNull()   // l is closed
  ;(tree().shadowRoot.activeElement as HTMLElement | null)?.blur()
  await call(P.select, { system: 'host', instance: 'l', op: Ops.key(Log.ops.info) }); await settle()
  expect(item(`o:host/l/${Ops.key(Log.ops.info)}`)!.getAttribute('aria-selected')).toBe('true')
  expect(tree().shadowRoot.activeElement).toBeNull()
  row(`o:host/l/${Ops.key(Log.ops.info)}`).click(); await settle()
  expect((await call(P.selected)).value).toBeNull()
})

test('a component in several systems: a badge, "Also in" buttons that select it there, and Shared only', async () => {
  const { call, settle, item, row, t$, $, type, tree } = await mount()
  await call(P.addToSystem, { instance: 'r', from: 'host', to: 'lab' }); await settle()
  expect(item('c:host/r')!.querySelector('.tag')!.textContent).toBe('↗ 2 systems')
  expect(item('c:host/l')!.querySelector('.tag')).toBeNull()
  await type('input[name="filter"]', 'r')
  row('c:host/r')   // shown, and open while filtering
  const jump = t$('[data-also="lab/r"]')!
  expect(jump.textContent).toContain('lab')
  jump.click(); await settle()
  expect((await call(P.selected)).value).toEqual({ system: 'lab', instance: 'r' })
  expect(($('input[name="filter"]') as HTMLInputElement).value).toBe('')   // cleared, so it shows
  expect(item('c:lab/r')!.getAttribute('aria-selected')).toBe('true')
  expect((tree().shadowRoot.activeElement as HTMLElement | null)?.dataset.id).toBe('c:lab/r')   // focus follows the jump
  const shared = $('input[name="shared"]') as HTMLInputElement
  shared.checked = true; shared.dispatchEvent(new Event('change')); await settle()
  expect(item('c:host/l')).toBeNull()
  expect(item('c:host/r')).not.toBeNull()
})

test("an op's row shows its description and examples; the filter matches descriptions", async () => {
  const { item, type } = await mount()
  await type('input[name="filter"]', 'clamped into')   // only in set's description
  const set = item(`o:host/r/${Ops.key(Range.ops.set)}`)!
  expect(set.textContent).toContain(Range.ops.set.description!)
  expect(set.textContent).toContain('e.g. 42')
  expect(item(`o:host/r/${Ops.key(Range.ops.min)}`)).toBeNull()
})

test("a component's row shows its description, and the filter finds it", async () => {
  const { item, type } = await mount()
  await type('input[name="filter"]', 'between bounds')
  expect(item('c:host/r')!.textContent).toContain(catalog.range!.component.description!)
  expect(item('c:host/l')).toBeNull()
})

test('an instance owned by a view is hidden whatever its id; one named ~view but owned otherwise is shown', async () => {
  const { host, el, settle, item, t$$ } = await mount()
  const blank = () => Components.instantiate(Components.create({ ns: 't', name: 'blank' }, () => null))
  host.registry.add('watcher', blank(), { kind: 'view', name: 'some-el' })
  host.registry.add('x~view-9', blank(), { kind: 'widget', name: 'w' })
  host.registry.subscribe({ source: 'r', op: Ops.key(Range.ops.value), listener: 'watcher', target: 't/x' })
  ;(el as unknown as { requestUpdate(): void }).requestUpdate(); await settle()
  expect(!!item('c:host/watcher')).toBe(false)
  expect(!!item('c:host/x~view-9')).toBe(true)
  expect(t$$('[data-id^="x:"]')).toHaveLength(0)
})

test('the Add form offers only the kind\'s modes and selector fields, and sends them', async () => {
  const host = Runtimes.create(Registries.create('host'))
  const sent: unknown[] = []
  host.registry.add('platform', Components.instantiate(platform(host, { range: { ...catalog.range!, modes: ['isolated-sandbox'] }, log: { ...catalog.log!, modes: ['host', 'sandbox'] }, input: catalog.input! }, {
    deploy: (_rt, id, kind, mode, _o, outward) => { sent.push({ id, kind, mode, outward }); return { value: undefined } },
  })))
  provide(document, host.registry)
  document.body.innerHTML = '<c-platform></c-platform>'
  const el = document.querySelector('c-platform') as El
  const settle = async () => { for (let i = 0; i < 4; i++) { await tick(); await el.updateComplete } }
  const $ = (sel: string) => el.shadowRoot!.querySelector(sel) as HTMLInputElement | null
  const pick = async (v: string) => { const k = $('select[name="kind"]')!; k.value = v; k.dispatchEvent(new Event('change')); await settle() }
  const type = async (sel: string, v: string) => { const i = $(sel)!; i.value = v; i.dispatchEvent(new Event('input')); await settle() }
  await settle()
  ;[...el.shadowRoot!.querySelectorAll('button')].find(b => b.textContent!.trim() === '+ Add')!.click(); await settle()
  await pick('input')
  expect($('select[name="mode"]')).toBeNull()   // a kind with no modes: no choice, nothing sent
  await pick('log')
  expect([...$('select[name="mode"]')!.querySelectorAll('option')].map(o => o.textContent)).toEqual(['host', 'sandbox'])
  expect($('input[name="allow"]')).toBeNull()   // host by default: no selectors
  await pick('range')
  expect([...$('select[name="mode"]')!.querySelectorAll('option')].map(o => o.textContent)).toEqual(['isolated-sandbox'])
  await type('input[name="name"]', 'r1'); await type('input[name="allow"]', 'host/log/*, host/x/y'); await type('input[name="deny"]', 'host/platform/*')
  ;[...el.shadowRoot!.querySelectorAll('button')].find(b => b.textContent!.trim() === 'Create')!.click(); await settle()
  expect(sent).toEqual([{ id: 'r1', kind: 'range', mode: 'isolated-sandbox', outward: { allow: ['host/log/*', 'host/x/y'], deny: ['host/platform/*'] } }])
})

test('tree rows carry data-deploy; the toggle marks exactly the non-host entries, and is off by default', async () => {
  const { host, item, settle, tree, $ } = await mount()
  host.registry.label('l', { 'nano/deploy': 'isolated-sandbox' }); await settle()
  expect(item('c:host/l')!.dataset.deploy).toBe('isolated-sandbox')
  expect(item('c:host/r')!.dataset.deploy).toBe('host')
  const toggle = () => $('button.highlight')!
  expect(toggle().textContent).toBe('Highlight sandboxed')
  expect(toggle().getAttribute('aria-pressed')).toBe('false')
  expect(tree().shadowRoot.querySelectorAll('[data-mark]').length).toBe(0)
  toggle().click(); await settle()
  expect(toggle().getAttribute('aria-pressed')).toBe('true')
  expect(item('c:host/l')!.hasAttribute('data-mark')).toBe(true)
  expect(item('c:host/r')!.hasAttribute('data-mark')).toBe(false)
})
