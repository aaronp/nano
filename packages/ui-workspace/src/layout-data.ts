/**
 * The neutral layout (nano-ui's `LayoutData`) beside the dock's own state: what Save writes from the dock, and which
 * pods to open for a file that has `slots` but no state for this dock (a file made by another engine).
 *
 *   { ...saved.layout, workspace: arrangement, ...layoutFromDock(arrangement.root, runtimeOf) }
 */
import type { LayoutData, LayoutSlot } from '@pritzlaff/nano-ui'
import type { DeskLayout } from './desk/index.ts'

type Box = { x: number; y: number; w: number; h: number }
/** A pod a dock shows, where (fractions of the dock), and its tab group if stacked. */
export type Placement = { screen: string; instance: string; box?: Box; tab?: { group: string; active: boolean } }
type Item = { type: string; size?: number; content?: readonly Item[]; activeItemIndex?: number; componentState?: unknown }
/** The pods a dock's golden-layout tree shows on `screen`, boxed by its rows, columns and sizes; a stack is a tab group. */
export function dockPlacements(screen: string, root: Item | null | undefined): Placement[] {
  const out: Placement[] = []
  let groups = 0
  const walk = (it: Item, b: Box, tab?: { group: string; active: boolean }) => {
    const kids = it.content ?? []
    if (it.type === 'component') {
      const name = (it.componentState as { name?: unknown } | undefined)?.name
      if (typeof name === 'string') out.push({ screen, instance: name, box: b, ...(tab && { tab }) })
    } else if (it.type === 'stack') {
      const g = `g${groups++}`
      kids.forEach((k, i) => walk(k, b, kids.length > 1 ? { group: g, active: i === (it.activeItemIndex ?? 0) } : undefined))
    } else {
      const total = kids.reduce((n, k) => n + (k.size ?? 1), 0) || 1, across = it.type === 'row'
      let at = 0
      for (const k of kids) {
        const f = (k.size ?? 1) / total
        walk(k, across ? { ...b, x: b.x + at * b.w, w: f * b.w } : { ...b, y: b.y + at * b.h, h: f * b.h })
        at += f
      }
    }
  }
  if (root) walk(root, { x: 0, y: 0, w: 1, h: 1 })
  return out
}
type Root = Parameters<typeof dockPlacements>[1]

/** A slot per pod panel whose pod is placed (`runtimeOf` says where), boxed by the dock's rows, columns and sizes. */
export function layoutFromDock(root: Root, runtimeOf: (pod: string) => string | undefined): Required<LayoutData> {
  const slots: LayoutSlot[] = [], geometry: Required<LayoutData>['geometry'] = {}
  for (const p of dockPlacements('', root)) {
    const runtime = runtimeOf(p.instance)
    if (!runtime || geometry[p.instance]) continue
    slots.push({ id: p.instance, runtime, pod: p.instance })
    if (p.box) geometry[p.instance] = p.box
  }
  return { slots, geometry }
}

/** What Save writes as `layout`: the saved one, the dock's arrangement under its id, its slots, and the Desk's layout when there is a Desk. */
export function savedLayout(saved: { layout?: Record<string, unknown> }, dockId: string, arrangement: { root?: unknown }, runtimeOf: (pod: string) => string | undefined, desk?: DeskLayout) {
  return { ...saved.layout, [dockId]: arrangement, ...layoutFromDock(arrangement.root as Root, runtimeOf), ...(desk && { desk }) }
}

/** The pods to open, in slot order: none when the file keeps this dock's own state; slots naming no pod are skipped. */
export function slotsToOpen(d: { pods: Record<string, unknown>; layout?: Record<string, unknown> }, dockId: string): string[] {
  const slots = (d.layout as LayoutData | undefined)?.slots
  if (!slots || d.layout?.[dockId] !== undefined) return []
  return slots.map(s => s.pod).filter(p => Object.hasOwn(d.pods, p))
}
