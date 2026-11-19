/**
 * Drives the deployment's one simulated clock from the time machine: while it is live, each ticker frame calls the
 * clock's `advance(elapsed real ms × speed)` through the app (so replay sees it as a host input), then waits for quiet.
 *
 *   const d = clockDriver(app, registry, tm)   // d.driving: the clock pod's name, or null and d.reason
 */
import { lookup, type Application, type Registry } from '@pritzlaff/nano-core'
import { ClockControl } from '../interfaces.ts'
import { inFlight } from './in-flight.ts'
import type { Ticker, TimeMachine } from './time-machine.ts'

const raf: Ticker = { now: () => Date.now(), frame: fn => { const id = requestAnimationFrame(fn); return () => cancelAnimationFrame(id) } }

export function clockDriver(app: Application, registry: Registry, tm: TimeMachine, opts: { maxHz?: number; ticker?: Ticker } = {}):
  { readonly driving: string | null; readonly reason?: string; close(): void } {
  const ticker = opts.ticker ?? raf, gap = 1000 / (opts.maxHz ?? 20)
  let driving: string | null = null, reason: string | undefined
  const find = () => {
    const d = app.deployment()
    const clocks = Object.keys(d.pods).filter(p => registry.implementation(d.pods[p]!.implementation)?.provides.some(i => i.coord === ClockControl.coord))
    driving = clocks.length === 1 ? clocks[0]! : null
    reason = driving ? undefined : clocks.length ? `${clocks.length} pods provide ClockControl: ${clocks.join(', ')}` : 'no pod provides ClockControl'
  }
  find()
  const unlisten = app.listen(e => { if (e.type === 'applied') find() })
  const flight = inFlight(app)
  let last = ticker.now(), cancel: (() => void) | undefined, closed = false
  const loop = async () => {
    const now = ticker.now()
    if (driving && tm.mode === 'live') {
      if (now - last >= gap) {
        const ms = (now - last) * tm.speed
        last = now
        const runtime = lookup(app.deployment()).placedIn.get(driving)?.[0]
        if (runtime) { await app.call(runtime, driving).advance(ms); await flight.quiet() }
      }
    } else last = now   // not driving: no catching up on resume
    if (!closed) cancel = ticker.frame(loop)
  }
  cancel = ticker.frame(loop)
  return {
    get driving() { return driving }, get reason() { return reason },
    close() { closed = true; cancel?.(); unlisten(); flight.stop() },
  }
}
