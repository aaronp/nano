/** A host `start` is a host input: replay re-sends it as a start, and the same messages come out. */
import { expect, test } from 'bun:test'
import { success } from '@pritzlaff/nano-core'
import { pair } from '../../src/observe/entry.ts'
import { memoryStore } from '../../src/observe/memory-store.ts'
import { record } from '../../src/observe/record.ts'
import { diverge, replay } from '../../src/observe/replay.ts'
import { must, settle, typing } from './typing.ts'

test('a recorded start of a lazy pod is replayed as a start: no divergence', async () => {
  const app = await typing(), d = app.deployment()
  must(await app.apply({ ...d, pods: { ...d.pods, log: { ...d.pods['log']!, eager: false } } }))
  must(await app.restart('log'))
  expect(app.runtime('main').status('log')).toEqual(success('not started'))
  const first = memoryStore()
  const rec = await record(app, first, { clean: true })
  must(await app.runtime('main').start('log'))
  await settle(); rec.stop()

  const second = memoryStore()
  const again = await record(app, second)
  const r = must(await replay(app, first, { sleep: async () => {} }))
  expect(r).toMatchObject({ sent: 1, failed: 0 })
  await settle(); again.stop()
  expect(app.runtime('main').status('log')).toEqual(success('running'))
  expect(diverge(pair(await first.range(r.from, r.to)), pair(await second.range()))).toBeNull()
})
