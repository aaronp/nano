// Desk editing, only while the Edit toggle is on: a jack click selects it and marks the jacks it fits, a second click
// patches; a cord click selects the pipe, Delete or [data-remove] unplugs it. Each returns the refusal, if any.
import type { Host } from '../host.ts'
import { checkConnect, type Model } from '../wires/model'
import { connectPipe, disconnectPipe } from '../wires/edit'

export type Sel = { jack: string } | { pipe: string } | null

/** A jack's key (`pod port:dir`) from its data-jack (`runtime pod port:dir`). */
export const keyOf = (dataJack: string) => dataJack.slice(dataJack.indexOf(' ') + 1)
const runtimeOf = (dataJack: string) => dataJack.slice(0, dataJack.indexOf(' '))
/** The jack keys that can take a cord from or to `key`. */
export const fitting = (m: Model, key: string) => new Set(Object.keys(m.P).filter(b => !('error' in checkConnect(m, key, b))))

/** Patches `a` to `b` (data-jack values) in the runtime both were clicked in; the refusal, or undefined. */
export async function patch(h: Host, m: Model, a: string, b: string): Promise<string | undefined> {
  if (runtimeOf(a) !== runtimeOf(b)) return 'A pipe joins two jacks in one runtime'
  const c = checkConnect(m, keyOf(a), keyOf(b))
  if ('error' in c) return c.error
  const r = await connectPipe(h, m, c.from, c.to, runtimeOf(a))
  return 'error' in r ? r.error : undefined
}
/** Unplugs the pipe `id`; the refusal, or undefined. */
export async function unplug(h: Host, id: string): Promise<string | undefined> {
  const r = await disconnectPipe(h, id)
  return 'error' in r ? r.error : undefined
}
