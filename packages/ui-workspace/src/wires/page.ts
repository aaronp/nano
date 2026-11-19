// What <c-wires> reads from the page: the fonts it loads, its styles, and where each dock panel is and which pod it shows.
import { css } from 'lit'
import { FONTS } from './constants'
import type { Panel } from './model'

/** Fonts only reach a shadow root when the document loads them, so the link goes into the document's head, once. */
export function loadFonts(doc: Document) {
  if (doc.head.querySelector('link[data-wires-fonts]')) return
  const link = doc.createElement('link')
  link.rel = 'stylesheet'; link.href = FONTS; link.dataset.wiresFonts = ''
  doc.head.append(link)
}
/** A panel's instance: the pod of the first element inside it whose view target names one. */
export const modelIn = (panel: Element) => [...panel.querySelectorAll('*')].find(e => typeof (e as { target?: { pod?: unknown } }).target?.pod === 'string') as (Element & { target: { pod: string } }) | undefined
/** An element's layout box relative to `dock`, from offsets: unlike client rects, these ignore the 3D transform. */
export const rectIn = (el: HTMLElement, dock: HTMLElement) => {
  let x = 0, y = 0, e: HTMLElement | null = el
  while (e && e !== dock && dock.contains(e)) { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent as HTMLElement | null }
  if (e !== dock) { x -= dock.offsetLeft; y -= dock.offsetTop }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight }
}

export const styles = css`
    :host { display: block; height: 100% }
    .stage-bg{background-color:#0B0E12;background-image:radial-gradient(#1C222B 1px, transparent 1px);background-size:22px 22px}
    .plate-bg{background-color:#12161C;background-image:radial-gradient(#1E252F 1px, transparent 1px);background-size:14px 14px}
    .flow{stroke-dasharray:3 13;animation:dcflow 0.9s linear infinite}
    .noflow{stroke-dasharray:none}
    .live{stroke-dasharray:6 6;animation:dcflow 0.6s linear infinite}
    @keyframes dcflow{to{stroke-dashoffset:-32}}
    .mono{font-family:'JetBrains Mono',ui-monospace,monospace}
    .sidebtn:focus-visible,.seg:focus-visible,.route:focus-visible,.joint:focus-visible,.piecebtn:focus-visible{outline:2px solid #4CC2FF;outline-offset:2px}
    .sidebtn:disabled{opacity:0.4;cursor:not-allowed}
    .joint:hover{background:#FFFFFF}
    .pkt-label{paint-order:stroke;stroke:#0A0D11;stroke-width:3px;stroke-linejoin:round}`

/** The dock's panels that are showing: an inactive tab has no size or place, and its component waits in the rack. */
export function panelsOf(dock: HTMLElement | null): Panel[] {
  if (!dock) return []
  return [...dock.querySelectorAll<HTMLElement>('.dock-panel')].filter(p => p.offsetWidth > 0 && p.offsetHeight > 0).map(p => {
    const el = modelIn(p), id = el?.target.pod ?? null
    return { instance: id, rect: rectIn(p, dock), tag: (el ?? p.firstElementChild ?? p).localName }
  })
}
