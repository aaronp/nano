// Packets: messages in flight along the drawn pipes, and how a packet is drawn.
import { svg } from 'lit'
import type { AppEvent } from '@pritzlaff/nano-core'
import { MAX_PACKETS, TRAVEL_MS, clamp, short } from './constants'
import type { Vals } from './render-root'
import type { Wires } from './wires'
/** Packets in flight on drawn wires, with how far along they are. */
export const inFlight = (el: Wires, d: Vals) => d.s.packets
  .filter(p => d.m.wires.some(w => w.id === p.wire))
  .map(p => {
    const w = d.m.wires.find(x => x.id === p.wire)!
    return { ...p, w, f: clamp((d.now - p.born) / TRAVEL_MS, 0, 1), color: d.routeById(w.route).color, op: d.opFor(w.route) }
  })

/** A packet dot with its value. */
export const packet = (k: { x: number; y: number; color: string; op: number; label: string }, r: number, sw: number, dx: number) => svg`<g opacity=${k.op}>
  <circle cx=${k.x.toFixed(1)} cy=${k.y.toFixed(1)} r=${r} fill="#FFFFFF" stroke=${k.color} stroke-width=${sw}></circle>
  <text class="pkt-label" x=${(k.x + dx).toFixed(1)} y=${(k.y - 9).toFixed(1)} font-family="JetBrains Mono, monospace" font-size="10.5" font-weight="600" fill="#FFFFFF">${k.label}</text>
</g>`


let packetId = 0
/** A pipe message on a drawn wire sends a packet along it, flashes its source and counts it. */
export function tracePacket(el: Wires, t: AppEvent) {
  if (!el.flipped || t.type !== 'sent' || t.kind !== 'pipe') return   // flat: nothing to draw
  const prefix = `${t.runtime}|${t.from}|${t.to}|${t.port}|`, wire = el.model.wires.find(w => w.id.startsWith(prefix))
  if (!wire) return
  const now = el.now(), { stats, flashes } = el.s
  const stat = (id: string) => stats[id] ?? { in: 0, out: 0 }
  // BACKLOG(6): a `sent` event carries no data, so the packet is labelled with the target op, not the value.
  const label = short(t.port.slice(t.port.lastIndexOf('/') + 1), 12)
  el.setState({
    packets: [...el.s.packets, { id: packetId++, wire: wire.id, born: now, label }].slice(-MAX_PACKETS),
    flashes: { ...flashes, [t.from]: now },
    stats: { ...stats, [t.from]: { ...stat(t.from), out: stat(t.from).out + 1 }, [t.to]: { ...stat(t.to), in: stat(t.to).in + 1 } },
  })
}
/** Packets that arrived flash their target. */
export function landPackets(el: Wires) {
  const now = el.now(), arrived = el.s.packets.filter(p => now - p.born >= TRAVEL_MS)
  if (arrived.length) {
    const hits = { ...el.s.hits }
    for (const p of arrived) { const w = el.model.wires.find(x => x.id === p.wire); if (w) hits[el.model.P[w.to]!.owner] = now }
    el.setState({ packets: el.s.packets.filter(p => !arrived.includes(p)), hits })
  }
}
