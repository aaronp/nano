/**
 * Coordinates: typed, layered names for what a contract or a provider defines, and for a running instance. Each is a
 * frozen value whose `toString()` is the string form saved in deployments; `Coord.parse(kind, s)` reads one back.
 *
 *   const kv = Coord.namespace('example.kv')          // an author's namespace
 *   const store = kv.interface('KeyValueStore')        // example.kv.KeyValueStore
 *   const mem = kv.implementation('memory')            // example.kv/memory
 *   Coord.port(store, 'get')                           // example.kv.KeyValueStore/get
 *   Coord.pod(mem, 'main', 'store')                    // example.kv/memory@main/store
 */
export type Namespace = {
  readonly kind: 'namespace'
  readonly name: string
  interface(name: string): InterfaceCoord
  implementation(name: string): ImplCoord
}
export type InterfaceCoord = { readonly kind: 'interface'; readonly ns: Namespace; readonly name: string }
export type ImplCoord = { readonly kind: 'implementation'; readonly ns: Namespace; readonly name: string }
export type PortCoord = { readonly kind: 'port'; readonly interface: InterfaceCoord; readonly op: string }
export type PodCoord = { readonly kind: 'pod'; readonly implementation: ImplCoord; readonly runtime: string; readonly pod: string }
type Kinds = { namespace: Namespace; interface: InterfaceCoord; implementation: ImplCoord; port: PortCoord; pod: PodCoord }

const NS = /^[a-zA-Z][a-zA-Z0-9-]*([./][a-zA-Z0-9-]+)*$/
const NAME = /^[a-zA-Z0-9-]+$/
const ID = /^[^/@\s#\x00-\x1f\x7f]{1,64}$/   // a runtime id or pod name (the id rule, and no `@`)

const check = (ok: boolean, what: string, v: string) => { if (!ok) throw new Error(`bad ${what} ${JSON.stringify(v)}`) }
const value = <T extends object>(v: T, text: string): T => Object.freeze(Object.assign(v, { toString: () => text }))

function namespace(name: string): Namespace {
  check(NS.test(name), 'namespace', name)
  const ns: Namespace = value({
    kind: 'namespace' as const, name,
    interface: (n: string) => { check(NAME.test(n), 'name', n); return value({ kind: 'interface' as const, ns, name: n }, `${name}.${n}`) },
    implementation: (n: string) => { check(NAME.test(n), 'name', n); return value({ kind: 'implementation' as const, ns, name: n }, `${name}/${n}`) },
  }, name)
  return ns
}

function port(i: InterfaceCoord, op: string): PortCoord {
  check(NAME.test(op), 'op name', op)
  return value({ kind: 'port' as const, interface: i, op }, `${i}/${op}`)
}

function pod(implementation: ImplCoord, runtime: string, name: string): PodCoord {
  check(ID.test(runtime), 'runtime', runtime)
  check(ID.test(name), 'pod', name)
  return value({ kind: 'pod' as const, implementation, runtime, pod: name }, `${implementation}@${runtime}/${name}`)
}

/** `s` split at the last `sep`, or nothing. */
const cut = (s: string, sep: string): [string, string] | undefined => {
  const at = s.lastIndexOf(sep)
  return at > 0 ? [s.slice(0, at), s.slice(at + 1)] : undefined
}

function read<K extends keyof Kinds>(kind: K, s: string): Kinds[K] {
  const bad = (): never => { throw new Error(`bad ${kind} coordinate ${JSON.stringify(s)}`) }
  const attempt = (f: () => Kinds[keyof Kinds]) => { try { return f() } catch { return bad() } }
  switch (kind) {
    case 'namespace': return attempt(() => namespace(s)) as Kinds[K]
    case 'interface': { const [ns, n] = cut(s, '.') ?? bad(); return attempt(() => namespace(ns).interface(n)) as Kinds[K] }
    case 'implementation': { const [ns, n] = cut(s, '/') ?? bad(); return attempt(() => namespace(ns).implementation(n)) as Kinds[K] }
    case 'port': { const [i, op] = cut(s, '/') ?? bad(); return attempt(() => port(read('interface', i), op)) as Kinds[K] }
    default: {
      const at = s.indexOf('@'), slash = s.indexOf('/', at)
      if (at < 0 || slash < 0) bad()
      return attempt(() => pod(read('implementation', s.slice(0, at)), s.slice(at + 1, slash), s.slice(slash + 1))) as Kinds[K]
    }
  }
}

/** `Coord.namespace(ns)`, `Coord.port(interface, op)`, `Coord.pod(implementation, runtime, pod)`, `Coord.parse(kind, s)`. */
export const Coord = { namespace, port, pod, parse: read }
