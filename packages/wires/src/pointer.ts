// The prototype's stage handlers (onDown, onMove, onUp, …) and edit actions, over the live system: cords connect
// and disconnect through the platform, the palette creates components, and a rack module dropped on the pane opens it.
import { Ops } from '@pritzlaff/nano-core'
import { clamp } from './constants'
import { nearestPort } from './geometry'
import { checkConnect, dirOf, portKey, portName } from './model'
import type { Wires } from './wires'

type Ptr = { clientX: number; clientY: number; pointerId?: number; currentTarget?: EventTarget | null }

/** A pointer position in back-plate coordinates. */
export function toLocal(el: Wires, e: Ptr) {
  const plate = el.renderRoot.querySelector('.plate-bg')
  if (!plate) throw new Error('bug: back plate element missing')
  const r = plate.getBoundingClientRect()
  if (r.width === 0) throw new Error('bug: back plate has no size')
  return { x: (e.clientX - r.left) / r.width * el.model.W, y: (e.clientY - r.top) / r.height * el.model.H }
}
/** The jacks that can be grabbed: all in relay mode, the panels' and blocks' in puzzle mode. */
export const visibleKeys = (el: Wires) => Object.keys(el.model.P).filter(k => el.s.mode === 'relay' || el.model.P[k]!.kind !== 'module')
const capture = (e: Ptr) => { const t = e.currentTarget as Element | null | undefined; if (t?.setPointerCapture && e.pointerId !== undefined) t.setPointerCapture(e.pointerId) }

export function onDown(el: Wires, e: Ptr) {
  const { s, model: m } = el
  if (s.editing) {
    if (s.mode === 'puzzle') return   // puzzle mode edits through its pieces and joints
    const pt = toLocal(el, e)
    const hit = nearestPort(m.P, visibleKeys(el), pt, null)
    if (hit !== null) {
      capture(e)
      const plugged = m.P[hit]!.dir === 'out' ? null : [...m.wires].reverse().find(w => w.to === hit) ?? null
      el.setState({ cord: { anchor: plugged ? plugged.from : hit, picked: plugged ? plugged.id : null, x: pt.x, y: pt.y, hover: null, err: null }, toast: null, selMod: null })
      return
    }
    const mod = m.rack.find(r => pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h)
    if (mod) capture(e)
    el.setState({ selMod: mod ? (mod.id === s.selMod ? null : mod.id) : null, lift: mod ? mod.id : null })
    return
  }
  capture(e)
  el.drag = { x: e.clientX, y: e.clientY, ry: s.ry, rx: s.rx }
  el.setState({ dragging: true })
}

export function onMove(el: Wires, e: Ptr) {
  const { s, model: m } = el
  if (s.editing) {
    const c = s.cord
    if (!c) return
    const pt = toLocal(el, e)
    // a picked cord is measured as if it were already out
    const base = c.picked ? { ...m, wires: m.wires.filter(w => w.id !== c.picked) } : m
    const h = nearestPort(m.P, visibleKeys(el), pt, c.anchor)
    const chk = h === null ? null : checkConnect(base, c.anchor, h)
    el.setState({ cord: { ...c, x: pt.x, y: pt.y, hover: h, err: chk && 'error' in chk ? chk.error : null } })
    return
  }
  const dr = el.drag
  if (!dr) return
  el.setState({ ry: dr.ry + (e.clientX - dr.x) * 0.45, rx: clamp(dr.rx - (e.clientY - dr.y) * 0.3, -70, 70) })
}

export async function onUp(el: Wires, e: Ptr) {
  const { s, model: m } = el
  if (s.editing) {
    if (s.lift) {
      const id = s.lift
      el.setState({ lift: null })
      if (toLocal(el, e).y < m.H) el.openPanel(id)   // dropped onto the pane: open it as a panel
      return
    }
    const c = s.cord
    if (!c) return
    if (c.hover) {
      const base = c.picked ? { ...m, wires: m.wires.filter(w => w.id !== c.picked) } : m
      const chk = checkConnect(base, c.anchor, c.hover)
      if ('error' in chk) { el.fail(c.picked ? chk.error + ' — cord put back' : chk.error); return }
      if (c.picked && 'error' in await el.disconnect(c.picked)) return
      if ('error' in await el.connect(chk.from, chk.to)) return
      el.ok((c.picked ? 'Moved cord: ' : 'Patched ') + portName(m, chk.from) + ' → ' + portName(m, chk.to))
      return
    }
    if (c.picked) { if (!('error' in await el.disconnect(c.picked))) el.ok('Unplugged a cord'); return }
    el.setState({ cord: null })
    return
  }
  if (!el.drag) return
  const still = Math.hypot(e.clientX - el.drag.x, e.clientY - el.drag.y) < 4
  el.drag = null
  el.setState({ dragging: false })
  if (still) pickAt(el, e)   // a click, not a turn
}

/** Selects what is under the pointer on the back: a jack's action, or a panel's or rack module's component. */
function pickAt(el: Wires, e: Ptr) {
  const m = el.model, pt = toLocal(el, e), hit = nearestPort(m.P, visibleKeys(el), pt, null)
  const inside = (r: { x: number; y: number; w: number; h: number }) => pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h
  const instance = hit !== null ? m.P[hit]!.owner : m.chassis.find(c => c.instance && inside(c))?.instance ?? m.rack.find(inside)?.id
  if (instance) el.pick({ system: el.system, instance, ...(hit !== null ? { op: Ops.key(m.P[hit]!.op) } : {}) })
}

export function onCancel(el: Wires) { el.drag = null; el.setState({ dragging: false, cord: null, lift: null }) }
export function onDbl(el: Wires) { if (!el.s.editing) el.setState({ ry: el.s.ry + 180, dragging: false }) }

export function toggleEdit(el: Wires) {
  const { ry, editing } = el.s
  if (editing) { el.setState({ editing: false, cord: null, armed: null, selMod: null, toast: null }); return }
  el.setState({ editing: true, ry: 180 + 360 * Math.round((ry - 180) / 360), rx: 0, dragging: false, toast: null })
}

/** A palette pick: relay mode adds it to the rack; puzzle mode arms it for a joint. */
export async function pickOperator(el: Wires, kind: string) {
  if (el.s.mode === 'puzzle') { el.setState({ armed: el.s.armed === kind ? null : kind, selMod: null }); return }
  const name = await el.create(kind)
  if (name) { el.ok('Added ' + (el.catalog[kind]?.title ?? kind) + ' to the rack — patch it in'); el.setState({ selMod: name }) }
}

/** Removes the selected rack component from the system, with its cords. */
export async function removeSel(el: Wires) {
  const id = el.s.selMod
  if (id === null) throw new Error('bug: remove with nothing selected')
  if (!('error' in await el.removeComponent(id))) { el.ok('Removed ' + id + ' and its cords'); el.setState({ selMod: null }) }
}

/** A joint: with an operator armed, splice a new one into the wire (its fitting in and out); otherwise unplug it. */
export async function joint(el: Wires, wireId: string) {
  const w = el.model.wires.find(x => x.id === wireId)
  if (!w) return
  const armed = el.s.armed
  if (armed === null) { if (!('error' in await el.disconnect(wireId))) el.ok('Unplugged ' + portName(el.model, w.from) + ' → ' + portName(el.model, w.to)); return }
  const from = el.model.P[w.from]!, to = el.model.P[w.to]!
  const ops = [...(el.catalog[armed]?.component.actions.values() ?? [])].map(a => a.op)
  // ponytail: the last fitting jacks, as components declare settings first and their main action and event last
  const inOp = ops.findLast(o => dirOf(o) === 'in' && Ops.fits(from.op, o)), outOp = ops.findLast(o => dirOf(o) === 'out' && Ops.fits(o, to.op))
  if (!inOp || !outOp) { el.fail((el.catalog[armed]?.title ?? armed) + " doesn't fit between " + portName(el.model, w.from) + ' and ' + portName(el.model, w.to)); return }
  const name = await el.create(armed)
  if (!name) return
  // all or nothing: if a step is refused, undo the ones before it, so the chain is as it was
  const undo: (() => Promise<unknown>)[] = [() => el.removeComponent(name)]
  const step = async (r: Promise<{ value?: unknown } | { error: string }>, back?: (v: any) => () => Promise<unknown>) => {
    const res = await r
    if ('error' in res) { for (const u of undo.reverse()) await u(); el.rebuild(); el.fail(res.error); return false }
    if (back) undo.push(back(res.value))
    return true
  }
  if (!await step(el.disconnect(wireId), () => () => el.connect(w.from, w.to))) return
  el.rebuild()   // the new component's jacks, before patching them
  if (!await step(el.connect(w.from, portKey(name, Ops.key(inOp))), sub => () => el.disconnect(sub.id))) return
  if (!await step(el.connect(portKey(name, Ops.key(outOp)), w.to))) return
  el.ok('Inserted ' + (el.catalog[armed]?.title ?? armed))
  el.setState({ armed: null })
}
