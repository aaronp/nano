// The platform as a list: one row per instance in each system, then one per kind nothing has been made of.
import type { TSchema } from 'typebox'
import type { Snapshot } from '@pritzlaff/nano-core'
import type { Kind } from './platform'

/** A row of the inventory. A kind never made has `—` for system, instance and owner. */
export type Row = { system: string; component: string; instance: string; name: string; owner: string; description: string }
/** The system filter that keeps kinds never made. */
export const UNREGISTERED = 'Unregistered'
/** Pill filters: OR within a group, AND across groups; an empty group keeps everything. */
export type Filters = { systems: string[]; components: string[] }

const NONE = '—'

/** Every instance in every system, in order, then each kind no system holds an instance of. */
export function inventory(systems: Snapshot[], kinds: Kind[]): Row[] {
  const byComponent = new Map<string, string[]>()
  for (const k of kinds) byComponent.set(k.component, [...(byComponent.get(k.component) ?? []), k.kind])
  const made = new Set<string>()
  const rows: Row[] = systems.flatMap(s => s.instances.map(i => {
    made.add(i.component)
    return { system: s.id, component: byComponent.get(i.component)?.join(', ') ?? NONE, instance: i.id, name: i.component, owner: i.owner ? `${i.owner.kind} · ${i.owner.name}` : 'unknown', description: i.description ?? '' }
  }))
  for (const k of kinds) if (!made.has(k.component)) rows.push({ system: NONE, component: k.kind, instance: NONE, name: k.component, owner: NONE, description: k.description ?? '' })
  return rows
}

/** Whether a row passes the free text (any column, any case) and the pills. */
export function matches(row: Row, q: string, f: Filters): boolean {
  const text = q.trim().toLowerCase()
  if (text && !Object.values(row).some(v => v.toLowerCase().includes(text))) return false
  if (f.systems.length && !f.systems.includes(row.system === NONE ? UNREGISTERED : row.system)) return false
  return !f.components.length || row.component.split(', ').some(k => f.components.includes(k))
}

/** A schema's examples, for showing: at most two, as JSON, each cut to 40 characters. */
export function examplesOf(s?: TSchema): string {
  const xs = ((s as { examples?: unknown[] } | undefined)?.examples ?? []).slice(0, 2)
  return xs.map(x => { const j = JSON.stringify(x) ?? String(x); return j.length > 40 ? `${j.slice(0, 39)}…` : j }).join(', ')
}
