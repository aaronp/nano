/**
 * The host's iframes: the bootstrap page, the fixed layer they live in, and opening one with its port.
 *
 *   const f = openFrame('isolated-sandbox')   // an iframe in #nano-sandbox-layer, running sandbox/boot.js
 *   f.port.postMessage({ type: 'build', … }); f.dispose()
 */
import type { Frame } from './stand-in.ts'

type ImportMap = { imports?: Record<string, string> }

const esc = (s: string) => s.replace(/</g, '\\u003c')
const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** The bootstrap page: `importMap` with every URL made absolute against `base`, and the boot module by absolute URL. */
export function srcdoc(importMap: ImportMap, bootUrl: string, base: string): string {
  const imports = Object.fromEntries(Object.entries(importMap.imports ?? {}).map(([k, v]) => [k, new URL(v, base).href]))
  return `<!doctype html><html><head><meta charset="utf-8"><script type="importmap">${esc(JSON.stringify({ imports }))}</script>` +
    `<script type="module" src="${attr(new URL(bootUrl, base).href)}"></script></head><body></body></html>`
}

/** The host page's own import map. */
function hostMap(): ImportMap {
  try { return JSON.parse(document.querySelector('script[type="importmap"]')?.textContent ?? '{}') } catch { return {} }
}

/** The one fixed layer at the end of `<body>` holding every sandbox iframe; it never takes the pointer itself. */
function layer(): HTMLElement {
  let el = document.getElementById('nano-sandbox-layer')
  if (!el) {
    el = document.createElement('div')
    el.id = 'nano-sandbox-layer'
    el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:1000'
    document.body.append(el)
  }
  return el
}

/** An iframe running sandbox/boot.js, hidden until a `<nano-sandboxed>` places it. Its `ready` resolves once it has
 * loaded and holds the port (the boot answers on it), and rejects if it fails to load. */
export function openFrame(mode: 'sandbox' | 'isolated-sandbox'): Frame {
  const ch = new MessageChannel(), f = document.createElement('iframe')
  f.setAttribute('sandbox', mode === 'sandbox' ? 'allow-scripts allow-same-origin' : 'allow-scripts')
  f.srcdoc = srcdoc(hostMap(), './sandbox/boot.js', document.baseURI)
  f.style.cssText = 'position:fixed;border:0;display:none;pointer-events:auto;background:transparent'
  const ready = new Promise<void>((res, rej) => {
    f.addEventListener('load', () => { f.contentWindow?.postMessage('nano-sandbox', '*', [ch.port2]); res() }, { once: true })
    f.addEventListener('error', () => rej(new Error(`the ${mode} frame did not load`)), { once: true })
  })
  ready.catch(() => {})
  layer().append(f)
  return { port: ch.port1, ready, element: f, dispose() { f.remove(); ch.port1.close() } }
}
