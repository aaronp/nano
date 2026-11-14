/**
 * The pod: the effect boundary a runtime invokes through. Standalone around one instance of one implementation, made
 * from a config; every misbehaviour of a handler (unknown port, bad input or output, a throw, a timeout) is a fail.
 *
 *   const pod = Pod.create(memDb, { config: { size: 10 } })            // 'starting', then 'running' or 'failed'
 *   await pod.invoke(ctx, portKey(DB.coord, DB.ops.get.coord), 'k')    // NanoResult; only a runtime has a ctx to pass
 *   await pod.swap({ config: { size: 20 } })                           // a new instance; calls in flight finish on the old
 */
import { portKey } from './iface.ts'
import type { Op } from './op.ts'
import type { NanoContext } from './context.ts'
import type { Handler, Implementation } from './implementation.ts'
import { failure, isNanoResult, success, type NanoResult } from './result.ts'

export type PodState = 'starting' | 'running' | 'failed' | 'stopped'

export type Pod = {
  readonly implementation: string
  readonly config: unknown
  readonly state: PodState
  /** The runtimes it is registered in, by name, in join order. */
  readonly runtimes: readonly string[]
  /** `port` is a port key: `portKey(ifaceCoord, opCoord)`. Waits for a make in progress; failed or disposed, `missing-component`. */
  invoke(ctx: NanoContext, port: string, input: unknown): Promise<NanoResult<unknown>>
  /** Typed sugar for invoke, by op name: `pod.call.len(ctx, 'abc')`. */
  readonly call: Record<string, (ctx: NanoContext, input: unknown) => Promise<NanoResult<unknown>>>
  /**
   * A new instance (from this config, or the same) made off to the side, switched to if it is made and no later swap was
   * asked meanwhile. Superseded, it resolves `invalid-input`: the latest asked wins even if its make fails (an earlier
   * successful make is discarded, and the pod keeps what it was serving).
   */
  swap(opts?: { config?: unknown }): Promise<NanoResult<void>>
  dispose(): Promise<void>
  /** For runtimes only (`register` calls it): `changed` hears every state change from now; the function returned leaves. Called by hand, it adds `runtime` to `runtimes` and `ctx.runtimes`. */
  join(runtime: string, changed: (state: PodState, reason?: string) => void): () => void
}

type Made = NanoResult<ReadonlyMap<string, Handler>>
type Member = { runtime: string; changed(state: PodState, reason?: string): void }

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

function create(impl: Implementation, opts: { config?: unknown; timeoutMs?: number } = {}): Pod {
  const name = impl.coord, timeoutMs = opts.timeoutMs ?? 30_000
  const ops = new Map<string, Op>()
  const call: Pod['call'] = Object.create(null) // so op names like `toString` are plain keys
  for (const i of impl.provides)
    for (const o of Object.values(i.ops)) {
      const port = portKey(i.coord, o.coord)
      ops.set(port, o)
      if (o.kind !== 'source') call[o.name] = o.name in call
        ? async () => failure('ambiguous', `${name}: ${o.name} is an op of more than one interface; invoke its port`)
        : (ctx, input) => pod.invoke(ctx, port, input)
    }
  const members: Member[] = []
  let config = opts.config, state: PodState = 'starting', asked = 0
  const set = (s: PodState, reason?: string) => {
    state = s
    for (const m of [...members]) try { m.changed(s, reason) } catch { /* a listener must never break the pod */ }
  }
  const stopped = () => state === 'stopped', gone = () => failure('missing-component', `${name} is disposed`)

  /** A config that does not fit the implementation's schema, as a fail. */
  const unfit = (cfg: unknown) => (impl.config && !impl.config.check(cfg) ? failure('invalid-input', `${name}: config does not fit ${impl.config.type}`) : undefined)
  /** Make an instance: an unfit config, a throw, or a make not settled in time (settling late is ignored), is a fail with the reason. */
  async function make(cfg: unknown): Promise<Made> {
    const no = unfit(cfg)
    if (no) return no
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const late = new Promise<'timeout'>(res => { timer = setTimeout(() => res('timeout'), timeoutMs) })
      const made = await Promise.race([Promise.resolve().then(() => impl.make(cfg)), late])
      return made === 'timeout' ? failure('timeout', `${name}: make did not settle in ${timeoutMs}ms`) : success(made)
    } catch (e) {
      return failure('threw', `${name}: ${msg(e)}`)
    } finally {
      clearTimeout(timer)
    }
  }
  /** The instance calls go to, as a promise of its handlers: a call waits for a make in progress. */
  const first = make(config)
  let current = first
  // Still the one serving (no swap switched meanwhile): its outcome is the pod's state.
  void first.then(r => { if (current === first && state === 'starting') set(r.ok ? 'running' : 'failed', r.ok ? undefined : r.fail.reason) })

  async function run(handlers: ReadonlyMap<string, Handler>, ctx: NanoContext, port: string, input: unknown): Promise<NanoResult<unknown>> {
    const o = ops.get(port)
    const h = handlers.get(port)
    if (!o || !h) return failure('unknown-op', `${name}: no port ${port}`)
    if (o.input && !o.input.check(input)) return failure('invalid-input', `${name}: input does not fit ${o.name}`)
    let timer: ReturnType<typeof setTimeout> | undefined
    const outcome = await new Promise<unknown>(resolve => {
      let done = false // a late settle after the timeout is ignored: no second outcome, no unhandled rejection
      const finish = (r: unknown) => { if (!done) { done = true; resolve(r) } }
      timer = setTimeout(() => finish(failure('timeout', `${name}: ${o.name} did not settle in ${timeoutMs}ms`)), timeoutMs)
      Promise.resolve().then(() => h(ctx, input)).then(finish, e => finish(failure('threw', `${name}: ${msg(e)}`)))
    }).finally(() => clearTimeout(timer))
    if (!isNanoResult(outcome)) return failure('invalid-output', `${name}: ${o.name} returned something other than a NanoResult`)
    if (outcome.ok && o.output && !o.output.check(outcome.value)) return failure('invalid-output', `${name}: ${o.name} output does not fit its schema`)
    return outcome
  }

  const pod: Pod = {
    implementation: name,
    get config() { return config },
    get state() { return state },
    get runtimes() { return members.map(m => m.runtime) },
    call,
    async invoke(ctx, port, input) {
      if (stopped()) return gone()
      const made = await current
      if (stopped()) return gone()
      if (made.ok) return run(made.value, ctx, port, input)
      return failure('missing-component', made.fail.reason) // failed, whatever the cause (an unfit config too): the reason says
    },
    async swap(o = {}) {
      if (stopped()) return gone()
      const cfg = 'config' in o ? o.config : config, no = unfit(cfg)
      if (no) return no // changes nothing, and supersedes no swap in progress
      const mine = ++asked
      const next = make(cfg), made = await next
      if (stopped()) return gone()
      if (mine !== asked) return failure('invalid-input', `${name}: swap superseded by a later one`)
      // A failing make leaves a running (or starting) pod on its old instance; a failed one stays failed, with the new reason.
      if (made.ok || state === 'failed') {
        current = next
        config = cfg
        set(made.ok ? 'running' : 'failed', made.ok ? undefined : made.fail.reason)
      }
      return made.ok ? success(undefined) : made
    },
    async dispose() { if (state !== 'stopped') set('stopped') },
    join(runtime, changed) {
      const m: Member = { runtime, changed }
      members.push(m)
      return () => { const i = members.indexOf(m); if (i >= 0) members.splice(i, 1) }
    },
  }
  return pod
}

export const Pod = { create }
