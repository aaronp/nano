// The Circuit, as a pure function of an application's deployment and the registry that knows its implementations.
import type { AppDeployment, Op, Registry } from '@pritzlaff/nano'
import { padTypeOf, type Box, type Cable, type Circuit, type Pad } from './types'

const padsOf = (scope: string, pod: string, deployment: AppDeployment, registry: Registry): Pad[] => {
  const impl = registry.implementation(deployment.pods[pod]?.implementation ?? '')
  const pad = (port: string, o: Op, dir: Pad['dir'], kind: Pad['kind'], schema: Op['input']): Pad => ({
    key: `${scope}${pod} ${port}:${dir}`, instance: pod, op: port, label: o.name, dir, kind, type: padTypeOf(schema?.schema),
    ...(o.description !== undefined && { description: o.description }), ...(schema && { schema: schema.schema }),
  })
  return (impl?.provides ?? []).flatMap(i => Object.values(i.ops).flatMap(o => {
    const port = `${i.coord}/${o.name}`
    return o.kind === 'action' ? [pad(port, o, 'in', 'call', o.input), pad(port, o, 'out', 'event', o.output)] : [pad(port, o, 'out', 'event', o.output)]
  }))
}

/** A runtime's pods get an equal grid, ceil(sqrt(n)) columns wide. */
const gridBoxes = (n: number): Box[] => {
  const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols)
  return Array.from({ length: n }, (_, i) => ({ x: (i % cols) / cols, y: Math.floor(i / cols) / rows, w: 1 / cols, h: 1 / rows }))
}

export function circuitOf(deployment: AppDeployment, registry: Registry): Circuit {
  const runtimes = Object.entries(deployment.runtimes)
  const count = new Map<string, number>()
  for (const [, r] of runtimes) for (const p of r.pods) count.set(p, (count.get(p) ?? 0) + 1)
  const shared = [...count].filter(([, n]) => n > 1).map(([p]) => p)

  const layers = runtimes.map(([id, r]) => {
    const grid = gridBoxes(r.pods.length)
    return { screen: id, title: id, system: id, footprints: r.pods.map((pod, i) => ({ system: id, instance: pod, title: pod, box: grid[i]!, shared: shared.includes(pod), pads: padsOf(`${id}/`, pod, deployment, registry) })) }
  })
  const side = shared.map(pod => ({ system: pod, items: [{ system: pod, instance: pod, title: pod, pads: padsOf('shared:', pod, deployment, registry) }] }))

  const cables: Cable[] = runtimes.flatMap(([id, r]) => r.subscriptions.flatMap(s => {
    const pads = (pod: string) => layers.find(l => l.screen === id)!.footprints.find(f => f.instance === pod)!.pads
    const at = { layer: id }
    if (s.kind === 'call') {
      const a = pads(s.from).find(p => p.dir === 'out') ?? pads(s.from)[0], b = pads(s.to).find(p => p.dir === 'in') ?? pads(s.to)[0]
      return a && b ? [{ id: `${id}|${s.from}|${s.to}|call|`, system: id, from: { pad: a.key, at }, to: { pad: b.key, at }, type: 'call' as const }] : []
    }
    const a = pads(s.from).find(p => p.op === s.source && p.dir === 'out'), b = pads(s.to).find(p => p.op === s.target && p.dir === 'in')
    return a && b ? [{ id: `${id}|${s.from}|${s.to}|${s.target}|${s.source}`, system: id, from: { pad: a.key, at }, to: { pad: b.key, at }, type: a.type }] : []
  }))
  // a pod placed in two runtimes: its side block is linked to each of its footprints
  for (const pod of shared) {
    const sp = side.find(b => b.system === pod)!.items[0]!.pads[0]
    for (const l of layers) {
      const p = l.footprints.find(f => f.instance === pod)?.pads[0]
      if (p && sp) cables.push({ id: `link|${l.screen}|${pod}`, system: pod, from: { pad: p.key, at: { layer: l.screen } }, to: { pad: sp.key, at: { side: pod } }, type: 'signal' })
    }
  }
  return { layers, side, cables }
}
