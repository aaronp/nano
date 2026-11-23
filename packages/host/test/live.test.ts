// The host core's live outline (open, re-resolve on `applied`, saving on a change) and `pick` (a lazy pod the host can
// reach in a `rules` runtime, its dependencies connected, then a `pod` slot; a failed deploy adds no slot), and `deploy` (no slot).
import { expect, test } from 'bun:test'
import { Type } from 'typebox'
import { Implementation, Interface, Op, Pod, Provider, Schema, provide, success, type AppDeployment } from '@pritzlaff/nano-core'
import { Host } from '../src/index.ts'

const Num = Schema.define(Type.Integer(), 'Num')
const Counter = Interface.define('acme.Counter', { inc: Op.action(Num, Num) })
let builds = 0
const counter = Implementation.define('acme/counter', { provides: [Counter], make: async () => { builds++; return [provide(Counter, { inc: async (n: number) => success(n + 1) })] } })
const user = Implementation.define('acme/user', { provides: [], dependencies: { counter: Counter }, make: async () => [] })
const step = Implementation.define('acme/step', { provides: [], config: Schema.define(Type.Object({ by: Type.Integer() }, { default: { by: 2 } }), 'Step'), make: async () => [] })
const acme = Provider.define('acme', [counter, user, step])

const KEY = 'nano-host.document'
const memory = (init: Record<string, unknown> = {}) => {
  const m = new Map(Object.entries(init).map(([k, v]) => [k, JSON.stringify(v)]))
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } as unknown as Storage & { m: Map<string, string> }
}
const app: AppDeployment = {
  pods: { c1: Pod.lazy(counter) },
  runtimes: { main: { pods: ['c1'], subscriptions: [] }, locked: { pods: [], subscriptions: [], policy: { kind: 'rules', rules: [{ deny: '*' }] } } },
}
const outline = { roots: ['home'], pages: { home: { slots: { c1: { kind: 'pod', pod: 'acme/counter@main/c1' } } } } }
const boot = async (s = memory({ [KEY]: { app, outline } }), create?: Parameters<typeof Host.boot>[1]['create']) => {
  const r = await Host.boot(s, { base: import.meta.url, providers: [acme], ...(create && { create }) })
  if (!r.ok) throw new Error(r.fail.reason)
  return { h: r.value, s }
}
const saved = (s: Storage) => JSON.parse(s.getItem(KEY)!)

test('open starts each shown pod once and reuses it running', async () => {
  const { h } = await boot(), was = builds
  const [one, two] = await Promise.all([h.outline.open('home'), h.outline.open('home')])
  expect([one.c1, two.c1].map(o => (o as { started: boolean }).started).sort()).toEqual([false, true])
  expect((await h.outline.open('home')).c1).toMatchObject({ started: false })
  expect(builds - was).toBe(1)
})

test('a slot whose pod goes resolves missing and, back, resolves and opens again: listeners hear `resolved` on each applied', async () => {
  const { h } = await boot(), heard: string[][] = []
  h.outline.listen(c => heard.push(c.resolved))
  const d = h.app.deployment()
  expect((await h.app.apply({ ...d, pods: {}, runtimes: { ...d.runtimes, main: { pods: [], subscriptions: [] } } })).ok).toBe(true)
  expect(h.outline.resolve('home')).toEqual({ c1: { kind: 'missing' } })
  expect((await h.outline.open('home')).c1).toEqual({ kind: 'missing' })
  expect((await h.app.apply(d)).ok).toBe(true)
  expect(String((h.outline.resolve('home').c1 as { pods: unknown[] }).pods[0])).toBe('acme/counter@main/c1')
  expect((await h.outline.open('home')).c1).toMatchObject({ started: true })
  expect(heard).toEqual([['home'], ['home']])
})

test('an outline change is saved; a stale base is refused and nothing saved', async () => {
  const { h, s } = await boot(), heard: unknown[] = []
  h.outline.listen(c => heard.push(c))
  const next = { ...h.outline.document().doc, roots: ['home', 'two'], pages: { ...h.outline.document().doc.pages, two: { slots: {} } } }
  expect(h.outline.apply(next, { base: 0 }).ok).toBe(true)
  expect(heard).toEqual([{ added: ['two'], removed: [], changed: [], moved: [], resolved: [] }])
  expect(saved(s).outline.roots).toEqual(['home', 'two'])
  expect(h.document().outline.roots).toEqual(['home', 'two'])
  expect(h.outline.apply({ roots: [], pages: {} }, { base: 0 }).ok).toBe(false)
  expect(saved(s).outline.roots).toEqual(['home', 'two'])
})

test('pick: a lazy pod in a `rules` runtime the host can then reach, then its `pod` slot; one at a time, free names; saved', async () => {
  const { h, s } = await boot()
  const [a, b] = await Promise.all([h.pick('home', 'acme/counter', 'locked'), h.pick('home', 'acme/counter', 'locked')])
  expect([a, b]).toEqual([success('counter1'), success('counter2')])
  expect(h.app.runtime('locked').status('counter1')).toMatchObject({ ok: true, value: 'not started' })
  const got = await h.app.runtime('locked').getOrCreate('counter1')
  expect(got.ok && await got.value.pod.inc(1)).toEqual(success(2))
  expect(saved(s).outline.pages.home.slots.counter2).toEqual({ kind: 'pod', pod: 'acme/counter@locked/counter2' })
  expect(saved(s).app.pods.counter1).toEqual({ implementation: 'acme/counter', eager: false })
})

test('pick connects the new pod\'s dependency to the one pod matching it; a config schema\'s default is the pod\'s config', async () => {
  const { h } = await boot()
  expect(await h.pick('home', 'acme/step', 'main')).toEqual(success('step1'))
  expect(h.app.deployment().pods['step1']!.config).toEqual({ by: 2 })
  expect(await h.pick('home', 'acme/user', 'main')).toEqual(success('user1'))
  expect(h.app.deployment().runtimes['main']!.subscriptions).toEqual([{ kind: 'call', from: 'user1', to: 'c1' }])
})

test('a pick whose deploy fails, or of an unknown implementation or page, adds no slot and no pod', async () => {
  const { h, s } = await boot(undefined, { deploymentPolicy: { isAllowed: () => ({ approved: false, reason: 'no' }) } })
  const before = s.getItem(KEY)
  expect(await h.pick('home', 'acme/counter', 'main')).toMatchObject({ ok: false })
  expect(await h.pick('home', 'acme/nope', 'main')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  expect(await h.pick('nope', 'acme/counter', 'main')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  expect(Object.keys(h.outline.document().doc.pages['home']!.slots)).toEqual(['c1'])
  expect(Object.keys(h.app.deployment().pods)).toEqual(['c1'])
  expect(s.getItem(KEY)).toBe(before)
})

test('deploy: a lazy pod as a pick makes it, connected, with no slot; its name and connect\'s notes', async () => {
  const { h, s } = await boot()
  expect(await h.deploy('acme/user', 'main')).toEqual(success({ name: 'user1', notes: ['connected user1 → c1 (acme.Counter)'] }))
  expect(await h.deploy('acme/counter', 'main')).toEqual(success({ name: 'counter1', notes: [] }))
  expect(h.app.deployment().runtimes['main']!.subscriptions).toEqual([{ kind: 'call', from: 'user1', to: 'c1' }])
  expect(Object.keys(h.outline.document().doc.pages['home']!.slots)).toEqual(['c1'])
  expect(saved(s).app.pods.user1).toEqual({ implementation: 'acme/user', eager: false })
  expect(await h.deploy('acme/nope', 'main')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
})

test('two picks of an implementation with a config default share no config object', async () => {
  const { h } = await boot(memory({ [KEY]: { app, outline: { roots: ['home'], pages: { home: { slots: {} } } } } }))
  await h.pick('home', 'acme/step', 'main'); await h.pick('home', 'acme/step', 'main')
  const pods = h.app.deployment().pods as Record<string, { config?: { by: number } }>
  pods['step1']!.config!.by = 9
  expect(pods['step2']!.config).toEqual({ by: 2 })
  expect(h.registry.implementation('acme/step')!.config).toMatchObject({ default: { by: 2 } })
})
