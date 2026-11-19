/**
 * Keeps a view fresh from the `AppEvent` stream, never the wall clock: `refresh` runs once now and again after each
 * delivered message in the view's runtime (or a sim clock `advance`), except the views' own reads. Returns the stop.
 */
import { port, type AppEvent } from '@pritzlaff/nano-core'
import { Clock, ClockControl } from '@pritzlaff/nano-ui'
import { Cluster, Ledger, RaftNode } from '../interfaces.ts'
import type { ViewTarget } from '@pritzlaff/nano-ui'

const reads = [port(RaftNode, RaftNode.ops.status), port(Ledger, Ledger.ops.read), port(Cluster, Cluster.ops.list), port(Clock, Clock.ops.now)]
const advance = port(ClockControl, ClockControl.ops.advance)

export function follow(t: ViewTarget, refresh: () => void): () => void {
  const waiting = new Set<string>()
  const off = t.app.listen((e: AppEvent) => {
    if (e.type === 'sent' && !reads.includes(e.port) && (e.runtime === t.runtime || e.port === advance)) waiting.add(e.id)
    else if (e.type === 'delivered' && waiting.delete(e.id)) refresh()
  })
  refresh()
  return off
}
