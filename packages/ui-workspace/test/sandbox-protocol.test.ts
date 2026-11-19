// The sandbox protocol over a MessageChannel, no iframe; see sandbox-harness.ts for the pods and the frame.
import { afterEach, expect, test } from 'bun:test'
import { success } from '@pritzlaff/nano-core'
import { checkMsg } from '../src/sandbox/protocol.ts'
import { tick, reset } from './sandbox-harness.ts'

afterEach(reset)

test('subscription messages: ids are numbers, ops strings, results results', () => {
  expect(checkMsg({ type: 'on', id: 1, pod: 'h', runtime: 'r', op: 't.H/said' })).toMatchObject({ type: 'on' })
  expect(checkMsg({ type: 'on', id: '1', pod: 'h', runtime: 'r', op: 't.H/said' })).toBe('on: bad id')
  expect(checkMsg({ type: 'view-on', id: 1, op: 5 })).toBe('view-on: bad op')
  expect(checkMsg({ type: 'off', id: 1 })).toEqual({ type: 'off', id: 1 })
  expect(checkMsg({ type: 'emission', id: 1, event: { output: 1 } })).toMatchObject({ type: 'emission' })
  expect(checkMsg({ type: 'ended', id: 1, result: { nope: 1 } })).toBe('ended: bad result')
})

test('given non-JSON clone types, then checkMsg sizes and returns only their JSON', () => {
  expect(checkMsg({ type: 'publish', op: 'tick', data: new Map([['k', 'x'.repeat(5 * 1024 * 1024)]]) })).toEqual({ type: 'publish', op: 'tick', data: {} })
  expect(checkMsg({ type: 'publish', op: 'tick', data: new ArrayBuffer(50 * 1024 * 1024) })).toEqual({ type: 'publish', op: 'tick', data: {} })
  expect(checkMsg({ type: 'publish', op: 'tick', data: { big: 'x'.repeat(2 * 1024 * 1024), m: new Map() } })).toContain('over 1 MiB')
  expect(checkMsg({ type: 'result', id: 1, result: success(undefined) })).toEqual({ type: 'result', id: 1, result: success(undefined) })
})

test('a theme message carries a known theme id and mode, never CSS', () => {
  expect(checkMsg({ type: 'theme', theme: 'enterprise', mode: 'dark' })).toEqual({ type: 'theme', theme: 'enterprise', mode: 'dark' })
  expect(checkMsg({ type: 'theme', theme: 'nope', mode: 'dark' })).toBe('theme: bad theme')
  expect(checkMsg({ type: 'theme', theme: 'enterprise', mode: 'neon' })).toBe('theme: bad mode')
  expect(checkMsg({ type: 'theme', theme: 'body{background:red}', mode: 'light' })).toBe('theme: bad theme')
  expect(checkMsg({ type: 'theme', theme: 'toString', mode: 'light' })).toBe('theme: bad theme')
})
