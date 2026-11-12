/** The Application's screens, kept in this browser in the format saved workspaces have always had: the saved list under
 * KEY (never the main workspace), each saved one's dock layout under `<main dock's storage-key>.saved.<path>`. The main
 * workspace's layout stays under its dock's own storage-key: read here at start, written only by that dock. */
import { Ops, type Runtime } from '@pritzlaff/nano-core'
import { PlatformOps as P, type Screen } from '@composable/platform'
import { KEY, savedWorkspaces, type SavedWorkspace } from './saved-workspaces.ts'

/** The main workspace's route: a screen, first, but never in the saved list or a document. */
export const MAIN = '/workspace'
const FROM = { registry: 'host', instance: 'screens' }

/** Where a saved workspace's dock keeps its layout. */
export const layoutKey = (mainKey: string, path: string) => `${mainKey}.saved.${path}`

const call = (app: Pick<Runtime, 'call'>, op: { ns: string; name: string }, arg: unknown) => app.call(FROM, 'application', Ops.key(op), arg)
const parse = (s: string | null): unknown => { try { return s === null ? null : JSON.parse(s) } catch { return null } }

/** The Application's screens, in navigation order ([] if it can't say). */
export async function screensOf(app: Pick<Runtime, 'call'>): Promise<Screen[]> {
  const r = await call(app, P.screens, null)
  return 'value' in r ? r.value as Screen[] : []
}

/** The saved workspaces (every screen but Main), as the nav shows them. */
export const savedScreens = async (app: Pick<Runtime, 'call'>, mainPath = MAIN): Promise<SavedWorkspace[]> =>
  (await screensOf(app)).filter(s => s.id !== mainPath).map(s => ({ path: s.id, title: s.title, icon: s.icon ?? 'folder', system: s.system }))

/** Adds or replaces a screen; the refusal, if any. */
export async function setScreen(app: Pick<Runtime, 'call'>, screen: Screen): Promise<string | null> {
  const r = await call(app, P.setScreen, screen)
  return 'error' in r ? r.error : null
}

/** Gives a screen a new layout, if `path` is a screen. */
export async function setLayout(app: Pick<Runtime, 'call'>, path: string, layout: unknown) {
  const s = (await screensOf(app)).find(x => x.id === path)
  if (s) await setScreen(app, { ...s, layout })
}

/** Moves a screen one place; false at an end or if unknown. */
export const moveScreen = async (app: Pick<Runtime, 'call'>, id: string, by: -1 | 1) => !('error' in await call(app, P.moveScreen, { id, by }))

/**
 * Loads the screens from `storage` into the Application (Main first, then each saved one in order; a saved one's
 * system is made if it doesn't exist yet, since systems aren't saved), then writes them back on every change of
 * screens. Gives the function that stops the writing.
 */
export async function persistScreens(app: Pick<Runtime, 'call' | 'listen'>, storage: Storage, mainPath = MAIN, mainKey = 'workspace'): Promise<() => void> {
  const saved = savedWorkspaces(storage).list().filter(w => w.path !== mainPath)
  const systems = await call(app, P.systems, null), have = new Set('value' in systems ? (systems.value as { id: string }[]).map(s => s.id) : [])
  for (const system of new Set(saved.map(w => w.system ?? 'host'))) if (!have.has(system)) await call(app, P.createSystem, system)
  const load = async (s: Screen) => { const e = await setScreen(app, s); if (e) console.warn(`screen ${s.id} not loaded: ${e}`) }
  await load({ id: mainPath, title: 'Main', system: 'host', layout: parse(storage.getItem(mainKey)) })
  for (const w of saved) await load({ id: w.path, title: w.title, ...(w.icon && { icon: w.icon }), system: w.system ?? 'host', layout: parse(storage.getItem(layoutKey(mainKey, w.path))) })

  const write = async (ref: string | undefined) => {
    const all = (await screensOf(app)).filter(s => s.id !== mainPath)
    try {
      storage.setItem(KEY, JSON.stringify(all.map(s => ({ path: s.id, title: s.title, icon: s.icon, system: s.system }))))
      // only the screen that changed has a new layout; a screen without one leaves its key alone
      for (const s of all) if (ref === `screen:${s.id}` && s.layout !== null && s.layout !== undefined) storage.setItem(layoutKey(mainKey, s.id), JSON.stringify(s.layout))
    } catch (e) { console.error('screens could not be saved:', e) }
  }
  return app.listen(t => {
    const d = t.data as { what?: string; ref?: string } | null
    if (t.kind === 'publish' && t.from.instance === 'application' && t.op === Ops.key(P.changed) && d?.what === 'screens') void write(d.ref)
  })
}
