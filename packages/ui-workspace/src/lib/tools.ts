/**
 * The workspace's tools (ADR-0041): each host-neutral tool id a `tool` slot names, as the dock widget showing it. A widget
 * id with no tool (an old `view` slot's, or a palette entry of a page's own) reads as itself, both ways.
 *
 *   widgetOf('systems')         // 'nano-explorer'
 *   toolOf('nano-explorer')     // 'systems'
 *   tooled(page)                // its slots holding widget ids, as their tool ids
 */
import type { Page } from '@pritzlaff/nano-outline'

const WIDGETS: Record<string, string> = { systems: 'nano-explorer', wiring: 'nano-wiring', gallery: 'nano-gallery', activity: 'activity', chart: 'chart', metrics: 'metrics', notes: 'notes' }
const TOOLS = Object.fromEntries(Object.entries(WIDGETS).map(([t, w]) => [w, t]))

export const widgetOf = (tool: string): string => (Object.hasOwn(WIDGETS, tool) ? WIDGETS[tool]! : tool)
export const toolOf = (widget: string): string => (Object.hasOwn(TOOLS, widget) ? TOOLS[widget]! : widget)

/** `p` with each tool slot's id read through the table (an old widget id as its tool's); as it is when none changes. */
export function tooled(p: Page): Page {
  const slots = Object.entries(p.slots), changed = slots.some(([, s]) => s.kind === 'tool' && toolOf(s.tool) !== s.tool)
  return changed ? { ...p, slots: Object.fromEntries(slots.map(([id, s]) => [id, s.kind === 'tool' ? { kind: 'tool', tool: toolOf(s.tool) } : s])) } : p
}
