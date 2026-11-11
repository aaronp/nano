// The host's iframes: the bootstrap page, the fixed layer they live in, opening one and probing a package in one.
import type { SerialEntry } from './protocol'
import type { Frame } from './stand-in'

/** How long an iframe has to answer before its `ready` rejects. */
export const READY_MS = 10_000

const esc = (s: string) => s.replace(/</g, '\\u003c')
const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** The bootstrap page: the host's import map with every URL made absolute (against `base`), and the boot module by absolute URL. */
export function srcdoc(importMap: { imports?: Record<string, string> }, bootUrl: string, base: string = document.baseURI): string {
  const imports = Object.fromEntries(Object.entries(importMap.imports ?? {}).map(([k, v]) => [k, new URL(v, base).href]))
  return `<!doctype html><html><head><script type="importmap">${esc(JSON.stringify({ imports }))}</script>` +
    `<script type="module" src="${attr(new URL(bootUrl, base).href)}"></script></head><body></body></html>`
}

/** The host page's own import map. */
const hostMap = (): { imports?: Record<string, string> } => {
  try { return JSON.parse(document.querySelector('script[type="importmap"]')?.textContent ?? '{}') } catch { return {} }
}

/** The one fixed layer at the end of `<body>` that holds every sandbox iframe; it never intercepts the pointer itself. */
export function layer(doc: Document): HTMLElement {
  let el = doc.getElementById('c-sandbox-layer')
  if (!el) {
    el = doc.createElement('div'); el.id = 'c-sandbox-layer'
    el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:1000'
    doc.body.append(el)
  }
  return el
}

const iframeFor = (mode: 'sandbox' | 'isolated-sandbox') => {
  const f = document.createElement('iframe')
  f.setAttribute('sandbox', mode === 'sandbox' ? 'allow-scripts allow-same-origin' : 'allow-scripts')
  f.srcdoc = srcdoc(hostMap(), new URL('./sandbox/boot.js', document.baseURI).href)
  f.style.cssText = 'position:fixed;border:0;display:none;pointer-events:auto;background:transparent'
  layer(document).append(f)
  return f
}

/** Posts `first` and a port to the iframe once it has loaded (its boot script is waiting for them). */
const handOver = (f: HTMLIFrameElement, first: object, port: MessagePort) =>
  f.addEventListener('load', () => f.contentWindow?.postMessage(first, '*', [port]), { once: true })

/** Opens an iframe running `url`'s `kind`. `ready` resolves on the iframe's ready, and rejects on its failed or when it has said nothing in time. */
export function openFrame(o: { url: string; kind: string; mode: 'sandbox' | 'isolated-sandbox'; render: boolean; readyMs?: number; channel?: MessageChannel }): Frame {
  const ch = o.channel ?? new MessageChannel(), element = iframeFor(o.mode)
  handOver(element, { url: o.url, kind: o.kind, render: o.render }, ch.port2)
  let timer: ReturnType<typeof setTimeout>
  const ready = new Promise<void>((res, rej) => {
    timer = setTimeout(() => rej(new Error('the sandbox did not answer in time')), o.readyMs ?? READY_MS)
    ch.port1.addEventListener('message', ({ data }) => {
      if (data?.type === 'ready') { clearTimeout(timer); res() }
      else if (data?.type === 'failed') { clearTimeout(timer); rej(new Error(String(data.error))) }
    })
    ch.port1.start()
  })
  return { port: ch.port1, ready, element, dispose() { clearTimeout(timer); element.remove(); ch.port1.close() } }
}

/** Imports `url` in a throwaway isolated iframe and returns its catalog as data. */
export function probeFrame(url: string, readyMs = READY_MS, ch = new MessageChannel()): Promise<Record<string, SerialEntry> | { error: string }> {
  const element = iframeFor('isolated-sandbox')
  handOver(element, { url, probe: true }, ch.port2)
  return new Promise(res => {
    const done = (r: Record<string, SerialEntry> | { error: string }) => { clearTimeout(timer); element.remove(); ch.port1.close(); res(r) }
    const timer = setTimeout(() => done({ error: 'the sandbox did not answer in time' }), readyMs)
    ch.port1.addEventListener('message', ({ data }) => {
      if (data?.type === 'catalog') done(data.entries && typeof data.entries === 'object' && !Array.isArray(data.entries) ? data.entries : { error: 'the sandbox sent no catalog' })
      else if (data?.type === 'failed') done({ error: String(data.error) })
    })
    ch.port1.start()
  })
}
