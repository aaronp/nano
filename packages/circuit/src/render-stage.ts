// The stage: a tilted stack of page layers, the side area of systems, cables, pads, and the minimap.
import { html, svg } from 'lit'
import { styleMap } from 'lit/directives/style-map.js'
import type { Circuit } from './circuit'
import { renderCovers, renderLiftTools } from './render-covers'
import { renderDrawer } from './render-drawer'
import { DIM_CABLE, MARGIN, PH, PW, TILT, TYPE_COLOR, TYPE_GLYPH, TYPE_NAME, ZGAP, fade } from './constants'
import { frameId, posKey, type Frame, type PlacedBox, type PlacedPad, type Rect } from './layout'
import type { Cable } from './types'

const px = (r: Rect) => ({ left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` })

/** A pad: a 24px button. Events are round, calls rounded squares; inputs hollow, outputs filled. */
function pad(el: Circuit, { pad: p, x, y }: PlacedPad) {
  const c = TYPE_COLOR[p.type], out = p.dir === 'out'
  const style = { left: `${x - 12}px`, top: `${y - 12}px`, borderColor: c, background: out ? c : 'transparent', color: out ? '#0B0E12' : c, borderRadius: p.kind === 'event' ? '50%' : '6px' }
  return html`<button class="pad" data-pad=${p.key} data-dir=${p.dir} data-kind=${p.kind} style=${styleMap(style)} title=${p.description ?? ''}
    aria-label=${`${p.instance}.${p.label}, ${TYPE_NAME[p.type]}, ${p.dir}`}
    aria-pressed=${el.s.sel === `pad:${p.key}`} @click=${() => el.select(`pad:${p.key}`)}>${TYPE_GLYPH[p.type]}</button>
    <span class="plabel ${p.dir}" style=${styleMap({ top: `${y - 7}px`, ...(out ? { right: `calc(100% - ${x - 18}px)`, textAlign: 'right' } : { left: `${x + 18}px` }) })}>${p.label}</span>`
}

function box(el: Circuit, b: PlacedBox, shared: boolean) {
  const { item } = b, fp = (i: { system: string; instance: string }) => `fp:${i.system}/${i.instance}`
  return html`<div class="fp" data-instance=${item.instance} data-sel=${el.s.sel === fp(item)} style=${styleMap(px(b.rect))}>
    ${b.tabs.length ? '' : html`<button class="ftitle" @click=${() => el.select(fp(item))}>${item.title}${shared ? ' ⧉' : ''}</button>`}
    ${b.pads.map(p => pad(el, p))}</div>
    ${b.tabs.map(t => html`<button class="tab" data-tab=${t.fp.instance} aria-pressed=${el.s.sel === fp(t.fp)} data-active=${t.active} data-cx=${t.rect.x + t.rect.w / 2} data-cy=${t.rect.y + t.rect.h / 2}
      style=${styleMap(px(t.rect))} @click=${() => el.select(fp(t.fp))}>${t.fp.title}</button>`)}`
}

/** A cable is a bezier between two pad centres, drawn in its source's frame. Full strength only on the focus layer. */
function cables(el: Circuit, f: Frame) {
  const { pos } = el.geo, focusFrame = `l:${el.s.focus}`
  return svg`<svg class="cables" width="1" height="1">${el.model.cables.filter(c => frameId(c.from.at) === f.id).map((c: Cable) => {
    const a = pos.get(posKey(f.id, c.from.pad)), b = pos.get(posKey(frameId(c.to.at), c.to.pad))
    if (!a || !b) return ''
    const x1 = a.x - f.origin.x, y1 = a.y - f.origin.y, x2 = b.x - f.origin.x, y2 = b.y - f.origin.y, dx = Math.max(40, Math.abs(x2 - x1) / 2)
    const full = frameId(c.from.at) === focusFrame || frameId(c.to.at) === focusFrame || (f.id.startsWith('s:') && frameId(c.to.at).startsWith('s:'))
    const d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`, sel = el.s.sel === `cable:${c.id}`
    return svg`<g data-cable-hit=${c.id} role="button" tabindex="0" aria-label=${`Cable ${c.id}`} @click=${() => el.select(`cable:${c.id}`)}
      @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.select(`cable:${c.id}`) } }}>
      <path data-cable=${c.id} data-x1=${x1} data-y1=${y1} data-x2=${x2} data-y2=${y2} d=${d}
      fill="none" stroke=${TYPE_COLOR[c.type]} stroke-width=${sel ? 4 : 2} opacity=${full ? 1 : DIM_CABLE}/><path class="hit" d=${d}/></g>`
  })}</svg>`
}

function minimap(el: Circuit) {
  const { bounds: b, layers, blocks } = el.geo, { panX, panY, zoom, focus } = el.s, { w, h } = el.stageSize()
  const vp = { x: -panX / zoom - w / zoom / 2, y: -panY / zoom - h / zoom / 2, w: w / zoom, h: h / zoom }
  return html`<svg class="minimap" role="img" aria-label="Minimap" viewBox=${`${b.x - MARGIN} ${b.y - MARGIN} ${b.w + 2 * MARGIN} ${b.h + 2 * MARGIN}`}
    @click=${(e: MouseEvent) => el.panFromMinimap(e)}>
    ${layers.map(l => svg`<rect class="mm-layer" data-focus=${l.layer.screen === focus} x=${l.rect.x} y=${l.rect.y} width=${l.rect.w} height=${l.rect.h}/>`)}
    ${blocks.map(l => svg`<rect class="mm-side" x=${l.rect.x} y=${l.rect.y} width=${l.rect.w} height=${l.rect.h}/>`)}
    <rect class="mm-view" x=${vp.x} y=${vp.y} width=${vp.w} height=${vp.h}/></svg>`
}

export function renderStage(el: Circuit) {
  const { focus, zoom, panX, panY } = el.s, reduced = el.reduced(), at = el.model.layers.findIndex(l => l.screen === focus)
  const world = { transform: `${reduced ? '' : TILT} translate(${panX}px, ${panY}px) scale(${zoom})` }
  return html`<div class="stage" tabindex="0" aria-label="Circuit" @pointerdown=${(e: PointerEvent) => el.dragStart(e)} @wheel=${(e: WheelEvent) => el.wheel(e)}>
    <div class="world ${el.dragging || reduced ? '' : 'anim'}" style=${styleMap(world)}>
      ${el.geo.layers.map(f => {
        const d = f.index - at, l = f.layer
        return html`<div class="frame" data-screen=${l.screen} style=${styleMap({ left: `${f.origin.x}px`, top: `${f.origin.y}px`, transform: `translateZ(${-Math.abs(d) * ZGAP}px)` })}>
          <section class="layer" aria-label=${l.title} data-focus=${d === 0} style=${styleMap({ width: `${PW}px`, height: `${PH}px`, opacity: String(fade(d)) })}>
            <h3 class="ltitle">${l.title}</h3>
            ${f.boxes.map(b => box(el, b, 'shared' in b.item && b.item.shared))}</section>
          ${renderCovers(el, f)}${cables(el, f)}</div>`
      })}
      ${el.geo.blocks.map(f => html`<div class="frame side" data-system=${f.block.system} style=${styleMap({ left: `${f.origin.x}px`, top: `${f.origin.y}px` })}>
        <h3 class="ltitle">${f.block.system}</h3>${f.boxes.map(b => box(el, b, false))}${cables(el, f)}</div>`)}
    </div>
    ${renderLiftTools(el)}${minimap(el)}${renderDrawer(el)}</div>`
}
