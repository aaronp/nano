import { expect, test } from 'bun:test'
import { Components, Ops, Registries, Runtimes } from '@pritzlaff/nano-core'
import { provide } from '@pritzlaff/nano-elements'
import { Debounce, defineBundle, Input, Log, Map as MapC, Range } from '../src'
import { tick } from './fixtures'

defineBundle()
const rt = Runtimes.create(Registries.create('page')), reg = rt.registry
provide(document, reg)
type El = HTMLElement & { updateComplete: Promise<boolean> }
const settle = async (el: El) => { for (let i = 0; i < 3; i++) { await tick(); await el.updateComplete } }
const place = async (tag: string, name: string) => {
  document.body.insertAdjacentHTML('beforeend', `<${tag} name="${name}"></${tag}>`)
  const el = document.body.lastElementChild as El
  await settle(el); return el
}
const q = (el: El, sel: string) => el.shadowRoot!.querySelector(sel) as HTMLInputElement
const value = async (id: string, op: any) => ((await rt.call({ registry: 'page', instance: 't' }, id, Ops.key(op), null)) as any).value
test('c-input: typing and Enter submits the value', async () => {
  const el = await place('c-input', 'in1')
  reg.add('in1-log', Components.instantiate(Log))
  reg.subscribe({ source: 'in1', op: Ops.key(Input.ops.submitted), listener: 'in1-log', target: Ops.key(Log.ops.info) })
  const box = q(el, 'input')
  box.value = 'hello'; box.dispatchEvent(new Event('input'))
  await settle(el)
  box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); await settle(el)
  expect((await value('in1-log', Log.ops.entries)).map((e: any) => e.value)).toEqual(['hello'])
})

test('c-range: moving the slider sets the value', async () => {
  const el = await place('c-range', 'r1')
  const slider = q(el, 'input[type=range]')
  slider.value = '30'; slider.dispatchEvent(new Event('input')); await settle(el)
  expect(await value('r1', Range.ops.value)).toBe(30)
})

test('c-log: shows a row per entry; Clear empties it', async () => {
  const el = await place('c-log', 'l1')
  await rt.call({ registry: 'page', instance: 't' }, 'l1', Ops.key(Log.ops.warn), 'careful'); await settle(el)
  expect(el.shadowRoot!.querySelectorAll('tbody tr')).toHaveLength(1)
  ;[...el.shadowRoot!.querySelectorAll('button')].find(b => b.textContent === 'Clear')!.click(); await settle(el)
  expect(el.shadowRoot!.querySelectorAll('tbody tr')).toHaveLength(0)
})

test('c-map: the code box sets the code', async () => {
  const el = await place('c-map', 'm1')
  const box = el.shadowRoot!.querySelector('textarea')!
  box.value = 'return x + 1'; box.dispatchEvent(new Event('change')); await settle(el)
  expect(await value('m1', MapC.ops.code)).toBe('return x + 1')
})

test('c-debounce: queued values wait in the switchback, then drop as one batch into a bucket', async () => {
  const el = await place('c-debounce', 'd1')
  const call = (op: any, x: unknown) => rt.call({ registry: 'page', instance: 't' }, 'd1', Ops.key(op), x)
  await call(Debounce.ops.setQuiet, 100)
  for (const v of [1, 'two', { three: 3 }]) await call(Debounce.ops.enqueue, v)
  await settle(el)
  const root = el.shadowRoot!
  expect(root.querySelectorAll('.item').length).toBe(3)
  expect(root.querySelector('.status')!.textContent).toContain('collecting 3')
  expect(root.querySelector('.ratio')!.textContent).toBe('3 → 0 batches')
  await tick(1600); await settle(el)
  expect(root.querySelectorAll('.item').length).toBe(0)
  expect(root.querySelectorAll('.batch .cell').length).toBe(3)
  expect(root.querySelector('.batch')!.textContent).toContain('quiet')
  expect(root.querySelector('.ratio')!.textContent).toBe('3 → 1 batches')
})

test('c-debounce: the quiet slider sets the quiet period', async () => {
  const el = await place('c-debounce', 'd2')
  const slider = el.shadowRoot!.querySelector('input[aria-label="Quiet period in milliseconds"]') as HTMLInputElement
  slider.value = '750'; slider.dispatchEvent(new Event('input')); await settle(el)
  expect(await value('d2', Debounce.ops.quiet)).toBe(750)
})
