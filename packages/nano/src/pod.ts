/**
 * Host pods: run one instance's handlers in-process and turn every misbehaviour into a NanoResult fail plus an observation.
 *
 *   const pod = await createHostPod('acme/mem/db#1', memDb, ctx, { observe: o => log.push(o) })
 *   if (pod.ok) await pod.value.invoke(portKey(db.coord, db.ops.get.coord), 'k')   // NanoResult
 */
import { portKey } from './iface.ts'
import type { Op } from './op.ts'
import type { NanoContext } from './context.ts'
import type { Handler, Implementation } from './implementation.ts'
import { failure, isNanoResult, type NanoResult } from './result.ts'

export type Observation =
  | { kind: 'message'; instance: string; op: string; input: unknown; result: NanoResult<unknown>; ms: number }
  | { kind: 'exception'; instance: string; op: string; error: string }

export type Pod = {
  readonly instance: string
  readonly implementation: Implementation
  /** `port` is a port key: `portKey(ifaceCoord, opCoord)`. */
  invoke(port: string, input: unknown): Promise<NanoResult<unknown>>
  dispose(): void
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function createHostPod(
  instance: string,
  impl: Implementation,
  ctx: NanoContext,
  opts: { timeoutMs?: number; observe?(o: Observation): void } = {},
): Promise<NanoResult<Pod>> {
  let handlers: ReadonlyMap<string, Handler>
  try {
    handlers = await impl.make(ctx)
  } catch (e) {
    return failure('threw', `${instance}: ${msg(e)}`)
  }
  const ops = new Map<string, Op>()
  for (const i of impl.provides) for (const o of Object.values(i.ops)) ops.set(portKey(i.coord, o.coord), o)
  const timeoutMs = opts.timeoutMs ?? 30_000
  let disposed = false

  async function run(port: string, input: unknown): Promise<NanoResult<unknown>> {
    const o = ops.get(port)
    const h = handlers.get(port)
    if (!o || !h) return failure('unknown-op', `${instance}: no port ${port}`)
    if (o.input && !o.input.check(input)) return failure('invalid-input', `${instance}: input does not fit ${o.name}`)
    let timer: ReturnType<typeof setTimeout> | undefined
    const outcome = await new Promise<NanoResult<unknown>>(resolve => {
      let done = false // a late settle after the timeout is ignored: no second observation, no unhandled rejection
      const finish = (r: NanoResult<unknown>) => { if (!done) { done = true; resolve(r) } }
      timer = setTimeout(() => finish(failure('timeout', `${instance}: ${o.name} did not settle in ${timeoutMs}ms`)), timeoutMs)
      const threw = (e: unknown) => {
        if (done) return
        opts.observe?.({ kind: 'exception', instance, op: port, error: msg(e) })
        finish(failure('threw', `${instance}: ${msg(e)}`))
      }
      try {
        h(ctx, input).then(finish, threw)
      } catch (e) {
        threw(e)
      }
    }).finally(() => clearTimeout(timer))
    return outcome
  }

  const pod: Pod = {
    instance,
    implementation: impl,
    async invoke(port, input) {
      if (disposed) return failure('not-found', `${instance} is disposed`)
      const t0 = performance.now()
      let result = await run(port, input)
      const o = ops.get(port)
      if (o && handlers.has(port)) {
        if (!isNanoResult(result)) result = failure('invalid-output', `${instance}: ${o.name} returned something other than a NanoResult`)
        else if (result.ok && o.output && !o.output.check(result.value)) result = failure('invalid-output', `${instance}: ${o.name} output does not fit its schema`)
      }
      opts.observe?.({ kind: 'message', instance, op: port, input, result, ms: performance.now() - t0 })
      return result
    },
    dispose() { disposed = true },
  }
  return { ok: true, value: pod }
}
