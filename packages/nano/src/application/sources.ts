/**
 * A build's sources, run by the application as it runs handlers: each starts once, when its pod is built; each value
 * it yields is published as the pod's event (`ctx.publish`: checked against the event's schema, along pipes and to `on`
 * subscribers); it is stopped (`return()`) when the build closes; a throw is a `failure` of that pod on the stream, and
 * the pod's actions keep working.
 *
 *   start(live, 'todos', ctx, built.sources, c.add)   // after make succeeds
 */
import type { NanoContext } from '../context.ts'
import type { Source } from '../implementation.ts'
import type { Live } from './messages.ts'

export function start(live: Live, pod: string, ctx: Omit<NanoContext, 'deps'>, sources: ReadonlyMap<string, Source>, onClose: NanoContext['addOnCloseListener']) {
  for (const { op, run } of sources.values()) {
    const it = run()[Symbol.asyncIterator]()
    // `return()` queues behind a pending `next()`; that ends because the build's `on` iterations end at close.
    onClose(() => { void it.return?.() })
    void (async () => {
      try { for (let r = await it.next(); !r.done; r = await it.next()) await ctx.publish(op, r.value as never) }
      catch (e) { live.trace.emit({ type: 'failure', pod, reason: `${op.name} threw ${e instanceof Error ? e.message : String(e)}` }) }
    })()
  }
}
