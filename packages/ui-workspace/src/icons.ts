/**
 * Inline SVG for the kinds of things nano shows (pod, interface, implementation, action, event, runtime; a group for
 * any other) and a status dot, all in theme tokens. Each is an `img` named by its kind or status (and carries a `<title>`), so a wrapper
 * around both must not set its own label.
 *
 *   html`${kindIcon('pod')} ${statusDot('running')}`
 *   explorer.icon = icon   // `<nano-explorer>`'s `icon`: a pod's status dot, then the pod icon; the rest `kindIcon`
 */
import { html, svg } from 'lit'
import { tv } from '@pritzlaff/nano-elements'
import type { TreeNode } from '@pritzlaff/nano-elements'
import type { PodStatus } from '@pritzlaff/nano-core'

const shapes: Record<string, ReturnType<typeof svg>> = {
  pod: svg`<path d="M8 2 13.5 5v6L8 14 2.5 11V5z"/>`,
  interface: svg`<path d="M6 3H3v10h3M10 3h3v10h-3"/>`,
  implementation: svg`<path d="M5.5 4 2 8l3.5 4M10.5 4 14 8l-3.5 4"/>`,
  action: svg`<path d="M3 8h9M8.5 4 12.5 8l-4 4"/>`,
  event: svg`<path d="M9 2 4 9h4l-1 5 5-7H8z"/>`,
  runtime: svg`<rect x="2.5" y="2.5" width="11" height="11" rx="2"/>`,
  group: svg`<path d="M2 4.5h4l1.5 1.5H14v6.5H2z"/>`,
}

export const kindIcon = (kind: string) => svg`<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="${tv('muted')}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label=${kind}><title>${kind}</title>${shapes[kind] ?? shapes.group}</svg>`

const dots: Record<PodStatus, { fill: string; stroke: string }> = {
  running: { fill: tv('good'), stroke: tv('good') },
  'not started': { fill: 'none', stroke: tv('muted') },
  stopped: { fill: tv('muted'), stroke: tv('muted') },
  failed: { fill: tv('bad'), stroke: tv('bad') },
}

export const statusDot = (s: PodStatus) => svg`<svg width="10" height="10" viewBox="0 0 10 10" role="img" aria-label=${s}><title>${s}</title><circle cx="5" cy="5" r="3.5" fill="${dots[s].fill}" stroke="${dots[s].stroke}" stroke-width="1.5"/></svg>`

/** `<nano-explorer>`'s `icon`: a pod's status dot then the pod icon; a group (no kind) none; the rest `kindIcon`. */
export const icon = (n: TreeNode) => n.kind === 'pod' ? html`${statusDot(n.data!.status as PodStatus)}${kindIcon('pod')}` : n.kind ? kindIcon(n.kind) : undefined
