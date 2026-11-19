// The sandbox protocol over a MessageChannel, no iframe; see sandbox-harness.ts for the pods and the frame.
import { afterEach, expect, test } from 'bun:test'
import { Ticks, H, must, st, relay, tick, reset, harness } from './sandbox-harness.ts'

afterEach(reset)

test("given on in the frame, then the host subscribes as the frame's pod and forwards each emission until return()", async () => {
  const { app, events } = await harness()
  await app.call('r', 's').echo!('x')
  const it = must(st.inFrame!.one(H)).on(H.ops.said)[Symbol.asyncIterator]()
  await tick(10)
  await st.inH!.publish(H.ops.said, 4)
  expect(await it.next()).toEqual({ done: false, value: { output: 4 } })
  expect(events).toContainEqual(expect.objectContaining({ type: 'sent', kind: 'subscribe', from: 's', to: 'h', port: 't.H/said' }))
  await it.return!()
  await tick(10)
  expect(events).toContainEqual(expect.objectContaining({ type: 'sent', kind: 'unsubscribe', from: 's', to: 'h' }))
  await app.close()
})

test('given a callback on in the frame, then it hears emissions until the frame closes, and nothing is left host-side', async () => {
  const { app, events } = await harness()
  await app.call('r', 's').echo!('x')
  const heard: unknown[] = []
  must(st.inFrame!.one(H)).on(H.ops.said, e => { heard.push(e.output) })
  await tick(10)
  await st.inH!.publish(H.ops.said, 1)
  await tick(10)
  expect(heard).toEqual([1])
  await app.restart('s')
  await tick(10)
  await st.inH!.publish(H.ops.said, 2)
  await tick(10)
  expect(heard).toEqual([1])
  expect(events.filter(e => e.type === 'sent' && e.kind === 'unsubscribe' && e.from === 's')).toHaveLength(1)
  await app.close()
})

test("given the runtime's policy refuses s's subscribe, then on in the frame fails denied", async () => {
  const { app, toasts } = await harness({ deny: true })
  await app.call('r', 's').echo!('x')
  const it = must(st.inFrame!.one(H)).on(H.ops.said)[Symbol.asyncIterator]()
  expect(it.next()).rejects.toMatchObject({ fail: { type: 'denied' } })
  must(st.inFrame!.one(H)).on(H.ops.said, () => {})
  await tick(10)
  expect(toasts.join()).toContain('denied')
  await app.close()
})

test("given a sandboxed pod's source, then it runs in the frame and the host hears its values", async () => {
  const { app } = await harness({ relay: true })
  const it = app.runtime('r').get(Ticks, { pod: 'p' }).tick()[Symbol.asyncIterator]()
  await tick(20)
  await st.inH!.publish(H.ops.said, 1)
  expect(await it.next()).toEqual({ done: false, value: 2 })
  await it.return!()
  await app.close()
})

test("given the frame's view iterates its own pod's event, then it hears what the pod publishes", async () => {
  const { app } = await harness()
  await app.call('r', 's').echo!('x')
  const it = st.view!.app.runtime('r').get(Ticks, { pod: 's' }).tick()[Symbol.asyncIterator]()
  await tick(10)
  await st.inFrame!.publish(Ticks.ops.tick, 7)
  expect(await it.next()).toEqual({ done: false, value: 7 })
  await it.return!()
  await app.close()
})
