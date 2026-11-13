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
  const timeoutMs = opts.timeoutMs ?? 30_000
  let handlers: ReadonlyMap<string, Handler>
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    // Same timeout as a handler; a make settling late is ignored (Promise.race drops it), so its handlers are never used.
    const late = new Promise<'timeout'>(res => { timer = setTimeout(() => res('timeout'), timeoutMs) })
    const made = await Promise.race([Promise.resolve().then(() => impl.make(ctx)), late])
    if (made === 'timeout') return failure('timeout', `${instance}: make did not settle in ${timeoutMs}ms`)
    handlers = made
  } catch (e) {
    return failure('threw', `${instance}: ${msg(e)}`)
  } finally {
    clearTimeout(timer)
  }
  const ops = new Map<string, Op>()
  for (const i of impl.provides) for (const o of Object.values(i.ops)) ops.set(portKey(i.coord, o.coord), o)
  let disposed = false

  const safeObserve = (o: Observation) => {
    try { opts.observe?.(o) } catch { /* an observer must never break a call */ }
  }

  async function run(port: string, input: unknown): Promise<NanoResult<unknown>> {
    const o = ops.get(port)
    const h = handlers.get(port)
    if (!o || !h) return failure('unknown-op', `${instance}: no port ${port}`)
    if (o.input && !o.input.check(input)) return failure('invalid-input', `${instance}: input does not fit ${o.name}`)
    let timer: ReturnType<typeof setTimeout> | undefined
    const outcome = await new Promise<unknown>(resolve => {
      let done = false // a late settle after the timeout is ignored: no second observation, no unhandled rejection
      const finish = (r: unknown) => { if (!done) { done = true; resolve(r) } }
      timer = setTimeout(() => finish(failure('timeout', `${instance}: ${o.name} did not settle in ${timeoutMs}ms`)), timeoutMs)
      const threw = (e: unknown) => {
        if (done) return
        safeObserve({ kind: 'exception', instance, op: port, error: msg(e) })
        finish(failure('threw', `${instance}: ${msg(e)}`))
      }
      Promise.resolve().then(() => h(ctx, input)).then(finish, threw)
    }).finally(() => clearTimeout(timer))
    if (!isNanoResult(outcome)) return failure('invalid-output', `${instance}: ${o.name} returned something other than a NanoResult`)
    if (outcome.ok && o.output && !o.output.check(outcome.value)) return failure('invalid-output', `${instance}: ${o.name} output does not fit its schema`)
    return outcome
  }

  const pod: Pod = {
    instance,
    implementation: impl,
    async invoke(port, input) {
      const t0 = performance.now()
      const result = disposed ? failure('not-found', `${instance} is disposed`) : await run(port, input)
      safeObserve({ kind: 'message', instance, op: port, input, result, ms: performance.now() - t0 })
      return result
    },
    dispose() { disposed = true },
  }
  return { ok: true, value: pod }
}
