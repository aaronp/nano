// The camera's zoom and pan, on top of its turn.
import type { Wires } from './wires'

/** Zooms by a factor (kept within 0.25–4), about a client point if given, so what is under it stays put. */
export function zoomBy(el: Wires, factor: number, at?: { clientX: number; clientY: number }) {
  const { zoom, panX, panY } = el.s, next = Math.min(4, Math.max(0.25, zoom * factor))
  if (!at) return el.setState({ zoom: next, zooming: false })
  const r = el.renderRoot.querySelector('.world')?.getBoundingClientRect()
  const k = 1 - next / zoom, cx = r ? r.left + r.width / 2 : 0, cy = r ? r.top + r.height / 2 : 0
  el.setState({ zoom: next, panX: panX + k * (at.clientX - cx), panY: panY + k * (at.clientY - cy), zooming: true })
}
/** Pinch or ctrl/cmd+scroll zooms about the pointer; scrolling pans. */
export function onWheel(el: Wires, e: WheelEvent) {
  e.preventDefault()
  if (e.ctrlKey || e.metaKey) zoomBy(el, Math.exp(-e.deltaY * 0.01), e)
  else el.setState({ panX: el.s.panX - e.deltaX, panY: el.s.panY - e.deltaY, zooming: true })
}
