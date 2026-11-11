import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { expect, test } from 'bun:test'
import { checkApp, type NanoApp } from '@composable/shell'
import { appStore } from '../src/app/store'
import { fileCommands, type FileDeps, type Pick } from '../src/app/file'
import { appHost } from './fixtures/app-host'

const memory = () => {
  const m = new Map<string, string>()
  return { m, getItem: (k: string) => m.get(k) ?? null, removeItem: (k: string) => { m.delete(k) }, setItem: (k: string, v: string) => { m.set(k, v) } }
}
const doc = (title: string, extra: Partial<NanoApp> = {}): NanoApp => ({ nano: 1, title, imports: [], systems: [], workspaces: [], ...extra })
const trusted: NanoApp = doc('T', { imports: [{ url: 'https://p/m.json', trust: 'trusted' }, { url: 'https://q/m.json', trust: 'sandboxed' }] })
const withMap: NanoApp = doc('M', { systems: [{ id: 'host', instances: [{ id: 'm1', kind: 'map', config: 'return x' }, { id: 'l1', kind: 'log' }], subscriptions: [] }] })

function setup(current: NanoApp = doc('Now'), ui: Partial<FileDeps['ui']> = {}) {
  const storage = memory(), app = appStore(storage)
  const log = { reloads: 0, stopped: 0, said: [] as string[], downloads: [] as [string, string][], merged: [] as { a: NanoApp; consent: (s: string, i: string) => boolean }[], asked: [] as string[], mounted: [] as string[] }
  const ws: any[] = []
  const deps: FileDeps = {
    app, catalog: appHost().catalog, snapshot: async () => current, imports: () => [],
    merge: async (a, consent) => { log.merged.push({ a, consent }); ws.push({ path: '/new', title: 'N', icon: 'folder', system: 'host' }); return ['note one'] },
    workspaces: () => ws, mount: w => log.mounted.push(w.path),
    stopAutosave: () => { log.stopped++ }, reload: () => { log.reloads++ }, say: t => log.said.push(t),
    download: (n, t) => log.downloads.push([n, t]), changed: () => {},
    ui: { open: async () => null, confirmImports: async () => null, askName: async () => null, confirm: async m => { log.asked.push(m); return false }, ...ui },
  }
  return { app, storage, log, cmds: fileCommands(deps) }
}

test('New with unsaved changes asks; declining changes nothing; accepting writes an empty working copy titled Untitled and reloads', async () => {
  const s = setup()
  s.app.setWorking(doc('Mine'))
  await s.cmds.new()
  expect(s.log.asked.length).toBe(1); expect(s.log.reloads).toBe(0); expect(s.log.stopped).toBe(0); expect(s.app.working()!.title).toBe('Mine')
  const t = setup(doc('Now'), { confirm: async () => true })
  t.app.setWorking(doc('Mine')); t.app.setName('x')
  await t.cmds.new()
  expect(t.app.working()).toMatchObject({ title: 'Untitled', imports: [], systems: [], workspaces: [] }); expect(t.app.name()).toBeNull()
  expect(t.log.reloads).toBe(1); expect(t.log.stopped).toBe(1)
})

test('Open validates (the dialog), confirms imports, writes the working copy with the saved name, and reloads; unsaved changes ask first', async () => {
  let opened = 0
  const s = setup(doc('Now'), { open: async () => { opened++; return { app: doc('Other'), name: 'other' } } })
  await s.cmds.open()   // unsaved (no name) and the question is declined
  expect(opened).toBe(0); expect(s.log.reloads).toBe(0); expect(s.app.working()).toBeNull()
  const saved = doc('Now'); const t = setup(saved, { open: async () => { opened++; return { app: doc('Other'), name: 'other' } } })
  t.app.save('cur', saved); t.app.setName('cur')   // clean: no question
  await t.cmds.open()
  expect(t.log.asked.length).toBe(0); expect(t.app.working()!.title).toBe('Other'); expect(t.app.name()).toBe('other'); expect(t.log.reloads).toBe(1)
})

test('a trusted import is sandboxed unless ticked; Cancel changes nothing', async () => {
  const cur = doc('Now'), seen: any[] = []
  const mk = (pick: Pick | null) => { const s = setup(cur, { open: async () => ({ app: trusted }), confirmImports: async (a, already, code) => { seen.push([a.imports.length, already, code]); return pick } }); s.app.save('c', cur); s.app.setName('c'); return s }
  const cancel = mk(null); await cancel.cmds.open()
  expect(cancel.app.working()).toBeNull(); expect(cancel.log.reloads).toBe(0); expect(cancel.log.stopped).toBe(0)
  const none = mk({ imports: [{ url: 'https://p/m.json', trust: 'sandboxed' }, { url: 'https://q/m.json', trust: 'sandboxed' }], code: [] }); await none.cmds.open()
  expect(none.app.working()!.imports.map(i => i.trust)).toEqual(['sandboxed', 'sandboxed'])
  const ticked = mk({ imports: [{ url: 'https://p/m.json', trust: 'trusted' }, { url: 'https://q/m.json', trust: 'sandboxed' }], code: [] }); await ticked.cmds.open()
  expect(ticked.app.working()!.imports.map(i => i.trust)).toEqual(['trusted', 'sandboxed'])
  // a dialog that lies (asks for trust on a package the document made sandboxed) cannot raise it
  const lie = mk({ imports: [{ url: 'https://q/m.json', trust: 'trusted' }], code: [] }); await lie.cmds.open()
  expect(lie.app.working()!.imports[1]!.trust).toBe('sandboxed'); expect(seen[0][0]).toBe(2)
})

test('code is listed for consent; unticked it is left out of the working copy', async () => {
  const cur = doc('Now'), seen: any[] = []
  const mk = (code: string[]) => { const s = setup(cur, { open: async () => ({ app: withMap }), confirmImports: async (_a, _al, c) => { seen.push(c); return { imports: [], code } } }); s.app.save('c', cur); s.app.setName('c'); return s }
  const no = mk([]); await no.cmds.open()
  expect(seen[0]).toEqual([{ system: 'host', instance: 'm1', kind: 'map' }])
  expect(no.app.working()!.systems[0]!.instances.find(i => i.id === 'm1')).not.toHaveProperty('config')
  const yes = mk(['host/m1']); await yes.cmds.open()
  expect(yes.app.working()!.systems[0]!.instances.find(i => i.id === 'm1')!.config).toBe('return x')
})

test('Import merges without reload, passes the consent, mounts new workspaces and shows the notes', async () => {
  const s = setup(doc('Now'), { open: async () => ({ app: withMap }), confirmImports: async () => ({ imports: [], code: ['host/m1'] }) })
  await s.cmds.import()
  expect(s.log.reloads).toBe(0); expect(s.log.stopped).toBe(0); expect(s.app.working()).toBeNull()
  expect(s.log.merged[0]!.consent('host', 'm1')).toBe(true); expect(s.log.merged[0]!.consent('host', 'l1')).toBe(false)
  expect(s.log.mounted).toEqual(['/new']); expect(s.log.said[0]).toContain('note one')
})

test('Save without a name asks (Save As); Save As stores and names it; an unchanged named app is not rewritten', async () => {
  const cur = doc('Now', { title: 'Now' })
  const s = setup(cur, { askName: async () => 'mine' })
  await s.cmds.save()
  expect(s.app.name()).toBe('mine'); expect(s.app.apps().mine).toEqual(cur)
  s.app.save('mine', doc('Older')); await s.cmds.save()   // differs from the stored one: written again
  expect(s.app.apps().mine).toEqual(cur)
  const s2 = setup(cur, { askName: async () => 'x', confirm: async () => false })
  s2.app.save('x', doc('Old')); await s2.cmds['save-as']()   // exists, replace declined
  expect(s2.app.apps().x!.title).toBe('Old')
  const full = setup(cur, { askName: async () => 'y' }); full.storage.setItem = () => { throw new Error('quota') }
  await full.cmds['save-as'](); expect(full.log.said[0]).toContain('could not store'); expect(full.app.name()).toBeNull()
})

test('Download produces <name>.json that checkApp accepts', async () => {
  const s = setup(trusted); s.app.setName('my/app')
  await s.cmds.download()
  expect(s.log.downloads[0]![0]).toBe('my-app.json')
  expect(checkApp(JSON.parse(s.log.downloads[0]![1]))).toEqual(trusted)
  const t = setup(doc('A title')); await t.cmds.download(); expect(t.log.downloads[0]![0]).toBe('A title.json')
})

const src = (a: NanoApp) => (async () => new Response(JSON.stringify(a))) as unknown as typeof fetch
test('?src= keeps unsaved work as "Before opening …" (deduplicated), never overwrites a named app, applies after confirmation, and clears ?src', async () => {
  const mk = () => { const s = setup(doc('Now'), { confirmImports: async () => ({ imports: [], code: [] }) }); return s }
  const s = mk()
  s.app.setWorking(doc('Unsaved')); s.app.save('Mine', doc('Mine saved')); s.app.setName('Mine')   // working differs from the named one
  let cleared = 0
  await s.cmds.src('https://x.test/a/nano.json', 'https://h/', () => cleared++, src(trusted))
  expect(s.app.apps()['Before opening x.test/a/nano.json']!.title).toBe('Unsaved'); expect(s.app.apps().Mine!.title).toBe('Mine saved')
  expect(s.app.working()!.title).toBe('T'); expect(s.app.name()).toBeNull(); expect(cleared).toBe(1); expect(s.log.reloads).toBe(1)
  s.app.setWorking(doc('Unsaved 2'))
  await s.cmds.src('https://x.test/a/nano.json', 'https://h/', () => {}, src(trusted))
  expect(Object.keys(s.app.apps())).toEqual(['Mine', 'Before opening x.test/a/nano.json', 'Before opening x.test/a/nano.json (2)'])
  // a relative src, and the working copy of a clean named app is not duplicated
  const t = mk(); const c = doc('C'); t.app.setWorking(c); t.app.save('N', c); t.app.setName('N')
  await t.cmds.src('rel/nano.json', 'https://h/dir/', () => {}, src(trusted))
  expect(Object.keys(t.app.apps())).toEqual(['N'])
})

test('?src= declined clears the address bar and changes nothing; a bad or oversized document is an error and keeps the URL', async () => {
  const s = setup(doc('Now'), { confirmImports: async () => null })
  s.app.setWorking(doc('Unsaved')); let cleared = 0
  await s.cmds.src('https://x.test/n.json', 'https://h/', () => cleared++, src(trusted))
  expect(cleared).toBe(1); expect(s.app.working()!.title).toBe('Unsaved'); expect(s.app.apps()).toEqual({}); expect(s.log.reloads).toBe(0)
  const bad = setup(); let c2 = 0
  await bad.cmds.src('https://x.test/n.json', 'https://h/', () => c2++, (async () => new Response('{"nano":2}')) as never)
  expect(c2).toBe(0); expect(bad.log.said[0]).toContain('Could not open')
  const big = setup()
  await big.cmds.src('https://x.test/n.json', 'https://h/', () => {}, (async () => new Response('x'.repeat(1_000_001))) as never)
  expect(big.log.said[0]).toContain('1 MB')
  const js = setup(); await js.cmds.src('javascript:alert(1)', 'https://h/', () => {}); expect(js.log.said[0]).toContain('http')
})
