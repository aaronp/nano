import { test, expect } from 'bun:test'
import Type from 'typebox'
import { Actions, Components, Contexts, Events, defineManifest, type ComponentFactory, type Invocation } from '../src'
import { rootRef } from './fixtures'

const flush = () => new Promise(r => setTimeout(r, 0))
const said = Events.create('t', 'said', Type.String())
const say = Actions.declare('t', 'say', Type.String())
const hear = Actions.declare('t', 'hear', Type.String())

const speaker = (heard: string[]): ComponentFactory => {
  const manifest = defineManifest({ id: { author: 't', id: 'speaker' }, version: '0', emits: [said], consumes: [say] })
  return { manifest, create: ctx => Components.create(manifest, { actions: [[say, (_c, s) => { heard.push(`say:${s}`); return ctx.emit(said, s) }]] }) }
}
const listener = (heard: string[]): ComponentFactory => {
  const manifest = defineManifest({ id: { author: 't', id: 'listener' }, version: '0', emits: [], consumes: [hear] })
  return { manifest, create: () => Components.create(manifest, { actions: [[hear, (_c, s: string) => { heard.push(`hear:${s}`) }]] }) }
}
const root = () => Contexts.bus({ self: { ...rootRef, manifest: defineManifest({ id: { author: 't', id: 'root' }, version: '0', emits: [], consumes: [] }) } })

test('create requires a handler per consumed action', () => {
  const m = defineManifest({ id: { author: 't', id: 'x' }, version: '0', emits: [], consumes: [say] })
  expect(() => Components.create(m, { actions: [] })).toThrow('no handler for t/say')
})

test('compose rejects duplicate names', () => {
  expect(() => Components.compose({ id: { author: 't', id: 'c' }, version: '0' }, { a: speaker([]), b: speaker([]) }))
    .toThrow('duplicate names t/said, t/say')
})

test('composite delegates actions, routes internally, bubbles events, reports environment', async () => {
  const heard: string[] = []
  const pair = Components.compose({ id: { author: 't', id: 'pair' }, version: '0' },
    { s: speaker(heard), l: listener(heard) }, [{ from: ['s', said], to: ['l', hear] }])
  expect(pair.manifest.consumes.map(a => a.name)).toEqual(['t/say', 't/hear'])

  const bus = root()
  const outside: Invocation[] = []
  const pairInst = await bus.register(pair, 'pair')
  await bus.register({
    manifest: listener([]).manifest, create: () => ({ manifest: listener([]).manifest, onAction: async (_c, inv) => (outside.push(inv), { type: 'success', data: null }) }),
  }, 'out')
  bus.route({ from: { instance: pairInst, event: said.name }, to: { instance: { namespace: ['root'], instance: 'out' }, action: hear.name } })

  expect((await bus.call(pairInst, say.name, 'hi')).type).toBe('success')
  await flush()
  expect(heard).toEqual(['say:hi', 'hear:hi'])
  expect(outside.map(i => i.input)).toEqual(['hi'])

  // A hop: addressed straight to the inner listener.
  expect((await bus.call({ namespace: ['root', 'pair'], instance: 'l' }, hear.name, 'direct')).type).toBe('success')
  expect(heard.at(-1)).toBe('hear:direct')

  const env = bus.capabilities().environment
  const node = env.type === 'node' ? env.children[0] : undefined
  expect(node?.type === 'node' && node.children.map(c => c.instance.instance)).toEqual(['s', 'l'])
})
