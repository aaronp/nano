import { test, expect } from 'bun:test'
import Type from 'typebox'
import { Components, Scopes } from '@composable/sdk'
import { View, provideScope, requestScope } from '../src'

const tick = () => new Promise(r => setTimeout(r, 5))
const C = Components.declare({ author: 't', id: 'counter' })
const bump = C.op('bump', 'add one', { input: Type.Null() })
const counter = C.define({ state: () => ({ n: 0 }), handlers: [[bump, (_, { state }) => { state.n++ }]] })
class CounterView extends View<Awaited<ReturnType<typeof counter.create>>> {
  static factory = counter
  render() { return this.component.state.n }
}
customElements.define('t-counter', CounterView)

const host = () => {
  const scope = Scopes.create(), el = document.createElement('div')
  provideScope(el, scope); document.body.append(el)
  return { scope, el, page: scope.context('page') }
}

test('requestScope finds the nearest provider, or nothing', () => {
  const { scope, el } = host()
  const inner = document.createElement('span'); el.append(inner)
  expect(requestScope(inner)).toBe(scope)
  expect(requestScope(document.body)).toBeUndefined()
})

test('a view in markup places its component in the scope, by name, and leaves when removed', async () => {
  const { scope, el, page } = host()
  el.innerHTML = '<t-counter name="c1"></t-counter>'
  await tick()
  const v = el.querySelector('t-counter') as CounterView
  expect(page.instances().map(i => i.name)).toEqual(['c1'])
  expect(v.component).toBe(scope.component('c1') as never)
  await page.call('c1', bump, null)
  expect(v.component.state.n).toBe(1)
  v.remove(); await tick()
  expect(page.instances()).toEqual([])
})

test('a moved view keeps its component; generated names are unique; a given component is not re-placed', async () => {
  const { el, page } = host()
  const a = document.createElement('t-counter') as CounterView, b = document.createElement('t-counter') as CounterView
  el.append(a, b); await tick()
  const names = page.instances().map(i => i.name)
  expect(new Set(names).size).toBe(2)
  const before = a.component
  const other = document.createElement('section'); el.append(other)
  other.append(a); await tick()                                  // move: disconnect + reconnect
  expect(a.component).toBe(before)
  expect(page.instances().map(i => i.name)).toEqual(names)

  const given = document.createElement('t-counter') as CounterView
  given.component = before; el.append(given); await tick()       // mounted with a component: no new instance
  expect(page.instances().length).toBe(2)
})

test('outside any provider, a view does nothing (and renders nothing)', async () => {
  const v = document.createElement('t-counter') as CounterView
  document.body.append(v); await tick()
  expect(v.component).toBeUndefined()
})
