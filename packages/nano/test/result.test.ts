import { describe, expect, test } from 'bun:test'
import { failure, isNanoResult, success } from '../src/result.ts'

describe('NanoResult', () => {
  test('isNanoResult tells results from other values', () => {
    expect(isNanoResult(success(1))).toBe(true)
    expect(isNanoResult(failure('threw', 'boom', 'a/b'))).toBe(true)
    for (const v of [null, undefined, 1, 'ok', {}, { ok: true }, { ok: false }, { ok: false, fail: {} }, { ok: false, fail: { type: 'threw' } }])
      expect(isNanoResult(v)).toBe(false)
  })

  test('failure carries type, reason and optional coord', () => {
    expect(failure('denied', 'no')).toEqual({ ok: false, fail: { type: 'denied', reason: 'no' } })
  })
})
