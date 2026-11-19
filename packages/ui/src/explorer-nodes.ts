/**
 * The explorer's tree: each runtime with its pods, implementations, interfaces and operations; then every operation
 * (actions, events) with the interface, implementations and pods it belongs to; then the interfaces and implementations.
 * A node shown again away from its primary place has the id `<where>|<primary id>`: `primary(id)` is what it selects.
 * A pod node carries its `PodStatus` as `data.status` (a pod with no event yet: running if eager, else not started).
 */
import { html } from 'lit'
import type { AppDeployment, Registry } from '@pritzlaff/nano-core'
import type { PodStatus } from './filter/model.ts'
import type { TreeNode } from '@pritzlaff/nano-elements'

export const primary = (id: string) => id.slice(id.lastIndexOf('|') + 1)
const op = (port: string) => port.slice(port.lastIndexOf('/') + 1)
/** A coordinate's namespace: `nano.ui` for `nano.ui.Input`, `nano.ui/input` and a runtime `nano.ui.main`. */
export const namespaceOf = (coord: string) => coord.includes('/') ? coord.slice(0, coord.indexOf('/')) : coord.slice(0, Math.max(0, coord.lastIndexOf('.')))
const group = (id: string, label: string, children: TreeNode[]): TreeNode => ({ id, label, count: children.length, children })
const alias = (at: string, n: TreeNode): TreeNode => ({ ...n, id: `${at}|${n.id}`, children: undefined, body: undefined })

type Op = { port: string; iface: string; name: string; kind: string }

export function nodes(d: AppDeployment, registry: Registry, states: Record<string, PodStatus>): TreeNode[] {
  const m = registry.manifest()
  const ops: Op[] = m.interfaces.flatMap(i => i.ops.map(o => ({ port: `${i.coord}/${o.name}`, iface: i.coord, name: o.name, kind: o.kind })))
  const implsOf = (iface: string) => registry.implementationsOf(iface).map(x => x.coord)
  const provides = (impl: string) => registry.implementation(impl)?.provides.map(i => i.coord) ?? []
  const where = (pod: string) => Object.keys(d.runtimes).find(r => d.runtimes[r]!.pods.includes(pod)) ?? ''
  const podNode = (pod: string): TreeNode => ({ id: `p:${where(pod)}:${pod}`, label: pod, kind: 'pod', data: { ns: namespaceOf(d.pods[pod]?.implementation ?? ''), status: states[pod] ?? (d.pods[pod]?.eager ? 'running' : 'not started') } })
  const ifaceNode = (c: string): TreeNode => ({ id: `i:${c}`, label: c, kind: 'interface', data: { ns: namespaceOf(c) } })
  const implNode = (c: string): TreeNode => ({ id: `m:${c}`, label: c, kind: 'implementation', data: { ns: namespaceOf(c) } })
  const opNode = (o: Op): TreeNode => ({ id: `o:${o.port}`, label: o.port, kind: o.kind, data: { ns: namespaceOf(o.iface) } })

  const runtimes = Object.entries(d.runtimes).map(([runtime, r]): TreeNode => {
    const at = `r:${runtime}`
    const impls = [...new Set(r.pods.map(p => d.pods[p]?.implementation).filter((x): x is string => !!x))]
    const ifaces = [...new Set(impls.flatMap(provides))]
    const pods = r.pods.map(pod => {
      const p = d.pods[pod]
      const subs: TreeNode[] = r.subscriptions.filter(s => s.from === pod).map((s, i) => ({
        id: `s:${runtime}:${pod}:${i}`, label: s.kind === 'call' ? `built on → ${s.to}` : `${op(s.source)} → ${s.to}.${op(s.target)}`,
      }))
      return { ...podNode(pod), id: `p:${runtime}:${pod}`, terms: [p?.implementation ?? ''],
        body: html`${p?.implementation} ${p?.config === undefined ? '' : JSON.stringify(p.config)}`, children: subs }
    })
    return { id: at, label: runtime, kind: 'runtime', count: r.pods.length, data: { ns: namespaceOf(runtime) }, children: [
      group(`${at}/pods`, 'Pods', pods),
      group(`${at}/impls`, 'Implementations', impls.map(c => alias(at, implNode(c)))),
      group(`${at}/ifaces`, 'Interfaces', ifaces.map(c => alias(at, ifaceNode(c)))),
      group(`${at}/ops`, 'Operations', ops.filter(o => ifaces.includes(o.iface)).map(o => alias(at, opNode(o)))),
    ] }
  })

  const opTree = (o: Op): TreeNode => {
    const at = `o:${o.port}`, impls = implsOf(o.iface)
    const pods = Object.keys(d.pods).filter(p => impls.includes(d.pods[p]!.implementation))
    return { ...opNode(o), children: [
      alias(at, ifaceNode(o.iface)),
      group(`${at}/impls`, 'Implementations', impls.map(c => alias(at, implNode(c)))),
      group(`${at}/pods`, 'Pods', pods.map(p => alias(at, podNode(p)))),
    ] }
  }
  return [...runtimes,
    group('g:ops', 'Operations', [
      group('g:actions', 'Actions', ops.filter(o => o.kind === 'action').map(opTree)),
      group('g:events', 'Events', ops.filter(o => o.kind === 'event').map(opTree)),
    ]),
    group('g:interfaces', 'Interfaces', m.interfaces.map(i => ifaceNode(i.coord))),
    group('g:implementations', 'Implementations', m.implementations.map(i => implNode(i.coord)))]
}

/** Every namespace in the tree, sorted. */
export const namespaces = (list: TreeNode[]): string[] =>
  [...new Set(list.flatMap(function all(n): string[] { return [...(n.data?.ns ? [n.data.ns] : []), ...(n.children ?? []).flatMap(all)] }))].filter(Boolean).sort()
