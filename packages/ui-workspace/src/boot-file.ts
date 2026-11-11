/** The File menu on the page: file:* events run src/app/file.ts over the page's real stores and dialogs; `?src=` opens a document on load. */
import { host, catalog } from './composable.ts'
import { showStatus } from './lib/status.ts'
import { applyApp } from './app/apply.ts'
import { snapshotApp } from './app/snapshot.ts'
import { fileCommands, showNotes } from './app/file.ts'
import { app, stores, importPackage, stopAutosave } from './boot-app.ts'
import { mountWorkspace } from './components/saved-workspaces.ts'
import { openDialog } from './components/open-dialog.ts'
import { confirmImports } from './components/imports-confirm.ts'
import { askConfirm, askName } from './components/name-dialog.ts'

const keptCopies = () => (['unrestored', 'bad'] as const).flatMap(key => { const text = app.stashed(key); return text === null ? [] : [{ key, text }] })
const cmds = fileCommands({
  doc: document, app, catalog, snapshot: () => snapshotApp({ host, stores }),
  imports: () => stores.imports.list(),
  merge: (a, consentCode) => applyApp(a, 'merge', { host, stores, catalog, importPackage, consentCode }),
  workspaces: () => stores.workspaces.list(), mount: ws => mountWorkspace(document, ws),
  stopAutosave, reload: () => location.reload(), say: t => showStatus(document, t),
  download: (name, text) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000) },
  changed: s => { menu().dirty = app.dirty(s) },
  ui: {
    open: ({ mode }) => openDialog(document, { mode, apps: app.apps(), kept: keptCopies(), discard: k => app.discard(k) }),
    confirmImports: (a, already, code) => confirmImports(document, a.imports, already, code),
    askName: s => askName(document, s), confirm: (m, ok) => askConfirm(document, m, ok),
  },
})
const menu = () => document.querySelector('nano-file-menu') as HTMLElement & { dirty: boolean }
const refresh = () => { const w = app.working(); menu().dirty = !w || app.dirty(w) }
// the baseline for "unsaved changes": a fresh page, or a document just opened, is read back from the running app
if (app.needsBase()) app.setBase(await snapshotApp({ host, stores }))
showNotes(app, t => showStatus(document, t))
for (const c of Object.keys(cmds) as (keyof typeof cmds)[]) if (c !== 'src') document.addEventListener(`file:${c}`, () => void cmds[c]())
document.addEventListener('nano:working-saved', refresh)
refresh()

const src = new URL(location.href).searchParams.get('src')
if (src) void cmds.src(src, location.href, () => { const u = new URL(location.href); u.searchParams.delete('src'); history.replaceState(null, '', u) })
