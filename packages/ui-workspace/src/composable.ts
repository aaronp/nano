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
 * intents-updated → orchestrator/set-intents. Its document is saved to localStorage and loaded back.
 * Imported before the views are defined, so the provider exists when markup upgrades.
 */
import { Components, Systems, type Component, type Result } from '@composable/sdk'
import { provideSystem } from '@composable/ui'
import { defineElements } from '@composable/widgets/views'
import { OrchestratorOps, Orchestrators } from '@composable/connections'
import { ComponentListOps, ConnectionEditorOps, DocumentOps } from '@composable/puzzle-editor'
import { defineEditor } from '@composable/puzzle-editor/views'
import { requestBus } from './lib/bus.ts'

/** The page's System. Other Systems (sandboxes, a workspace of its own) are just more `Systems.create()`. */
export const scope = Systems.create({ id: 'page', onError: (e, info) => console.error('composable:', e, info) })
const log = (r: Result<unknown>) => { if (r.type !== 'success') console.error('composable:', r.type === 'error' ? r.error : r) }
const saved = 'ui-workspace.editor'

// linked before `system` exists, so this runs before it publishes the editor's arrival
scope.updates(d => {
  if (d.type !== 'added' || !d.instances.some(i => i.id === 'editor')) return
  log(scope.subscribe({ source: 'system', op: Systems.ops.changed.name, listener: 'editor', target: ComponentListOps.setInstances.name }))
  log(scope.subscribe({ source: 'editor', op: ConnectionEditorOps.intentsUpdated.name, listener: 'orchestrator', target: OrchestratorOps.setIntents.name }))
  let doc: unknown
  try { doc = JSON.parse(localStorage.getItem(saved) ?? 'null') } catch {}
  if (doc && host.type === 'success') void host.data.call('editor', DocumentOps.load, doc as never).then(log)
})
log(scope.register('system', Systems.component(scope).create() as Component))   // its create is synchronous
log(Orchestrators.create(scope, []))
const host = scope.register('host', Components.party())   // the host's own handle, to load a saved document
scope.observe(t => {
  if (t.kind === 'notify' && t.from === 'editor' && t.op === DocumentOps.modelUpdated.name) try { localStorage.setItem(saved, JSON.stringify(t.data)) } catch {}
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
