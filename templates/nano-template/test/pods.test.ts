import { describe, expect, test } from 'bun:test'
import { success } from '@pritzlaff/nano-core'
import { must, open, sleep } from './app.ts'

describe('the template, headless', () => {
  // #region headless
  test('the timer ticks into the store, then stops', async () => {
    const { app } = await open()
    const timer = app.call('main', 'timer'), store = app.call('main', 'store')
    must(await timer.start(null))
    await sleep(60)
    must(await timer.stop(null))
    await sleep(20)
    const at = must(await store.get('tick')) as string
    expect(Number(at)).toBeGreaterThan(1)
    await sleep(40)
    expect(await store.get('tick')).toEqual(success(at))
  })
  // #endregion headless

  test('a pick reaches the store through the picker.changed pipe', async () => {
    const { app } = await open()
    must(await app.call('main', 'picker').pick('green'))
    await sleep(20)
    expect(await app.call('main', 'store').get('choice')).toEqual(success('green'))
  })

  test('a pick outside the options fails, and setOptions changes what is accepted', async () => {
    const { app } = await open()
    const picker = app.call('main', 'picker')
    expect((await picker.pick('purple')).ok).toBe(false)
    must(await picker.setOptions(['purple']))
    expect(await picker.options(null)).toEqual(success(['purple']))
    must(await picker.pick('purple'))
    expect((await picker.pick('red')).ok).toBe(false)
  })

  test('the store sets, lists and removes', async () => {
    const { app } = await open()
    const store = app.call('main', 'store')
    must(await store.set({ key: 'a', value: '1' }))
    expect(await store.entries(null)).toEqual(success({ a: '1' }))
    must(await store.remove('a'))
    expect(await store.get('a')).toEqual(success(null))
  })

  test('without localStorage the store keeps its entries in memory', async () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')!
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true })
    try {
      const store = (await open()).app.call('main', 'store')
      must(await store.set({ key: 'k', value: 'v' }))
      expect(await store.get('k')).toEqual(success('v'))
    } finally { Object.defineProperty(globalThis, 'localStorage', saved) }
  })
})
