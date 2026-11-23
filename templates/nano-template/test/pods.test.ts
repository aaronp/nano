import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { success } from '@pritzlaff/nano-core'
import { Calculator, History } from '../src/interfaces.ts'
import { must, open } from './app.ts'

describe('the template, headless', () => {
  test('a nano.json saved by nano-app (a host document) opens the same', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nano-template-saved-'))
    try {
      const file = join(dir, 'nano.json')
      await Bun.write(file, JSON.stringify({ app: await Bun.file(new URL('../nano.json', import.meta.url)).json(), outline: { title: 'x' }, host: {} }))
      const { app } = await open(undefined, pathToFileURL(file))
      expect(await app.call('main', 'calculator').calculate({ a: 2, op: '+', b: 3 })).toMatchObject({ ok: true, value: { result: 5 } })
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  // #region headless
  test('2 + 3 is 5, and the pipe saves it to the history', async () => {
    const { app } = await open()
    const main = app.runtime('main')
    expect(await main.get(Calculator).calculate({ a: 2, op: '+', b: 3 })).toEqual({ a: 2, op: '+', b: 3, result: 5 })
    expect(await main.get(History).load()).toEqual([{ a: 2, op: '+', b: 3, result: 5 }])
  })
  // #endregion headless

  test('1 / 0 fails invalid-input, and nothing is saved', async () => {
    const { app } = await open()
    const r = await app.call('main', 'calculator').calculate({ a: 1, op: '/', b: 0 })
    expect(r).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(await app.call('main', 'history').load(null)).toEqual(success([]))
  })

  test('each op; with { precision: 2 }, 1 / 3 is 0.33', async () => {
    const calc = (await open()).app.call('main', 'calculator')
    for (const [op, result] of [['+', 7], ['-', 3], ['*', 10], ['/', 2.5]] as const)
      expect(must(await calc.calculate({ a: 5, op, b: 2 }))).toMatchObject({ result })
    const rounded = (await open({ precision: 2 })).app.call('main', 'calculator')
    expect(must(await rounded.calculate({ a: 1, op: '/', b: 3 }))).toMatchObject({ result: 0.33 })
  })

  test('a config that is not { precision: integer } is refused', async () => {
    await expect(open({ precision: 1.5 })).rejects.toThrow()
  })

  test('without localStorage the history is kept in memory', async () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')!
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true })
    try {
      const history = (await open()).app.call('main', 'history')
      must(await history.save({ a: 1, op: '*', b: 1, result: 1 }))
      expect(await history.load(null)).toEqual(success([{ a: 1, op: '*', b: 1, result: 1 }]))
    } finally { Object.defineProperty(globalThis, 'localStorage', saved) }
  })
})
