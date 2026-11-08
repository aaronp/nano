/**
 * The adapter between this host and @composable components. Nothing else in the starter knows about them, and
 * they know nothing about the starter:
 *   - one System for the page, provided on the document, so any composable view (in markup, or cloned into a
 *     dock panel) creates and registers its component there, and unregisters it when it is removed;
 *   - our theme tokens (--c-*) are mapped onto this starter's in app.css (CSS only);
 *   - our notifications are mirrored onto the starter's bus as `composable:<op>`, so its widgets (bus-log,
 *     status-line) show them.
 * The page System is also a component (`system`), and an orchestrator keeps it wired to intents. When
 * <puzzle-editor name="editor"> places itself, it is linked: system/changed → its set-instances, its
 * intents-updated → orchestrator/set-intents; when it is removed, the orchestrator's intents are cleared. Its document is loaded from localStorage (or the empty one), and saved there.
 * Imported before the views are defined, so the provider exists when markup upgrades.
 */
import { Components, Systems, fail, type Component, type Result } from '@composable/sdk'
import { provideSystem } from '@composable/ui'
import { defineElements } from '@composable/widgets/views'
import { OrchestratorOps, Orchestrators } from '@composable/connections'
import { ComponentListOps, ConnectionEditorOps, DocumentOps, emptyEditorDoc } from '@composable/puzzle-editor'
import { defineEditor } from '@composable/puzzle-editor/views'
import { requestBus } from './lib/bus.ts'

/** The page's System. Other Systems (sandboxes, a workspace of its own) are just more `Systems.create()`. */
export const scope = Systems.create({ id: 'page', onError: (e, info) => console.error('composable:', e, info) })
const log = (r: Result<unknown>) => { if (r.type !== 'success') console.error('composable:', r.type === 'error' ? r.error : r) }
const saved = 'ui-workspace.editor'

// linked before `system` exists, so this runs before it publishes the editor's arrival
scope.updates(d => {
  if ((d.type !== 'added' && d.type !== 'removed') || !d.instances.some(i => i.id === 'editor')) return
  // the editor's links close with it, but the routes it asked for would stay: take its intents down too
  if (d.type === 'removed') { if (host.type === 'success') void host.data.call('orchestrator', OrchestratorOps.setIntents, []).then(log); return }
  log(scope.subscribe({ source: 'system', op: Systems.ops.changed.name, listener: 'editor', target: ComponentListOps.setInstances.name }))
  log(scope.subscribe({ source: 'editor', op: ConnectionEditorOps.intentsUpdated.name, listener: 'orchestrator', target: OrchestratorOps.setIntents.name }))
  void restore()
})
log(scope.register('system', Systems.component(scope).create() as Component))   // its create is synchronous
log(Orchestrators.create(scope, []))
const host = scope.register('host', Components.party())   // the host's own handle, to load the editor's document

/**
 * Load the saved document, or the empty one if nothing is saved. Saving waits for that load, so the editor's
 * changes before it are not saved over the document. One that cannot be loaded is copied to `<key>.rejected`,
 * and the editor starts empty and saves as usual, so both the old data and the new work survive.
 */
let saving = false
const restore = async () => {
  if (host.type !== 'success') return log(host)
  let raw: string | null = null
  try { raw = localStorage.getItem(saved) } catch {}
  saving = false
  let r: Result<unknown> = fail('validation', 'the saved editor document is not JSON')
  try { if (raw !== null) r = await host.data.call('editor', DocumentOps.load, JSON.parse(raw)) } catch {}
  if (r.type !== 'success') {
    if (raw !== null) {
      try { localStorage.setItem(`${saved}.rejected`, raw) } catch {}
      console.error(`composable: the saved editor document was rejected; moved to ${saved}.rejected:`, r, raw)
    }
    log(await host.data.call('editor', DocumentOps.load, emptyEditorDoc()))
  }
  saving = true
}
scope.observe(t => {
  if (saving && t.kind === 'notify' && t.from === 'editor' && t.op === DocumentOps.modelUpdated.name) try { localStorage.setItem(saved, JSON.stringify(t.data)) } catch {}
})
provideSystem(document, scope)
defineElements()
defineEditor()

void customElements.whenDefined('app-shell').then(() => {
  const shell = document.querySelector('app-shell')
  if (!shell) return
  const bus = requestBus(shell as HTMLElement)
  scope.observe(t => { if (t.kind === 'notify') bus.publish(`composable:${t.op.split('/').pop()}`, t.data, t.from) })
})
