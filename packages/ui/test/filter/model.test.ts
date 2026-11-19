import { describe, expect, test } from 'bun:test'
import { emptyFilter, filterTree, matches, type FilterValue, type PodStatus } from '../../src/filter/model.ts'

const f = (p: Partial<FilterValue>): FilterValue => ({ ...emptyFilter(), ...p })
const set = <T>(...x: T[]) => new Set(x)

describe('matches', () => {
  test('empty filter matches everything', () => {
    expect(matches({ label: 'x' }, emptyFilter())).toBe(true)
    expect(matches({ label: 'x', kind: 'pod', ns: 'a', status: 'failed' }, emptyFilter())).toBe(true)
  })
  test('text: case-insensitive substring of label or terms; regex characters are literal', () => {
    expect(matches({ label: 'Hello' }, f({ text: 'ELL' }))).toBe(true)
    expect(matches({ label: 'a', terms: ['nano.ui.Input'] }, f({ text: 'ui.in' }))).toBe(true)
    expect(matches({ label: 'abc' }, f({ text: '.*' }))).toBe(false)
    expect(matches({ label: 'a.*b' }, f({ text: '.*' }))).toBe(true)
  })
  test('kinds: only listed kinds; an empty set is any', () => {
    expect(matches({ label: 'x', kind: 'pod' }, f({ kinds: set('pod') }))).toBe(true)
    expect(matches({ label: 'x', kind: 'action' }, f({ kinds: set('pod') }))).toBe(false)
    expect(matches({ label: 'x', kind: 'action' }, f({ kinds: set('action') }))).toBe(true)
    expect(matches({ label: 'x', kind: 'event' }, f({ kinds: set('action') }))).toBe(false)
    expect(matches({ label: 'x' }, f({ kinds: set('pod') }))).toBe(false)
  })
  test('namespaces: several at once; an unknown selected namespace is ignored', () => {
    const v = f({ namespaces: set('a', 'b') })
    expect(matches({ label: 'x', ns: 'a' }, v)).toBe(true)
    expect(matches({ label: 'x', ns: 'b' }, v)).toBe(true)
    expect(matches({ label: 'x', ns: 'c' }, v)).toBe(false)
    expect(matches({ label: 'x', ns: 'c' }, f({ namespaces: set('gone') }), { namespaces: set('c') })).toBe(true)
    expect(matches({ label: 'x', ns: 'a' }, f({ namespaces: set('a', 'gone') }), { namespaces: set('a', 'c') })).toBe(true)
    expect(matches({ label: 'x', ns: 'c' }, f({ namespaces: set('a', 'gone') }), { namespaces: set('a', 'c') })).toBe(false)
  })
  test('statuses: only pods whose status is listed; an item with no status fails', () => {
    const v = f({ statuses: set<PodStatus>('failed') })
    expect(matches({ label: 'p', kind: 'pod', status: 'failed' }, v)).toBe(true)
    expect(matches({ label: 'p', kind: 'pod', status: 'running' }, v)).toBe(false)
    expect(matches({ label: 'i', kind: 'interface' }, v)).toBe(false)
  })
})

describe('filterTree', () => {
  test('keeps ancestors and recounts groups', () => {
    const n = (id: string, kind: string | undefined, ns: string, children?: never[], count?: number) =>
      ({ id, label: id, ...(kind && { kind }), ...(count !== undefined && { count }), data: { ns }, ...(children && { children }) })
    const list = [
      n('r:a', 'runtime', 'x', [n('g', undefined, '', [n('p:a', 'pod', 'y'), n('p:b', 'pod', 'x')] as never[], 2)] as never[]),
      n('o:q', 'action', 'y'),
    ]
    const out = filterTree(list as never, f({ kinds: set('pod'), namespaces: set('y') }))
    expect(out.map(x => x.id)).toEqual(['r:a'])
    expect(out[0]!.children![0]!.count).toBe(1)
    expect(out[0]!.children![0]!.children!.map(x => x.id)).toEqual(['p:a'])
    expect(filterTree(list as never, f({ kinds: set('action') })).map(x => x.id)).toEqual(['o:q'])
    expect(filterTree(list as never, emptyFilter())).toEqual(list as never)
  })
})

describe('filterTree by status and unknown namespace', () => {
  const pod = (id: string, status: string) => ({ id, label: id, kind: 'pod', data: { ns: 'x', status } })
  const list = [{ id: 'r', label: 'r', kind: 'runtime', data: { ns: 'x' }, children: [pod('a', 'running'), pod('b', 'not started')] }]
  test('status keeps matching pods and their ancestors only', () => {
    const out = filterTree(list, f({ statuses: set<PodStatus>('running') }))
    expect(out.map(x => x.id)).toEqual(['r'])
    expect(out[0]!.children!.map(x => x.id)).toEqual(['a'])
  })
  test('a selected namespace absent from the tree is ignored', () => {
    expect(filterTree(list, f({ namespaces: set('gone') }))).toEqual(list)
  })
})
