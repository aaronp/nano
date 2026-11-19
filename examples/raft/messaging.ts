/**
 * `example.raft/messaging`: the one pod every node talks through (the gateway pattern), placed in every node's
 * runtime. `send` draws a latency from its own seeded random, starts a timer on the clock and returns; when the timer
 * fires, the message goes to `to`'s node, chosen by runtime (a node's id is its runtime). A message to a node that
 * is gone (its cluster removed) is dropped, silently.
 *
 *   Pod.eager(messaging, { config: { minMs: 10, maxMs: 30 } })   // wired to a clock and a random in its home runtime
 */
import { Type } from 'typebox'
import { Coord, Implementation, Schema, Selector, provide, success } from '@pritzlaff/nano-core'
import { Clock, Random } from '@pritzlaff/nano-ui'
import { Messaging, RaftNode } from './interfaces.ts'

const ns = Coord.namespace('example.raft')
const Ms = Type.Integer({ minimum: 0, maximum: 60000 })
const TAG = 'delivery'

export const messaging = Implementation.define(ns.implementationId('messaging'), {
  provides: [Messaging],
  config: Schema.define(Type.Union([Type.Object({ minMs: Ms, maxMs: Ms }), Type.Undefined()]), 'MessagingConfig'),
  dependencies: { clock: Clock, random: Random, node: RaftNode },
  make: (ctx, config?: { minMs: number; maxMs: number }) => {
    const { minMs, maxMs } = config ?? { minMs: 10, maxMs: 30 }
    const clock = ctx.one(Clock), random = ctx.one(Random)
    if (!clock.ok) throw new Error(`messaging needs a clock: ${clock.fail.reason}`)
    if (!random.ok) throw new Error(`messaging needs a random: ${random.fail.reason}`)
    const inFlight = new Map<number, { to: string; message: unknown }>()   // by timer id: only our own timers
    clock.value.on(Clock.ops.fired, async ({ output }) => {
      const d = inFlight.get(output.id)
      if (!d) return
      inFlight.delete(output.id)
      const to = ctx.one(Selector.of(RaftNode, { runtime: d.to }))
      if (to.ok) await to.value.call.receive(d.message as never)   // its failure, if any, is the node's, on the stream
    })
    return [provide(Messaging, {
      send: async ({ to, message }) => {
        const r = await random.value.call.next(null)
        if (!r.ok) return r
        const t = await clock.value.call.after({ ms: minMs + Math.floor(r.value * (maxMs - minMs + 1)), tag: TAG })
        if (!t.ok) return t
        inFlight.set(t.value, { to, message })
        return success(null)
      },
    })]
  },
})
