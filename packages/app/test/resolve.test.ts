import { expect, test } from 'bun:test'
import { resolve, type Candidate, type ResolveContext } from '../src/resolve'

const me = { registry: 'app', instance: 'me' }
const cand = (registry: string, instance: string, ops: string[] = ['a/get'], tags: string[] = []): Candidate =>
  ({ coord: { registry, instance }, ops, tags })
const ctx = (o: Partial<ResolveContext> = {}): ResolveContext =>
  ({ requester: me, interfaceOps: ['a/get'], systems: ['app', 'storage'], candidates: [], providers: [], ...o })
const sel = { implements: 'a/store' }

test('the pin wins', () => {
  const c = ctx({ candidates: [cand('storage', 'db'), cand('storage', 'other')] })
  expect(resolve({ ...sel, layer: 'storage', at: 'db' }, c)).toEqual({ bound: { registry: 'storage', instance: 'db' } })
})

test('a pin that does not fit gives choose', () => {
  const c = ctx({ candidates: [cand('storage', 'db', []), cand('storage', 'other')], providers: [{ kind: 'k', implements: ['a/store'] }] })
  expect(resolve({ ...sel, layer: 'storage', at: 'db' }, c)).toEqual({ choose: { candidates: [{ registry: 'storage', instance: 'other' }], kinds: ['k'] }, reason: "storage/db doesn't fit" })
})

test('tags filter', () => {
  const c = ctx({ candidates: [cand('app', 'x'), cand('app', 'y', ['a/get'], ['fast'])] })
  expect(resolve({ ...sel, tags: ['fast'] }, c)).toEqual({ bound: { registry: 'app', instance: 'y' } })
})

test('a single fit binds', () => {
  expect(resolve(sel, ctx({ candidates: [cand('app', 'x'), cand('storage', 'z')] }))).toEqual({ bound: { registry: 'app', instance: 'x' } })
})

test('the requester is excluded', () => {
  const r = resolve(sel, ctx({ candidates: [cand('app', 'me')] }))
  expect(r).toEqual({ choose: { candidates: [], kinds: [] }, reason: 'nothing matches' })
})

test('a single provider gives make', () => {
  expect(resolve(sel, ctx({ providers: [{ kind: 'k', implements: ['a/store'] }, { kind: 'j', implements: ['b'] }] }))).toEqual({ make: 'k' })
})

test('two fits give choose', () => {
  const r = resolve(sel, ctx({ candidates: [cand('app', 'x'), cand('app', 'y')] }))
  expect(r).toEqual({ choose: { candidates: [cand('app', 'x').coord, cand('app', 'y').coord], kinds: [] }, reason: '2 match' })
})

test('an unknown layer gives choose, no throw', () => {
  expect(resolve({ ...sel, layer: 'nowhere' }, ctx())).toEqual({ choose: { candidates: [], kinds: [] }, reason: 'no system nowhere' })
})
