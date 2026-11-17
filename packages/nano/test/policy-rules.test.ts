import { expect, test } from 'bun:test'
import { PolicyRules, type Ask } from '../src/index.ts'

const ask = (a: Partial<Ask> = {}): Ask => ({ runtime: 'r', kind: 'call', from: 'a', to: 'db', port: 'acme.Db/save', outside: false, ...a })
const yes = { approved: true } as const
const no = { approved: false, reason: 'no rule allows it' } as const

test('kinds: one, a list, or *', () => {
  expect(PolicyRules([{ allow: 'call' }]).isAllowed(ask())).toEqual(yes)
  expect(PolicyRules([{ allow: 'call' }]).isAllowed(ask({ kind: 'subscribe' }))).toEqual(no)
  expect(PolicyRules([{ allow: ['pipe', 'subscribe'] }]).isAllowed(ask({ kind: 'subscribe' }))).toEqual(yes)
  expect(PolicyRules([{ allow: '*' }]).isAllowed(ask({ kind: 'lifecycle' }))).toEqual(yes)
})

test('from: a pod or host', () => {
  const p = PolicyRules([{ allow: '*', from: 'host' }])
  expect(p.isAllowed(ask({ from: 'host' }))).toEqual(yes)
  expect(p.isAllowed(ask())).toEqual(no)
  expect(PolicyRules([{ allow: '*', from: 'a' }]).isAllowed(ask())).toEqual(yes)
  expect(PolicyRules([{ allow: '*', from: '*' }]).isAllowed(ask({ from: 'z' }))).toEqual(yes)
})

test('targets by resource type: toPod, toInterface (all its ports), toPort (only that op)', () => {
  expect(PolicyRules([{ allow: '*', toPod: 'db' }]).isAllowed(ask())).toEqual(yes)
  const iface = PolicyRules([{ allow: '*', toInterface: 'acme.Db' }])
  expect(iface.isAllowed(ask())).toEqual(yes)
  expect(iface.isAllowed(ask({ port: 'acme.Db/load' }))).toEqual(yes)
  expect(iface.isAllowed(ask({ port: 'acme.Dbx/save' }))).toEqual(no)
  const op = PolicyRules([{ allow: '*', toPort: 'acme.Db/save' }])
  expect(op.isAllowed(ask())).toEqual(yes)
  expect(op.isAllowed(ask({ port: 'acme.Db/load' }))).toEqual(no)
  expect(PolicyRules([{ allow: '*', toPod: 'other' }]).isAllowed(ask())).toEqual(no)
  expect(PolicyRules([{ allow: '*', toPod: 'db', toInterface: 'acme.Other' }]).isAllowed(ask())).toEqual(no)   // all given fields must match
})

test('outside', () => {
  const p = PolicyRules([{ allow: '*', outside: true }])
  expect(p.isAllowed(ask({ outside: true }))).toEqual(yes)
  expect(p.isAllowed(ask())).toEqual(no)
})

test('first match wins; a deny names its rule', () => {
  const p = PolicyRules([{ allow: 'call', toPod: 'db' }, { deny: '*', from: 'a' }, { allow: '*' }])
  expect(p.isAllowed(ask())).toEqual(yes)
  expect(p.isAllowed(ask({ kind: 'pipe' }))).toEqual({ approved: false, reason: 'rules[1]' })
  expect(p.isAllowed(ask({ kind: 'pipe', from: 'b' }))).toEqual(yes)
  expect(PolicyRules([]).isAllowed(ask())).toEqual(no)
})

test('a pod name never reads as an interface: toInterface does not match a pod, nor toPod an interface', () => {
  expect(PolicyRules([{ allow: '*', toInterface: 'db' }]).isAllowed(ask())).toEqual(no)
  expect(PolicyRules([{ allow: '*', toPod: 'acme.Db' }]).isAllowed(ask())).toEqual(no)
})
