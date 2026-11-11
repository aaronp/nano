import { expect, test } from 'bun:test'
import { canonicalApp, checkApp, RESERVED, type NanoApp } from '../src'

const full = (): NanoApp => ({
  nano: 1, title: 'Demo', theme: { id: 'ocean', mode: 'dark' },
  profile: { user: { name: 'Ada', avatar: 'https://x.test/a.png' }, entries: [{ label: 'Systems', href: '#/systems' }] },
  imports: [{ url: 'https://x.test/pkg', trust: 'sandboxed' }],
  systems: [{ id: 'host', instances: [{ id: 'r1', kind: 'range', mode: 'sandbox', allow: ['a'], deny: ['b'], config: { min: 0, max: { z: 1, a: 2 } } }],
    subscriptions: [{ source: 'r1', op: 'x/value', listener: 'l1', target: 'x/info' }] }],
  workspaces: [{ id: '/main', title: 'Main', system: 'host', icon: 'home', layout: { b: 1, a: [1, 2] } }],
})
const bad = (mut: (a: any) => void) => { const a: any = full(); mut(a); return checkApp(a) }

test('a full document passes and round-trips through canonicalApp', () => {
  const r = checkApp(full()); expect(typeof r).toBe('object')
  expect(canonicalApp(r as NanoApp)).toBe(canonicalApp(full()))
  expect(checkApp(JSON.parse(canonicalApp(full())))).toEqual(full())
})

test('canonicalApp ignores key order', () => {
  const a = full(), b = JSON.parse(JSON.stringify(a)); b.workspaces[0].layout = { a: [1, 2], b: 1 }
  expect(canonicalApp(b)).toBe(canonicalApp(a))
  expect(canonicalApp({ ...a, title: 'Other' })).not.toBe(canonicalApp(a))
})

test('unknown fields are dropped', () => {
  const a: any = full(); a.extra = 1; a.systems[0].x = 1; a.systems[0].instances[0].y = 2; a.profile.user.z = 3; a.imports[0].w = 4
  expect(checkApp(a)).toEqual(full())
})

test('hostile documents are refused with a reason, never thrown', () => {
  const reasons = [
    checkApp({ ...full(), pad: 'x'.repeat(1_000_001) }), checkApp(null), checkApp('x'), checkApp(undefined),
    bad(a => { a.nano = 2 }), bad(a => { a.profile.entries[0].href = 'javascript:alert(1)' }), bad(a => { a.profile.user.avatar = 'javascript:x' }),
    bad(a => { a.title = 'x'.repeat(121) }), bad(a => { a.imports = Array(51).fill(a.imports[0]) }), bad(a => { a.systems[0].id = 'Bad Id' }),
    bad(a => { a.workspaces[0].id = 'nope' }), bad(a => { a.theme.mode = 'neon' }),
    bad(a => { let d: any = {}; const root = d; for (let i = 0; i < 40; i++) d = d.n = {}; a.workspaces[0].layout = root }),
  ]
  for (const r of reasons) expect(typeof r).toBe('string'), expect((r as string).length).toBeGreaterThan(3)
  const cyc: any = {}; cyc.me = cyc; expect(typeof checkApp(cyc)).toBe('string')
  let deep: any = {}; const top = deep; for (let i = 0; i < 100_000; i++) deep = deep.n = {}
  expect(typeof checkApp(top)).toBe('string')
})

test('RESERVED matches platform/registry/profile/app/ws-controls-*/ex-*', () => {
  for (const id of ['platform', 'registry', 'profile', 'ex-range', 'ex-', 'app', 'ws-controls-workspace']) expect(RESERVED(id)).toBe(true)
  for (const id of ['host', 'my-ex-range', 'profiles', 'r1', 'apps']) expect(RESERVED(id)).toBe(false)
})

test('free-text ids are accepted; slashes, spaces, empty and control characters refused', () => {
  for (const id of ['Range1', 'my_range', 'Lab', 'c-sandboxed-3']) {
    expect(typeof bad(a => { a.systems[0].id = id; a.systems[0].instances[0].id = id; a.workspaces[0].system = id; a.systems[0].subscriptions[0].source = '*'; a.systems[0].subscriptions[0].listener = id })).toBe('object')
  }
  for (const id of ['a/b', 'a b', '', 'a\u0001b']) {
    expect(typeof bad(a => { a.systems[0].instances[0].id = id })).toBe('string')
    expect(typeof bad(a => { a.systems[0].id = id })).toBe('string')
    expect(typeof bad(a => { a.systems[0].subscriptions[0].listener = id })).toBe('string')
  }
})

test('the cap counts UTF-8 bytes, not UTF-16 units', () => {
  const t = '\u20ac'.repeat(400_000); expect(t.length).toBeLessThan(1_000_000)
  expect(checkApp({ ...full(), title: t, pad: t })).toBe('larger than 1 MB')
})

test('deep config, long label and too many entries are refused', () => {
  expect(typeof bad(a => { let d: any = {}; const r = d; for (let i = 0; i < 40; i++) d = d.n = {}; a.systems[0].instances[0].config = r })).toBe('string')
  expect(typeof bad(a => { a.profile.entries[0].label = 'x'.repeat(41) })).toBe('string')
  expect(typeof bad(a => { a.profile.entries = Array(21).fill(a.profile.entries[0]) })).toBe('string')
})

test('a very wide config does not throw', () => {
  expect(typeof bad(a => { a.systems[0].instances[0].config = Array(300_000).fill(1) })).toBe('object')
})
