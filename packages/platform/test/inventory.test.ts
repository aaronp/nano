import { expect, test } from 'bun:test'
import type { Snapshot } from '@pritzlaff/nano-core'
import { examplesOf, inventory, matches, UNREGISTERED, type Filters, type Kind, type Row } from '../src'

const inst = (id: string, component: string, owner?: { kind: string; name: string }) => ({ id, component, ...(owner && { owner }), ops: [] })
const SYSTEMS: Snapshot[] = [
  { id: 'host', subscriptions: [], instances: [
    inst('r', 'composable/range', { kind: 'widget', name: 'c-range' }),
    inst('p', 'composable/platform', { kind: 'app', name: 'ui-workspace' }),
    inst('p~view-0', 'composable.editor/view', { kind: 'view', name: 'c-platform' }),
  ] },
  { id: 'lab', subscriptions: [], instances: [inst('r', 'composable/range', { kind: 'platform', name: 'platform' })] },
]
const KINDS: Kind[] = [{ kind: 'range', component: 'composable/range', title: 'Range' }, { kind: 'log', component: 'composable/log', title: 'Log' }]
const rows = inventory(SYSTEMS, KINDS)
const at = (system: string, instance: string) => rows.find(r => r.system === system && r.instance === instance)

test('one row per system and instance; a shared instance appears in each with its own owner', () => {
  expect(rows.map(r => `${r.system}/${r.instance}`)).toEqual(['host/r', 'host/p', 'host/p~view-0', 'lab/r', '—/—'])
  expect(at('host', 'r')).toEqual({ system: 'host', component: 'range', instance: 'r', name: 'composable/range', owner: 'widget · c-range', description: '' })
  expect(at('lab', 'r')!.owner).toBe('platform · platform')
})

test('an instance whose component is no kind shows —', () => {
  expect(at('host', 'p')!.component).toBe('—')
})

test('an instance with no owner shows unknown', () => {
  expect(inventory([{ id: 's', subscriptions: [], instances: [inst('x', 'composable/range')] }], KINDS)[0]!.owner).toBe('unknown')
})

test('a kind with no instance gets one — row', () => {
  expect(rows.at(-1)).toEqual({ system: '—', component: 'log', instance: '—', name: 'composable/log', owner: '—', description: '' })
})

test('kinds sharing a component id are listed together', () => {
  const both = inventory(SYSTEMS, [...KINDS, { kind: 'slider', component: 'composable/range', title: 'Slider' }])
  expect(both.find(r => r.system === 'host' && r.instance === 'r')!.component).toBe('range, slider')
  expect(both.filter(r => r.system === '—').map(r => r.component)).toEqual(['log'])
})

test('filters: OR within a group, AND across', () => {
  const keep = (f: Partial<Filters>) => rows.filter(r => matches(r, '', { systems: [], components: [], ...f })).map(r => `${r.system}/${r.instance}`)
  expect(keep({})).toHaveLength(5)
  expect(keep({ systems: ['host'] })).toEqual(['host/r', 'host/p', 'host/p~view-0'])
  expect(keep({ systems: ['host', UNREGISTERED] })).toEqual(['host/r', 'host/p', 'host/p~view-0', '—/—'])
  expect(keep({ systems: [UNREGISTERED] })).toEqual(['—/—'])
  expect(keep({ components: ['log'] })).toEqual(['—/—'])
  expect(keep({ systems: ['lab'], components: ['range'] })).toEqual(['lab/r'])
  expect(keep({ systems: ['lab'], components: ['log'] })).toEqual([])
})

test('free text matches any column, case-insensitively', () => {
  const none: Filters = { systems: [], components: [] }
  expect(rows.filter((r: Row) => matches(r, 'WIDGET', none)).map(r => `${r.system}/${r.instance}`)).toEqual(['host/r'])
  expect(rows.filter((r: Row) => matches(r, '  ', none))).toHaveLength(5)
})

test("rows carry the component's description; a never-made kind its kind's", () => {
  const described: Snapshot[] = [{ id: 's', subscriptions: [], instances: [{ ...inst('x', 'composable/range'), description: 'A range' }] }]
  const rows = inventory(described, [...KINDS.slice(0, 1), { kind: 'log', component: 'composable/log', title: 'Log', description: 'A log' }])
  expect(rows.map(r => r.description)).toEqual(['A range', 'A log'])
  expect(inventory(SYSTEMS, KINDS).find(r => r.instance === 'p')!.description).toBe('')
})

test('examplesOf takes two examples, as JSON, each cut to 40 characters', () => {
  expect(examplesOf(undefined)).toBe('')
  expect(examplesOf({ examples: [1, 'a', 3] } as never)).toBe('1, "a"')
  expect(examplesOf({ examples: ['x'.repeat(60)] } as never)).toBe(`"${'x'.repeat(38)}…`)
})
