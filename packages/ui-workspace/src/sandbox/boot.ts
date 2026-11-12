// The iframe's entry (built to public/sandbox/boot.js, its shared imports left bare for the page's import map): waits for the host's port, then serves or probes the package.
import type { Catalog } from '@pritzlaff/nano-elements'
import { provide } from '@pritzlaff/nano-elements'
import { probe, serve } from './serve'

const once = async (e: MessageEvent) => {
  if (e.source !== window.parent || !e.ports[0]) return
  removeEventListener('message', once)
  const port = e.ports[0], d = e.data as { url?: string; kind?: string; render?: boolean; probe?: boolean }
  try {
    if (typeof d?.url !== 'string') throw new Error('no url')
    const mod = await import(/* @vite-ignore */ d.url)
    const catalog = mod.catalog as Catalog | undefined
    if (!catalog || typeof catalog !== 'object') throw new Error('the module exports no catalog')
    if (d.probe) return probe(port, catalog)
    if (typeof mod.define === 'function') mod.define()
    serve(port, catalog, String(d.kind), {
      render: d.render ? (tag, registry, name) => {
        const el = document.createElement(tag); el.setAttribute('name', name)
        provide(document, registry); document.body.append(el)
      } : undefined,
    })
  } catch (err) { port.postMessage({ type: 'failed', error: err instanceof Error ? err.message : String(err) }) }
}
addEventListener('message', once)
