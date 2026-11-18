/**
 * The neutral layout (nano-ui's `LayoutData`) beside the dock's own state: what Save writes from the dock, and which
 * pods to open for a file that has `slots` but no state for this dock (a file made by another engine).
 *
 *   { ...saved.layout, workspace: arrangement, ...layoutFromDock(arrangement.root, runtimeOf) }
 */
import type { LayoutData, LayoutSlot } from '@pritzlaff/nano-ui'
import { dockPlacements } from './circuit/index.ts'
import type { DeskLayout } from './desk/index.ts'

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
