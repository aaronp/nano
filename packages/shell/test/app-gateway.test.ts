import { expect, test } from 'bun:test'
import { Type } from 'typebox'
import { Ops } from '@pritzlaff/nano-core'
import { component } from '@pritzlaff/nano-runes'
import { AppGateway } from '../src'
import { page, tick } from './fixtures'

const dflt = { system: 'host', instance: 'ws-controls-workspace' }
const p1 = { system: 'host', instance: 'p1', widget: 'workspace' }

/** A gateway plus a listener that records the gateway's appBar at the moment each focus arrives. */
const setup = () => {
  const t = page(); t.add('g', AppGateway)
  const seen: { focus: unknown; appBar: unknown }[] = []
  const Rec = component('test/rec', () => ({ take: (focus: unknown) => { seen.push({ focus, appBar: (t.reg.get('g')!.value as any).appBar }) } }),
    { take: { in: Type.Unknown({ description: 'A focus' }), description: 'Records the focus and the bar' } })
  t.add('rec', Rec)
  t.reg.subscribe({ source: 'g', op: Ops.key(AppGateway.ops.focus), listener: 'rec', target: Ops.key(Rec.ops.take) })
  return { ...t, seen }
}

test('setFocus resets the bar to the default, then publishes focus', async () => {
  const { call, value, seen } = setup()
  const p2 = { system: 'host', instance: 'p2', widget: 'workspace' }
  await call('g', AppGateway.ops.setAppBarDefault, dflt)
  await call('g', AppGateway.ops.setFocus, p1)
  await call('g', AppGateway.ops.setAppBarComponent, { system: 'host', instance: 'x' })
  await call('g', AppGateway.ops.setFocus, p2)
  await tick()
  expect(seen.at(-1)).toEqual({ focus: p2, appBar: dflt })
  expect(await value('g', AppGateway.ops.appBar)).toEqual(dflt)
  expect(await value('g', AppGateway.ops.focused)).toEqual(p2)
})

test('the same focus again is a no-op', async () => {
  const { call, value, seen } = setup()
  await call('g', AppGateway.ops.setFocus, p1)
  await call('g', AppGateway.ops.setAppBarComponent, { system: 'host', instance: 'p1' })
  await call('g', AppGateway.ops.setFocus, { ...p1 })
  await tick()
  expect(seen.length).toBe(1)
  expect(await value('g', AppGateway.ops.appBar)).toEqual({ system: 'host', instance: 'p1' })
})

test('setAppBarDefault while nothing overrides it shows at once', async () => {
  const { call, value } = setup()
  await call('g', AppGateway.ops.setAppBarDefault, dflt)
  expect(await value('g', AppGateway.ops.appBar)).toEqual(dflt)
  await call('g', AppGateway.ops.setAppBarDefault, null)
  expect(await value('g', AppGateway.ops.appBar)).toBeNull()
})

test('setAppBarDefault does not displace a panel override', async () => {
  const { call, value } = setup()
  await call('g', AppGateway.ops.setAppBarDefault, dflt)
  await call('g', AppGateway.ops.setFocus, p1)
  await call('g', AppGateway.ops.setAppBarComponent, { system: 'host', instance: 'x' })
  await call('g', AppGateway.ops.setAppBarDefault, null)
  expect(await value('g', AppGateway.ops.appBar)).toEqual({ system: 'host', instance: 'x' })
})

test('setFocus(null) publishes null and shows the default', async () => {
  const { call, value, seen } = setup()
  await call('g', AppGateway.ops.setAppBarDefault, dflt)
  await call('g', AppGateway.ops.setFocus, p1)
  await call('g', AppGateway.ops.setFocus, null)
  await tick()
  expect(seen.at(-1)).toEqual({ focus: null, appBar: dflt })
  expect(await value('g', AppGateway.ops.focused)).toBeNull()
})

test('setAppBarComponent takes only null or a target in the focused system', async () => {
  const { call, value } = setup()
  await call('g', AppGateway.ops.setAppBarDefault, dflt)
  await call('g', AppGateway.ops.setAppBarComponent, { system: 'host', instance: 'x' })   // nothing focused
  expect(await value('g', AppGateway.ops.appBar)).toEqual(dflt)
  await call('g', AppGateway.ops.setFocus, p1)
  await call('g', AppGateway.ops.setAppBarComponent, { system: 'lab', instance: 'x' })   // another system
  expect(await value('g', AppGateway.ops.appBar)).toEqual(dflt)
  await call('g', AppGateway.ops.setAppBarComponent, { system: 'host', instance: 'x' })
  expect(await value('g', AppGateway.ops.appBar)).toEqual({ system: 'host', instance: 'x' })
  await call('g', AppGateway.ops.setAppBarComponent, null)
  expect(await value('g', AppGateway.ops.appBar)).toBeNull()
})

test('every op is described', () => {
  for (const op of Object.values(AppGateway.ops)) expect((op as any).description).toBeTruthy()
})
