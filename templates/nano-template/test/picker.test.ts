import { Type } from 'typebox'
// The Picker: a choice from a list of options; publishes each pick as `changed`.
import { expect, test } from 'bun:test'
import { Components, Ops, Registries, Runtimes, type Op } from '@pritzlaff/nano-core'
import { component } from '@pritzlaff/nano-runes'
import { Picker } from '../src'

const Spy = component('test/spy', () => { const got: unknown[] = []; return { get got() { return got }, take: (x: unknown) => { got.push(x) } } }, { got: Type.Array(Type.Unknown(), { description: 'Everything taken' }), take: { in: Type.Unknown({ description: 'Anything' }), description: 'Takes a value' } })

function page() {
  const rt = Runtimes.create(Registries.create('page')), reg = rt.registry
  reg.add('p', Components.instantiate(Picker))
  reg.add('spy', Components.instantiate(Spy))
  reg.subscribe({ source: 'p', op: Ops.key(Picker.ops.changed), listener: 'spy', target: Ops.key(Spy.ops.take) })
  const call = (op: Op, arg: unknown = null) => rt.call({ registry: 'page', instance: 'test' }, 'p', Ops.key(op), arg) as Promise<any>
  return { call, value: async (op: Op) => (await call(op)).value, changes: (reg.get('spy')!.value as { got: unknown[] }).got }
}

test('it starts with a few options and the first picked', async () => {
  const { value } = page()
  expect(await value(Picker.ops.options)).toEqual(['slow', 'normal', 'fast'])
  expect(await value(Picker.ops.value)).toBe('slow')
})

test('picking an option sets the value and publishes it; picking it again publishes nothing', async () => {
  const { call, value, changes } = page()
  await call(Picker.ops.pick, 'fast')
  expect(await value(Picker.ops.value)).toBe('fast')
  await call(Picker.ops.pick, 'fast')
  expect(changes).toEqual(['fast'])
})

test('a value that is not an option is refused', async () => {
  const { call, value, changes } = page()
  expect((await call(Picker.ops.pick, 'warp')).error).toContain('warp')
  expect(await value(Picker.ops.value)).toBe('slow'); expect(changes).toEqual([])
})

test('new options keep the value when it is still one, otherwise pick (and publish) the first', async () => {
  const { call, value, changes } = page()
  await call(Picker.ops.setOptions, ['slow', 'snail'])
  expect(await value(Picker.ops.value)).toBe('slow'); expect(changes).toEqual([])
  await call(Picker.ops.setOptions, ['a', 'b'])
  expect(await value(Picker.ops.value)).toBe('a'); expect(changes).toEqual(['a'])
  await call(Picker.ops.setOptions, [])
  expect(await value(Picker.ops.value)).toBe('')
  expect((await call(Picker.ops.setOptions, 'nope')).error).toBeTruthy()   // checked: a list of strings
})

test('picker: config is the options; configure keeps the value if still an option; a bad one changes nothing', async () => {
  expect(Ops.fits(Picker.ops.config, Picker.ops.configure)).toBe(true)
  const a = page(); await a.call(Picker.ops.setOptions, ['red', 'green'])
  const cfg = await a.value(Picker.ops.config); expect(cfg).toEqual({ options: ['red', 'green'] })
  const b = page(); await b.call(Picker.ops.setOptions, ['x', 'green']); await b.call(Picker.ops.pick, 'green')
  expect((await b.call(Picker.ops.configure, cfg)).error).toBeUndefined()
  expect(await b.value(Picker.ops.config)).toEqual(cfg); expect(await b.value(Picker.ops.value)).toBe('green')
  expect((await b.call(Picker.ops.configure, { options: [1] })).error).toBeTruthy()
  expect(await b.value(Picker.ops.config)).toEqual(cfg)
})
