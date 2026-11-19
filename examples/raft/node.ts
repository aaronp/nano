/**
 * `example.raft/node`: one Raft node, the pure `step` (core/) wired to its context. Each input (a message, an action,
 * its own timer) runs one step, one at a time; then its effects: `persist` is written to the ledger before any `send`
 * goes out through messaging, and `refused` is the op's failure (`invalid-input`). `changed` follows each step that
 * changes the status.
 *
 * Time: one timer at a time on the wired clock, armed for the next moment the node has work due (its election
 * alarm, a peer's retry or heartbeat), so a quiet cluster records a few timers, not a tick every few ms.
 *
 * `timing` (optional) is the election range and heartbeat in ms; the core's default when absent.
 *
 *   Pod.eager(node, { config: { id: 'example-1', peers: ['example-2', 'example-3'] } })   // id: its runtime
 */
import { Type } from 'typebox'
import { Coord, Implementation, Schema, failure, provide, success, type NanoResult } from '@pritzlaff/nano-core'
import { Clock, Random } from '@pritzlaff/nano-ui'
import { Ledger, Messaging, RaftNode } from './interfaces.ts'
import { initial, step } from './core/step.ts'
import { lastIndex, type Input, type Node } from './core/types.ts'

const ns = Coord.namespace('example.raft')
const DRAWS = 3   // the most draws one step takes (a step-down and a vote each re-arm the alarm, plus spare)

/** When this node next has work for a tick; none while stopped (only `resume` wakes it). */
function nextDue(n: Node): number | undefined {
  if (n.stopped) return undefined
  const peers = Object.values(n.progress)
  if (n.role === 'leader') return Math.min(...peers.map(p => p.next <= lastIndex(n.p) ? Math.min(p.rpcDue, p.heartbeatDue) : p.heartbeatDue))
  if (n.role === 'candidate') return Math.min(n.electionAlarm, ...peers.map(p => p.rpcDue))
  return n.electionAlarm
}

export const node = Implementation.define(ns.implementationId('node'), {
  provides: [RaftNode],
  config: Schema.define(Type.Object({ id: Type.String(), peers: Type.Array(Type.String()), timing: Type.Optional(Type.Object({ electionMin: Type.Number(), electionMax: Type.Number(), heartbeat: Type.Number() })) }), 'NodeConfig'),
  dependencies: { messaging: Messaging, ledger: Ledger, clock: Clock, random: Random },
  make: (ctx, { id, peers, timing }: { id: string; peers: string[]; timing?: Node['timing'] }) => {
    const wired = <T>(r: NanoResult<T>, what: string): T => { if (!r.ok) throw new Error(`node ${id} needs ${what}: ${r.fail.reason}`); return r.value }
    const messaging = wired(ctx.one(Messaging), 'messaging'), ledger = wired(ctx.one(Ledger), 'a ledger')
    const clock = wired(ctx.one(Clock), 'a clock'), random = wired(ctx.one(Random), 'a random')
    let n: Node, armed: { id: number; due: number } | undefined, closed = false
    let queue: Promise<unknown> = Promise.resolve()   // inputs run one at a time, effects included
    const serial = <T>(f: () => Promise<T>) => (queue = queue.then(f, f)) as Promise<T>

    // `step` draws synchronously; the seeded random answers asynchronously, so a few draws are fetched ahead.
    const pool: number[] = []
    const fill = async () => { while (pool.length < DRAWS) { const r = await random.call.next(null); if (!r.ok) return r; pool.push(r.value) } }
    const draw = () => { const x = pool.shift(); if (x === undefined) throw new Error('more draws than DRAWS'); return x }

    /** The one timer, re-armed only when the due time moves. */
    const arm = async (now: number) => {
      const due = nextDue(n)
      if (due === armed?.due) return
      if (armed) void clock.call.cancel(armed.id)
      armed = undefined
      if (due === undefined || closed) return
      const t = await clock.call.after({ ms: Math.max(0, Math.ceil(due - now)), tag: id })
      if (t.ok) armed = { id: t.value, due }
    }
    /** One step and its effects. `at`: the time, when the input brings it (a timer's). */
    const run = (input: Input | (() => Promise<NanoResult<Input>>), at?: number) => serial(async (): Promise<NanoResult<null>> => {
      if (closed) return failure('not-found', `node ${id} is closed`)
      const i = typeof input === 'function' ? await input() : success(input)
      if (!i.ok) return i
      const now = at === undefined ? await clock.call.now(null) : success(at)
      if (!now.ok) return now
      const short = await fill()
      if (short) return short
      const before = JSON.stringify(n), r = step(n, i.value, now.value, draw)
      n = r.node
      try {
        for (const e of r.effects) {
          const done = e.kind === 'persist' ? await ledger.call.write(e.p)
            : e.kind === 'send' ? await messaging.call.send({ to: e.to, message: { ...e.rpc, from: id } }) : success(null)
          if (!done.ok) return done
        }
      } finally {   // a failed effect still leaves the node published and on its timer
        if (JSON.stringify(n) !== before) await ctx.publish(RaftNode.ops.changed, n)
        await arm(now.value)
      }
      const refused = r.effects.find(e => e.kind === 'refused')
      return refused ? failure('invalid-input', refused.leader ? `${refused.reason}: the leader is ${refused.leader}` : refused.reason) : success(null)
    })

    // Built: load the ledger and start as a follower, then on its own timer only (the clock is shared).
    void serial(async () => {
      const p = await ledger.call.read(null), now = await clock.call.now(null)
      if (!p.ok || !now.ok || (await fill())) return
      n = initial(id, peers, p.value, now.value, draw, timing)
      await arm(now.value)
    })
    clock.on(Clock.ops.fired, ({ output }) => {
      if (output.id !== armed?.id) return
      armed = undefined
      void run({ kind: 'tick' }, output.at)
    })
    ctx.addOnCloseListener(() => { closed = true; if (armed) void clock.call.cancel(armed.id) })

    return [provide(RaftNode, {
      receive: async ({ from, ...rpc }) => run({ kind: 'receive', from, rpc }),
      request: async value => run({ kind: 'request', value }),
      timeOut: async () => run({ kind: 'time-out' }),
      stop: async () => run({ kind: 'stop' }),
      resume: async () => run({ kind: 'resume' }),
      restart: async () => run(async () => { const p = await ledger.call.read(null); return p.ok ? success<Input>({ kind: 'restart', p: p.value }) : p }),
      status: () => serial(async () => success(n)),
    })]
  },
})
