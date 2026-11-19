// The sandbox protocol over a MessageChannel, no iframe; see sandbox-harness.ts for the pods and the frame.
import { afterEach, expect, test } from 'bun:test'
import { Pod, AppDeployment, success } from '@pritzlaff/nano-core'
import { edgesFor } from '../src/sandbox/edges.ts'
import { Ticks, H, must, st, seen, sImpl, hImpl, registry, dep, tick, reset, harness } from './sandbox-harness.ts'

afterEach(reset)

test('given a sandboxed pod, then a call crosses the port and is on the stream', async () => {
  const { app, events } = await harness()
  expect(await app.call('r', 's').echo!('x')).toEqual(success('x'))
  const sent = events.find(e => e.type === 'sent' && e.to === 's' && e.port === 't.Echo/echo') as { id: string } | undefined
  expect(sent).toBeDefined()
  expect(events).toContainEqual(expect.objectContaining({ type: 'delivered', id: sent!.id, result: success('x') }))
  await app.close()
})

test('given the frame calls out through its edge, then h hears it', async () => {
  const { app } = await harness()
  await app.call('r', 's').echo!('x')
  expect(await must(st.inFrame!.one(H)).call.record(1)).toEqual(success(null))
  expect(seen).toEqual([1])
  await app.close()
})

test('given the frame publishes tick, then the pipe delivers it to h.record', async () => {
  const { app } = await harness()
  await app.call('r', 's').echo!('x')
  await st.inFrame!.publish(Ticks.ops.tick, 2)
  await tick(10)
  expect(seen).toEqual([2])
  await app.close()
})

test('given apply removes s → h, then the frame sees no H and an outcall sent anyway is not-found', async () => {
  const { app } = await harness()
  await app.call('r', 's').echo!('x')
  const stale = must(st.inFrame!.one(H))
  expect(await app.apply(dep(false))).toEqual(success(undefined))
  await tick(10)
  expect(st.inFrame!.one(H).ok).toBe(false)
  expect(await stale.call.record(3)).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  expect(seen).toEqual([])
  await app.close()
})

test("a call edge in another runtime (its target's, the caller outside) is the caller's edge, as nano's ctx.one has it", () => {
  const d: AppDeployment = { pods: { s: Pod.lazy(sImpl), h: Pod.lazy(hImpl) },
    runtimes: { front: { pods: ['s'], subscriptions: [] }, back: { pods: ['h'], subscriptions: [{ kind: 'call', from: 's', to: 'h' }] } } }
  expect(edgesFor(d, registry, 's')).toEqual([{ pod: 'h', runtime: 'back', implementation: hImpl.coord, provider: hImpl.provider, provides: ['t.H'], tags: [] }])
})
