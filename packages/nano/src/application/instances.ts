/**
 * Instances: at most one build per pod name, shared by everyone who needs it meanwhile. A failed build caches nothing,
 * so the next need builds again; forgetting drops the entry without touching builds already handed out.
 *
 *   const pods = instances(live)
 *   await pods.get('db')   // NanoResult<{ implementation, handlers by port }>: built now, or the build already made or under way
 *   pods.forget('db')      // the next get builds a fresh closure; calls in flight keep the old one
 */
import { failure, success } from '../result.ts'
import { contextFor } from './context.ts'
import { within, type Live } from './messages.ts'

type Made = ReturnType<Live['instance']>

export function instances(live: Live) {
  const made = new Map<string, Made>()

  async function build(name: string): Made {
    const pod = live.now().pods[name]
    const impl = pod && live.registry.implementation(pod.implementation)
    if (!pod || !impl) return failure('not-found', `no pod ${name}`)
    const r = await within(() => impl.make(contextFor(live, name), pod.config), live.timeoutMs, `building ${name}`)
    live.trace.emit(r.ok ? { type: 'built', pod: name } : { type: 'failure', pod: name, reason: r.fail.reason })
    return r.ok ? success({ implementation: impl, handlers: r.value }) : r
  }

  return {
    get(name: string): Made {
      let p = made.get(name)
      if (!p) {
        const mine: Made = build(name)
        made.set(name, (p = mine))
        void mine.then(r => { if (!r.ok && made.get(name) === mine) made.delete(name) })
      }
      return p
    },
    forget: (name: string) => { made.delete(name) },
  }
}
