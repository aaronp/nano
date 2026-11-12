// Where everything sits, in world px. Pure: boxes and pads per layer and per system block, and every pad's world position.
import type { Circuit, Footprint, Layer, Pad, SideItem, SystemBlock } from './types'
import { BLOCK_GAP, BLOCK_HEAD, HEAD, ITEM_GAP, PAD, PAD_STEP, PH, PW, SIDE_GAP, SIDE_W, TAB_H, TAB_W, XSTEP } from './constants'

export type Rect = { x: number; y: number; w: number; h: number }
export type Pt = { x: number; y: number }
export type PlacedPad = { pad: Pad; x: number; y: number }
/** A tab label on a group's box. */
export type PlacedTab = { fp: Footprint; rect: Rect; active: boolean }
/** One box: a footprint or tab group (`fp` is the shown one), or a side item. Positions are local to its frame. */
export type PlacedBox = { item: Footprint | SideItem; rect: Rect; pads: PlacedPad[]; tabs: PlacedTab[]; latent: PlacedPad[] }
export type Frame = { id: string; origin: Pt; rect: Rect; boxes: PlacedBox[] }
export type LayerFrame = Frame & { layer: Layer; index: number }
export type BlockFrame = Frame & { block: SystemBlock }
export type Layout = { layers: LayerFrame[]; blocks: BlockFrame[]; pos: Map<string, Pt>; bounds: Rect; pageRect(i: number): Rect }

export const frameId = (at: { layer: string } | { side: string }) => 'layer' in at ? `l:${at.layer}` : `s:${at.side}`
export const posKey = (frame: string, pad: string) => `${frame}|${pad}`

const slots = (pads: Pad[], r: Rect): PlacedPad[] => {
  const n = { in: 0, out: 0 }
  return pads.map(pad => ({ pad, x: pad.dir === 'in' ? r.x : r.x + r.w, y: r.y + HEAD + PAD_STEP * n[pad.dir]++ + PAD / 2 }))
}
const centre = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })
const union = (rs: Rect[]): Rect => {
  const x0 = Math.min(...rs.map(r => r.x)), y0 = Math.min(...rs.map(r => r.y)), x1 = Math.max(...rs.map(r => r.x + r.w)), y1 = Math.max(...rs.map(r => r.y + r.h))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Footprints in one tab group draw as one box (the active tab's); the others are labels along its top edge. */
function layerBoxes(l: Layer): PlacedBox[] {
  const groups = new Map<string, Footprint[]>()
  for (const f of l.footprints) { const k = f.tab ? `tab:${f.tab.group}` : `i:${f.instance}`; groups.set(k, [...(groups.get(k) ?? []), f]) }
  return [...groups.values()].map(fps => {
    const shown = fps.find(f => f.tab?.active) ?? fps[0]!, b = shown.box, rect = { x: b.x * PW, y: b.y * PH, w: b.w * PW, h: b.h * PH }
    const tabs = fps[0]!.tab ? fps.map((f, i) => ({ fp: f, active: f === shown, rect: { x: rect.x + 8 + i * (TAB_W + 4), y: rect.y - TAB_H, w: TAB_W, h: TAB_H } })) : []
    // an inactive tab's pads have no place of their own: its cables end at its label
    const latent = tabs.filter(t => !t.active).flatMap(t => t.fp.pads.map(pad => ({ pad, ...centre(t.rect) })))
    return { item: shown, rect, pads: slots(shown.pads, rect), tabs, latent }
  })
}

export function layout(c: Circuit): Layout {
  const pos = new Map<string, Pt>()
  const register = (f: Frame) => { for (const b of f.boxes) for (const p of [...b.pads, ...b.latent]) pos.set(posKey(f.id, p.pad.key), { x: f.origin.x + p.x, y: f.origin.y + p.y }) }
  const layers = c.layers.map((layer, index): LayerFrame => ({ layer, index, id: `l:${layer.screen}`, origin: { x: index * XSTEP, y: 0 }, rect: { x: index * XSTEP, y: 0, w: PW, h: PH }, boxes: layerBoxes(layer) }))
  const sideX = Math.max(0, c.layers.length - 1) * XSTEP + PW + SIDE_GAP
  let y = 0
  const blocks = c.side.map((block): BlockFrame => {
    let cy = BLOCK_HEAD
    const boxes = block.items.map((item): PlacedBox => {
      const h = HEAD + PAD_STEP * Math.max(1, item.pads.filter(p => p.dir === 'in').length, item.pads.filter(p => p.dir === 'out').length) + 8
      const rect = { x: 0, y: cy, w: SIDE_W, h }
      cy += h + ITEM_GAP
      return { item, rect, pads: slots(item.pads, rect), tabs: [], latent: [] }
    })
    const f: BlockFrame = { block, id: `s:${block.system}`, origin: { x: sideX, y }, rect: { x: sideX, y, w: SIDE_W, h: cy }, boxes }
    y += cy + BLOCK_GAP
    return f
  })
  for (const f of [...layers, ...blocks]) register(f)
  const pageRect = (i: number): Rect => ({ x: i * XSTEP, y: 0, w: PW, h: PH })
  const bounds = union([...layers.map(l => l.rect), ...blocks.map(b => b.rect), { x: 0, y: 0, w: PW, h: PH }])
  return { layers, blocks, pos, bounds, pageRect }
}
