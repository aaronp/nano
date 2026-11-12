// What the File menu's commands do, over injected deps (boot-file.ts passes the page's real ones, tests pass fakes).
// Open and New replace the app by writing the working copy and reloading (imports can't be unloaded); Import
// merges into the running app. A document is untrusted data: it is checked, its imports and code are confirmed.
import { checkApp, MAX_BYTES, RESERVED, type NanoApp } from '@composable/shell'
import { codeTarget } from './apply.ts'
import type { AppCatalog } from '../sandbox/deploy.ts'
import type { SavedWorkspace } from '../lib/saved-workspaces.ts'
import type { appStore } from './store.ts'

/** An instance whose code (or config, or a wiring into a code op) would run in the host page. */
export type CodeUse = { system: string; instance: string; kind: string }
export type Pick = { imports: { url: string; trust: 'trusted' | 'sandboxed' }[]; code: string[] }   // code: "system/instance" keys agreed to
/** `own`: one of this browser's saved apps or kept copies, which needs no confirmation (like the restored working copy); `kept`: which kept copy it was, discarded once applied. */
export type Opened = { app: NanoApp; name?: string; own?: boolean; kept?: 'bad' | 'unrestored' }
export type Ui = {
  open(opts: { mode: 'open' | 'import' }): Promise<Opened | null>
  confirmImports(app: NanoApp, already: string[], code: CodeUse[]): Promise<Pick | null>
  askName(suggested: string): Promise<string | null>
  confirm(message: string, ok: string): Promise<boolean>
}
export interface FileDeps {
  doc: Document
  app: ReturnType<typeof appStore>
  snapshot(): Promise<NanoApp>
  catalog: AppCatalog
  /** The imports now in this page, for "already imported". */
  imports(): { url: string; trust?: string }[]
  /** Import: applies a document to the running app, giving its notes. */
  merge(app: NanoApp, consentCode: (system: string, instance: string) => boolean): Promise<string[]>
  workspaces(): SavedWorkspace[]
  mount(ws: SavedWorkspace): void
  /** Stops autosave: it must not write over the working copy Open/New are about to leave for the reload. */
  stopAutosave(): void
  reload(): void
  say(text: string): void
  download(filename: string, text: string): void
  /** Called after a save or a name change, so the menu can show whether there are unsaved changes. */
  changed(snapshot: NanoApp): void
  ui: Ui
}

/** Shows (once) what the last Open/New left out or downgraded, after the reload. */
export const showNotes = (app: Pick2, say: (t: string) => void) => { const n = app.takeNotes(); if (n.length) say(`When the app was opened: ${n.join(' · ')}`) }
type Pick2 = { takeNotes(): string[] }

export const emptyApp = (): NanoApp => ({ nano: 1, title: 'Untitled', theme: { id: 'enterprise' }, imports: [], systems: [], workspaces: [] })

/** A document from text, or why not. The size is checked before parsing. */
export function parseApp(text: string): NanoApp | string {
  if (text.length > MAX_BYTES) return 'larger than 1 MB'
  let v: unknown
  try { v = JSON.parse(text) } catch { return 'not JSON' }
  return checkApp(v)
}

/** A document from a URL (absolute, or relative to the page), without credentials, read up to 1 MB; or why not. */
export async function fetchApp(url: string, base: string, fetchFn: typeof fetch = fetch): Promise<NanoApp | string> {
  let u: URL
  try { u = new URL(url, base) } catch { return 'not a URL' }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'only http: and https: URLs can be opened'
  try {
    const r = await fetchFn(u.href, { credentials: 'omit', redirect: 'follow' })
    if (!r.ok) return `${r.status} ${r.statusText}`.trim()
    const len = Number(r.headers.get('content-length'))
    if (len > MAX_BYTES) return 'larger than 1 MB'
    // read at most 1 MB, so a huge response is not held in memory
    const reader = r.body?.getReader()
    if (!reader) return parseApp(await r.text())
    const chunks: Uint8Array[] = []
    let n = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      n += value.length
      if (n > MAX_BYTES) { void reader.cancel(); return 'larger than 1 MB' }
      chunks.push(value)
    }
    const all = new Uint8Array(n); let at = 0
    for (const c of chunks) { all.set(c, at); at += c.length }
    return parseApp(new TextDecoder().decode(all))
  } catch (e) { return `could not be fetched (${e instanceof Error ? e.message : String(e)})` }
}

/** The instances of a document that would run code: of a kind with code-taking ops, with a config, or wired into one. */
export function codeUses(app: NanoApp, catalog: AppCatalog): CodeUse[] {
  const out: CodeUse[] = []
  for (const sys of app.systems) for (const i of sys.instances) {
    const ops = !RESERVED(i.id) && Object.hasOwn(catalog, i.kind) ? catalog[i.kind]!.code : undefined
    if (ops?.length && (i.config !== undefined || sys.subscriptions.some(s => s.listener === i.id && codeTarget(catalog, i.kind, s.target))))
      out.push({ system: sys.id, instance: i.id, kind: i.kind })
  }
  return out
}

/** The document without the code of `declined` instances: their config, and the wirings into their code ops. */
export function withoutCode(app: NanoApp, declined: CodeUse[], catalog: AppCatalog): NanoApp {
  if (!declined.length) return app
  const no = (s: string, i: string) => declined.some(d => d.system === s && d.instance === i)
  return { ...app, systems: app.systems.map(sys => ({
    ...sys,
    instances: sys.instances.map(i => { if (!no(sys.id, i.id)) return i; const { config: _, ...rest } = i; return rest }),
    subscriptions: sys.subscriptions.filter(s => {
      if (!no(sys.id, s.listener)) return true
      const kind = sys.instances.find(i => i.id === s.listener)?.kind
      return !codeTarget(catalog, kind, s.target)
    }),
  })) }
}

const key = (c: { system: string; instance: string }) => `${c.system}/${c.instance}`
const fileName = (s: string) => `${s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim().slice(0, 100) || 'nano'}.json`

export function fileCommands(d: FileDeps) {
  const { app, ui } = d
  const unsaved = async () => app.dirty(await d.snapshot())

  /** Whether replacing the app may go ahead: yes when nothing is unsaved, or the person agrees. */
  const mayReplace = async () => !(await unsaved()) || ui.confirm('This app has changes that are not saved. Replace it anyway? (Save or Download first to keep them.)', 'Replace')

  /** Writes the document as the working copy with its name, baseline and notes (all or none), and reloads. false: nothing was changed. */
  function replaceWith(doc: NanoApp, name: string | null, notes: string[] = [], written?: () => void): boolean {
    const e = app.adopt(doc, name, notes)   // before anything stops: a failed write changes nothing
    if (e) { d.say(e); return false }
    d.stopAutosave(); written?.(); d.reload()   // `written` (clearing ?src=) first: the reload keeps the URL it was called with
    return true
  }

  /** Confirms the imports and code of a document (not an `own` one), then replaces or merges. 'cancelled' changes nothing. */
  async function load(o: Opened, how: 'replace' | 'merge', hooks: { keep?: () => Promise<string | null>; written?: () => void } = {}): Promise<'applied' | 'cancelled' | 'failed'> {
    let doc = o.app
    const have = d.imports()
    const already = doc.imports.filter(i => have.some(h => h.url === i.url && (h.trust ?? 'sandboxed') === i.trust)).map(i => i.url)
    const code = codeUses(doc, d.catalog)
    let consent = new Set(code.map(key))
    const notes: string[] = []
    if (!o.own && (doc.imports.some(i => !already.includes(i.url)) || code.length)) {
      const r = await ui.confirmImports(doc, already, code)
      if (!r) return 'cancelled'
      // anything not explicitly kept trusted is sandboxed
      doc = { ...doc, imports: doc.imports.map(i => {
        const keepTrusted = already.includes(i.url) || (i.trust === 'trusted' && r.imports.find(x => x.url === i.url)?.trust === 'trusted')
        if (i.trust === 'trusted' && !keepTrusted) notes.push(`${i.url} was imported sandboxed, not trusted`)
        return { url: i.url, trust: keepTrusted ? i.trust : 'sandboxed' as const }
      }) }
      consent = new Set(r.code)
    }
    const declined = code.filter(c => !consent.has(key(c)))
    for (const c of declined) notes.push(`${key(c)}: its ${c.kind} code was not applied (not agreed to)`)
    if (how === 'replace') {
      const why = await hooks.keep?.(); if (why) { d.say(why); return 'failed' }
      if (!replaceWith(withoutCode(doc, declined, d.catalog), o.name ?? null, notes, hooks.written)) return 'failed'
      if (o.kept) app.discard(o.kept)
      return 'applied'
    }
    const before = new Set(d.workspaces().map(w => w.path))
    const merged = await d.merge(doc, (s, i) => consent.has(`${s}/${i}`))
    for (const ws of d.workspaces()) if (!before.has(ws.path)) d.mount(ws)
    d.doc.dispatchEvent(new CustomEvent('nano:changed'))
    const all = [...notes.filter(n => !n.includes('not agreed to')), ...merged]
    d.say(all.length ? `Imported, with ${all.length} note${all.length === 1 ? '' : 's'}: ${all.join(' · ')}` : 'Imported.')
    return 'applied'
  }

  async function saveAs() {
    const n = await ui.askName(app.name() ?? (await d.snapshot()).title)
    if (n === null) return
    if (Object.hasOwn(app.apps(), n) && n !== app.name() && !(await ui.confirm(`There is already a saved app called "${n}". Replace it?`, 'Replace'))) return
    const snap = await d.snapshot()
    const e = app.save(n, snap)
    if (e) return d.say(e)
    const e2 = app.setName(n) ?? app.setBase(snap)
    if (e2) return d.say(e2)
    d.changed(snap)
  }

  const cmds = {
    new: async () => { if (await mayReplace()) replaceWith(emptyApp(), null) },
    open: async () => { if (!(await mayReplace())) return; const o = await ui.open({ mode: 'open' }); if (o) await load(o, 'replace') },
    import: async () => { const o = await ui.open({ mode: 'import' }); if (o) await load(o, 'merge') },
    save: async () => {
      const n = app.name()
      if (n === null) return saveAs()
      const snap = await d.snapshot()
      if (!app.dirty(snap)) return
      const e = app.save(n, snap)
      const e2 = e ?? app.setBase(snap)
      if (e2) d.say(e2); else d.changed(snap)
    },
    'save-as': saveAs,
    download: async () => { const s = await d.snapshot(); d.download(fileName(app.name() ?? s.title), JSON.stringify(s, null, 2)) },
    /**
     * `?src=`: fetches the document and opens it like Open, after the imports confirmation. Unsaved work is first
     * kept as a saved app "Before opening <host+path>" (deduplicated); the document has no name; `clearSrc` removes
     * `?src=` from the address bar once it is applied (or declined), not when it could not be fetched.
     */
    src: async (url: string, base: string, clearSrc: () => void, fetchFn?: typeof fetch) => {
      const got = await fetchApp(url, base, fetchFn)
      if (typeof got === 'string') return d.say(`Could not open ${url}: ${got}`)
      const u = new URL(url, base)
      const keep = async () => {
        const w = await d.snapshot()   // the live app, not the stored copy (up to 500 ms behind)
        if (!app.dirty(w)) return null
        const apps = app.apps(), base0 = `Before opening ${u.host}${u.pathname}`
        let name = base0
        for (let n = 2; Object.hasOwn(apps, name); n++) name = `${base0} (${n})`
        const e = app.save(name, w)
        return e ? `Your unsaved work could not be kept, so ${url} was not opened: ${e}` : null
      }
      const r = await load({ app: got }, 'replace', { keep, written: clearSrc })
      if (r === 'cancelled') clearSrc()
    },
  }
  // one command at a time: a second click (or file:* event) while one is running, a dialog open, is ignored
  let busy = false
  const once = <A extends unknown[]>(f: (...a: A) => Promise<unknown>) => async (...a: A) => { if (busy) return; busy = true; try { await f(...a) } finally { busy = false } }
  return { new: once(cmds.new), open: once(cmds.open), import: once(cmds.import), save: once(cmds.save), 'save-as': once(cmds['save-as']), download: once(cmds.download), src: once(cmds.src) }
}
