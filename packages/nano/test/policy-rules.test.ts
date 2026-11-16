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

test('to: a pod, an interface (all its ports) or a port (only that op)', () => {
  expect(PolicyRules([{ allow: '*', to: 'db' }]).isAllowed(ask())).toEqual(yes)
  const iface = PolicyRules([{ allow: '*', to: 'acme.Db' }])
  expect(iface.isAllowed(ask())).toEqual(yes)
  expect(iface.isAllowed(ask({ port: 'acme.Db/load' }))).toEqual(yes)
  expect(iface.isAllowed(ask({ port: 'acme.Dbx/save' }))).toEqual(no)
  const op = PolicyRules([{ allow: '*', to: 'acme.Db/save' }])
  expect(op.isAllowed(ask())).toEqual(yes)
  expect(op.isAllowed(ask({ port: 'acme.Db/load' }))).toEqual(no)
  expect(PolicyRules([{ allow: '*', to: 'other' }]).isAllowed(ask())).toEqual(no)
})

test('outside', () => {
  const p = PolicyRules([{ allow: '*', outside: true }])
  expect(p.isAllowed(ask({ outside: true }))).toEqual(yes)
  expect(p.isAllowed(ask())).toEqual(no)
})

test('first match wins; a deny names its rule', () => {
  const p = PolicyRules([{ allow: 'call', to: 'db' }, { deny: '*', from: 'a' }, { allow: '*' }])
  expect(p.isAllowed(ask())).toEqual(yes)
  expect(p.isAllowed(ask({ kind: 'pipe' }))).toEqual({ approved: false, reason: 'rules[1]' })
  expect(p.isAllowed(ask({ kind: 'pipe', from: 'b' }))).toEqual(yes)
  expect(PolicyRules([]).isAllowed(ask())).toEqual(no)
})
