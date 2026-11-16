/**
 * What each dock panel holds: `explorer` and `wiring` nano-ui's elements, `stream` the app's events, `pod:<name>` the
 * pod's chosen view (`nano-sandboxed` for a non-host pod), made again when its view or runtime changes.
 *
 *   const dispose = fill(container.element, 'pod:up', host)
 */
import { viewFor, type ViewTarget } from '@pritzlaff/nano-ui'
import type { Host } from '../host.ts'
import '../sandbox/sandboxed-view.ts'

const away = (h: Host, pod: string) => (h.data().pods[pod]?.isolation ?? 'host') !== 'host'
/** A pod's view tag: its selector, else `nano-sandboxed` for a non-host pod, else its implementation's default. */
export const chosen = (h: Host, pod: string) => (away(h, pod) && !customElements.get(h.data().views?.[pod] ?? '') ? 'nano-sandboxed' : viewFor(pod, h.data(), h.defaults()))
/** The tags a pod's view can be. */
export const viewTags = (h: Host, pod: string, impl: string) =>
  [...new Set([away(h, pod) && 'nano-sandboxed', h.defaults()[impl], 'nano-pod-view'].filter((x): x is string => !!x))]

type Viewing = HTMLElement & { target?: unknown }
const made = (tag: string, target: unknown) => Object.assign(document.createElement(tag) as Viewing, { target })

/** Fills panel `id`'s element; returns what stops it listening. */
export function fill(el: HTMLElement, id: string, h: Host): () => void {
  const target = { app: h.app, registry: h.registry }
  if (id === 'explorer' || id === 'wiring') { el.append(made(`nano-${id}`, target)); return () => {} }
  if (id === 'stream') {
    const pre = el.appendChild(document.createElement('pre')), lines: string[] = []
    pre.className = 'dock-stream'
    return h.app.listen(e => { lines.push(JSON.stringify(e)); if (lines.length > 200) lines.shift(); pre.textContent = lines.join('\n') })   // the last 200
  }
  const pod = id.slice('pod:'.length)
  let shown = ''
  const show = () => {
    const d = h.data(), runtime = Object.keys(d.runtimes).find(r => d.runtimes[r]!.pods.includes(pod))
    if (!runtime) return
    const tag = chosen(h, pod), key = `${tag} ${runtime}`
    // the target is set once: a new one on every apply would restart the view's listening
    if (key !== shown) { shown = key; el.replaceChildren(made(tag, { ...target, runtime, pod } satisfies ViewTarget)) }
  }
  show()
  return h.app.listen(e => { if (e.type === 'applied') show() })
}
