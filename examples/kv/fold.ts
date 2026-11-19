/**
 * A KV store's contents at any time, folded from the recorded history (no re-running): its config's entries, then
 * every put and delete to it that succeeded, reset to its config whenever a deployment changes its implementation or
 * config (the pod is rebuilt). It assumes what it can't see does nothing: a restart of the pod (which empties it back
 * to its config) and writes that reach the store other than through its put and delete are not in the fold. Once the
 * clean start is evicted, it starts from no entries and misses the configured ones until the next apply that changes
 * the pod's implementation or config.
 *
 *   (await foldAt(store, t, kvStep('kv'))).entries   // what list({ prefix: [] }) gave at t
 */
import { port, type AppDeployment } from '@pritzlaff/nano-core'
import type { Message } from '@pritzlaff/nano-ui'
import { KeyValueStoreDef } from './contract.ts'
import { order } from './memory.ts'

type Entry = KeyValueStoreDef.Entry
/** `spec`: the pod's implementation and config as last deployed (JSON), to tell a change. */
type Folded = { entries: Entry[]; spec?: string }

const { api } = KeyValueStoreDef
const PUT = port(api, api.ops.put), DELETE = port(api, api.ops.delete)
const same = (a: KeyValueStoreDef.Path) => (e: Entry) => JSON.stringify(e.key) === JSON.stringify(a)
const without = (es: Entry[], key: KeyValueStoreDef.Path) => es.filter(e => !same(key)(e))
const set = (es: Entry[], e: Entry) => [...without(es, e.key), e].sort((a, b) => order(a.key, b.key))

/** The reducer for `foldAt` over the KV store pod `pod`; `entries` are in `list` order. */
export function kvStep(pod: string) {
  return {
    initial: { entries: [] } as Folded,
    step(s: Folded, m: Message): Folded {
      if (m.sent.to !== pod || m.outcome?.type !== 'delivered' || !m.outcome.ok || m.sent.input === undefined) return s
      if (m.sent.port === PUT) return { ...s, entries: set(s.entries, JSON.parse(m.sent.input)) }
      if (m.sent.port === DELETE) return { ...s, entries: without(s.entries, JSON.parse(m.sent.input)) }
      return s
    },
    deployment(s: Folded, d: AppDeployment): Folded {
      const p = d.pods[pod], spec = p && JSON.stringify([p.implementation, p.config])
      if (spec === s.spec) return s
      return { spec, entries: ((p?.config as { entries?: Entry[] } | undefined)?.entries ?? []).reduce(set, []) }
    },
  }
}
