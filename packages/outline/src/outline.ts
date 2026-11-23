/**
 * The Outline: one document, a tree of pages, pure data and functions (spec 2026-11-21-host-core-design §2). Its slots
 * resolve against a deployment; a slot naming an absent pod resolves `missing`. The live outline (holding the app,
 * applying, opening) is the host core's (`host.outline`).
 *
 *   resolve(doc, 'home', app.deployment(), registry)   // per slot: { kind: 'pod', pods }, { kind: 'missing' } or { kind: 'tool', tool }
 *   Outline.parse(json)                                // the document, or invalid-input naming the page and slot
 */
import { Coord, matches, type AppDeployment, type PodCoord, type Registry } from '@pritzlaff/nano-core'
import { parse, type Slot, type Outline as Doc } from './document.ts'
import { targets } from './targets.ts'

type Resolved = { kind: 'pod'; pods: PodCoord[] } | { kind: 'missing' } | { kind: 'tool'; tool: string }

const MISSING: Resolved = { kind: 'missing' }

/** Page `page` of `outline`, each slot resolved against `deployment`: the pod where placed with that implementation, every
 * placed pod a selector matches (by runtime, then pod), the tool, or `missing`. Pure. */
export function resolve(outline: Doc, page: string, deployment: AppDeployment, registry: Registry): Record<string, Resolved> {
  const d = deployment, target = targets(d, registry)
  const slot = (s: Slot): Resolved => {
    if (s.kind === 'tool') return { kind: 'tool', tool: s.tool }
    if (s.kind === 'pod') {
      const { implementation, runtime, pod } = s.pod
      return d.runtimes[runtime.id]?.pods.includes(pod) && d.pods[pod]?.implementation === String(implementation) ? { kind: 'pod', pods: [s.pod] } : MISSING
    }
    const pods = Object.keys(d.runtimes).sort().flatMap(r => [...d.runtimes[r]!.pods].sort().flatMap(p => {
      const t = target(p, r)
      return t && matches(s.select, t) ? [Coord.pod(Coord.parse('implementation', t.implementation), Coord.runtime(r), p)] : []
    }))
    return pods.length ? { kind: 'pod', pods } : MISSING
  }
  return Object.fromEntries(Object.entries(outline.pages[page]?.slots ?? {}).map(([s, v]) => [s, slot(v)]))
}

/** `Outline.parse(json)`, the save/load seam. */
export const Outline = { parse }
export type Outline = Doc
