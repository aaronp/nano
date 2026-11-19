import { expect, test } from 'bun:test'
import { memoryStore } from '../../src/observe/memory-store.ts'
import { storeContract } from './store-contract.ts'

storeContract(max => memoryStore({ max }))

test('the default max is 100000', async () => {
  const store = memoryStore()
  for (let seq = 1; seq <= 100001; seq++) store.append({ seq, at: seq, event: { type: 'deployment', deployment: {} as never } })
  expect(await store.size()).toBe(100000)
  expect(await store.oldest()).toBe(2)
})
