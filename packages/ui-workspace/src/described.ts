/**
 * A provider rebuilt from its description (a `described` message), and probing a module for one in a throwaway frame.
 * The rebuilt implementations have the real ones' coords, interfaces (so the same op hashes), dependencies and config;
 * their `make` throws, since nothing was loaded: import wraps it.
 *
 *   described(describeProvider(acme, views))           // NanoResult<{ provider, views }>, views only its own
 *   await probe(url, () => openFrame('isolated-sandbox'))   // the module at `url` described from inside a frame
 */
import {
  Coord,
  Schema,
  failure,
  Interface,
  Implementation,
  Op,
  Provider,
  success,
  type NanoResult,
  type SchemaDef,
  type SelectorData,
} from '@pritzlaff/nano-core'
import type { ViewMap } from '@pritzlaff/nano-ui'
import { checkMsg, type Described, type SchemaJson } from './sandbox/protocol.ts'
import { READY_MS, type Frame } from './sandbox/stand-in.ts'
import type { Built } from './built.ts'

export type Probed = { provider: Provider; views: ViewMap; built?: Built }

const TAG = /^[a-z][a-z0-9._]*-[a-z0-9._-]*$/
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const schema = (s: SchemaJson) => Schema.define(s.schema as never, s.type || undefined) as SchemaDef
type Written = Described['implementations'][number]['dependencies'][string]
/** Only the selector fields, each read back to its coordinate, so an extra key (a `byCoord`) cannot pass for an interface. */
const selector = ({ implements: i, tags, implementation: m, provider: p, runtime: r }: Written): SelectorData =>
  ({ ...(i !== undefined && { implements: Coord.parse('interface', i) }), ...(tags && { tags }),
    ...(m !== undefined && { implementation: Coord.parse('implementation', m) }),
    ...(p !== undefined && { provider: Coord.parse('namespace', p) }), ...(r !== undefined && { runtime: Coord.parse('runtime', r) }) })

/** `d` as a Provider, and the view tags of its own implementations. Never throws. */
export function described(d: Described): NanoResult<Probed> {
  try {
    const impls = d.implementations.map(i => Implementation.define(i.coord, {
      provides: i.provides.map(f => Interface.define(f.coord, Object.fromEntries(f.ops.map(o => {
        const opts = o.description !== undefined ? { description: o.description } : undefined
        const made = o.kind === 'event' ? Op.event(schema(o.output!), opts) : Op.action(schema(o.input!), schema(o.output!), opts)
        return [o.name, made]
      })))),
      dependencies: Object.fromEntries(Object.entries(i.dependencies).map(([role, s]) => [role, selector(s)])),
      ...(i.config && { config: schema(i.config) }), ...(i.description !== undefined && { description: i.description }),
      make: () => { throw new Error(`${i.coord} was only probed`) },
    }))
    // Only its own implementations' views, and only custom element names (an invalid one would throw where it is made).
    const own = new Set(impls.map(i => i.coord)), ok = ([c, tag]: [string, string]) => own.has(c) && TAG.test(tag)
    return success({ provider: Provider.define(d.coord, impls, { ...d.meta }), views: Object.fromEntries(Object.entries(d.views).filter(ok)),
      ...(d.built && { built: { ...d.built } }) })
  } catch (e) {
    return failure('invalid-input', `${d.coord}: a bad description: ${message(e)}`)
  }
}

/** The module at `url` described by a frame from `open` (an isolated-sandbox one), which is disposed after. Never throws. */
export function probe(url: string, open: () => Frame, ms = READY_MS): Promise<NanoResult<Probed>> {
  return new Promise(resolve => {
    const f = open()
    const done = (r: NanoResult<Probed>) => { clearTimeout(timer); f.port.onmessage = null; f.dispose(); resolve(r) }
    const timer = setTimeout(() => done(failure('invalid-input', `${url}: no description within ${ms}ms`)), ms)
    f.port.onmessage = ({ data }) => {
      const m = checkMsg(data)
      if (typeof m === 'string') return done(failure('invalid-input', `${url}: a malformed message: ${m}`))
      if (m.type === 'failed') return done(failure('invalid-input', `${url}: ${m.error}`))
      if (m.type !== 'described') return
      if (m.providers.length !== 1) return done(failure('invalid-input', `${url}: described ${m.providers.length} providers`))
      done(described(m.providers[0]!))
    }
    f.ready.then(() => f.port.postMessage({ type: 'probe', url }), e => done(failure('invalid-input', `${url}: ${message(e)}`)))
  })
}
