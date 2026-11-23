/** The explorer: application → runtimes → pods → edges, re-rendering on apply, drilling down through nano-open. */
import { describe, expect, test } from 'bun:test'
import { Pod } from '@pritzlaff/nano-core'
import { log, map } from '../src/index.ts'
import { must, Str, db, api, slice, open, mount, tree, settle, text, pane, choose, edge } from './explorer-setup.ts'

describe('the explorer', () => {
  test('given the slice, then it lists runtime main with pods in, wait, up, out and their pipes', async () => {
    const el = await mount(await open(slice))
    await settle(el)
    const t = text(el)
    for (const s of ['main', 'in', 'wait', 'up', 'out']) expect(t).toContain(s)
    for (const p of ['in', 'wait', 'up', 'out']) (tree(el) as unknown as { reveal(id: string): void }).reveal(`s:main:${p}:0`)
    await settle(el)
    const under = (pod: string) => tree(el).shadowRoot.querySelector(`li[data-id="p:main:${pod}"]`)!.textContent!
    expect(under('in')).toContain('submit → wait.push')
    expect(under('wait')).toContain('flushed → up.map')
    expect(under('up')).toContain('map → out.log')
    expect(under('out')).not.toContain('→')
  })
  test('choosing a pod shows its details and opens nothing; its Open view fires nano-open with { runtime, pod }', async () => {
    const el = await mount(await open(edge))
    await settle(el)
    const opened: unknown[] = []
    el.addEventListener('nano-open', e => opened.push((e as CustomEvent).detail))
    await choose(el, 'api')
    expect(opened).toEqual([])
    const t = pane(el).textContent!
    for (const s of ['pod api', 'acme/api', 'host', 'lazy', 'store (acme.Store) → db']) expect(t).toContain(s)
    ;(pane(el).querySelector('button') as HTMLButtonElement).click()
    expect(opened).toEqual([{ runtime: 'r', pod: 'api' }])
  })

  test('an unconnected need is flagged; "built on → db" shows the call edge, with Open db', async () => {
    const el = await mount(await open({ ...edge, runtimes: { r: { pods: ['api', 'db'], subscriptions: [] } } }))
    await settle(el)
    await choose(el, 'api')
    expect(pane(el).querySelector('.warn')?.textContent).toBe('not connected')
    const el2 = await mount(await open(edge))
    await settle(el2)
    await choose(el2, 'built on → db')
    expect(pane(el2).textContent).toContain('call edge')
    const opened: unknown[] = []
    el2.addEventListener('nano-open', e => opened.push((e as CustomEvent).detail))
    ;(pane(el2).querySelector('button') as HTMLButtonElement).click()
    expect(opened).toEqual([{ runtime: 'r', pod: 'db' }])
  })

  test('an implementation and an interface selected (links, or a runtime\'s own aliases) show their details', async () => {
    const el = await mount(await open(edge))
    await settle(el)
    await choose(el, 'api')
    ;([...pane(el).querySelectorAll('a')].find(a => a.textContent === 'acme/api') as HTMLElement).click()
    await settle(el)
    expect(pane(el).textContent).toContain('implementation acme/api')
    ;([...pane(el).querySelectorAll('a')].find(a => a.textContent === 'acme.Store') as HTMLElement).click()   // a link selects
    await settle(el)
    expect(pane(el).textContent!.replace(/\s+/g, ' ')).toContain('save action Str → Str')
    const t = tree(el) as unknown as { reveal(id: string): void }
    t.reveal('r:r|m:acme/db'); await settle(el)
    ;(tree(el).shadowRoot.querySelector('li[data-id="r:r|m:acme/db"] > .line') as HTMLElement).click(); await settle(el)
    expect(pane(el).textContent).toContain('implementation acme/db')
    t.reveal('r:r|i:acme.Store'); await settle(el)
    ;(tree(el).shadowRoot.querySelector('li[data-id="r:r|i:acme.Store"] > .line') as HTMLElement).click(); await settle(el)
    expect(pane(el).textContent).toContain('interface acme.Store')
  })

  test('a pipe shows its source and target as links to their interfaces, with what one emits and the other takes', async () => {
    const el = await mount(await open(slice))
    await settle(el)
    await choose(el, 'submit → wait.push')
    const t = pane(el).textContent!.replace(/\s+/g, ' ')
    expect(t).toContain('nano.ui.Input/submit action, emits Any')
    expect(t).toContain('nano.ui.Debounce/push action, takes Any')
    ;([...pane(el).querySelectorAll('a')].find(a => a.textContent === 'nano.ui.Debounce') as HTMLElement).click()
    await settle(el)
    expect(pane(el).textContent).toContain('interface nano.ui.Debounce')
  })

  test('the tree lists runtimes only; a runtime lists its pods, implementations, interfaces and operations, each selecting its primary details', async () => {
    const el = await mount(await open(edge))
    await settle(el)
    const ids = () => [...tree(el).shadowRoot.querySelectorAll('li[data-id]')].map(l => l.getAttribute('data-id'))
    expect(ids()).toEqual(expect.arrayContaining(['r:r', 'r:r/pods', 'r:r/impls', 'r:r/ifaces', 'r:r/ops']))
    expect(ids().filter(i => i!.startsWith('g:') || /^[imo]:/.test(i!))).toEqual([])
    ;(tree(el) as unknown as { reveal(id: string): void }).reveal('r:r|o:acme.Store/save'); await settle(el)
    ;(tree(el).shadowRoot.querySelector('li[data-id="r:r|o:acme.Store/save"] > .line') as HTMLElement).click(); await settle(el)
    const t = pane(el).textContent!.replace(/\s+/g, ' ')
    for (const x of ['action save', 'interfaceacme.Store', 'takesStr', 'returnsStr', 'podsdb']) expect(t).toContain(x)
  })

  test('a runtime\'s details have "Delete runtime", which fires nano-delete with { runtime }, bubbling and composed', async () => {
    const el = await mount(await open(edge))
    await settle(el)
    await choose(el, 'r')
    const got: CustomEvent[] = []
    document.addEventListener('nano-delete', e => got.push(e as CustomEvent), { once: true })
    ;([...pane(el).querySelectorAll('button')].find(b => b.textContent === 'Delete runtime') as HTMLElement).click()
    expect(got.map(e => [e.detail, e.bubbles, e.composed])).toEqual([[{ runtime: 'r' }, true, true]])
  })

  test('given calls, a pod lists what it calls and is called by, op to op, and an operation its callers; a call not declared is flagged', async () => {
    const call = (target: string, declared: boolean) => ({ runtime: 'r', from: 'api', to: 'db', source: 'acme.App/save', target, declared, seen: true })
    const el = await mount({ ...await open(edge), calls: [call('acme.Store/save', true), call('acme.Store/drop', false)] })
    await settle(el)
    await choose(el, 'api')
    const t = pane(el).textContent!.replace(/\s+/g, ' ')
    expect(t).toContain('save → db.save')
    expect(t).toContain('save → db.drop not declared')
    expect(pane(el).querySelector('.warn')?.textContent).toBe('not declared')
    ;(tree(el).shadowRoot.querySelector('li[data-id="p:r:db"] > .line') as HTMLElement).click(); await settle(el)
    expect(pane(el).textContent!.replace(/\s+/g, ' ')).toContain('api.save → save')
    ;(tree(el) as unknown as { reveal(id: string): void }).reveal('r:r|o:acme.Store/save'); await settle(el)
    ;(tree(el).shadowRoot.querySelector('li[data-id="r:r|o:acme.Store/save"] > .line') as HTMLElement).click(); await settle(el)
    expect(pane(el).textContent!.replace(/\s+/g, ' ')).toContain('called byapi.save → db.save')
  })

  test('typeName: a label, else a short shape', async () => {
    const { typeName } = await import('../src/explorer-details.ts')
    expect(typeName(Str as never)).toBe('Str')
    expect(typeName({ type: 'object', properties: { a: 1, b: 1 } })).toBe('{ a, b }')
    expect(typeName({ type: 'array', items: { type: 'string' } })).toBe('string[]')
    expect(typeName({ anyOf: [{ type: 'string' }, { type: 'null' }] })).toBe('string | null')
    expect(typeName(undefined)).toBe('nothing')
  })

  test('choosing a runtime lists its pods, edges and policy', async () => {
    const el = await mount(await open(edge))
    await settle(el)
    await choose(el, 'r')
    for (const s of ['runtime r', 'api → db', 'none (everything allowed)']) expect(pane(el).textContent).toContain(s)
  })

  test('given apply adds a pod, then the explorer shows it without being remounted', async () => {
    const o = await open(slice)
    const el = await mount(o)
    await settle(el)
    const d = o.app.deployment()
    must(await o.app.apply({ pods: { ...d.pods, extra: Pod.lazy(log) }, runtimes: { main: { ...d.runtimes.main!, pods: [...d.runtimes.main!.pods, 'extra'] } } }))
    await settle(el)
    expect(text(el)).toContain('extra')
  })
})
