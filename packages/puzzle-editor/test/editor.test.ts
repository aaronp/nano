import { expect, test } from 'bun:test'
import { Components, Systems, unwrap, type Instance } from '@composable/sdk'
import type { Status } from '@composable/connections'
import { ComponentListOps, ConnectionEditorOps, DocumentOps, TypeEditorOps, emptyEditorDoc, liveTypes, puzzleEditor, type EditorDoc, type EditorType } from '../src'
import { crm, flush, mapper, rate, tax, toJ, updated } from './fixtures'

const editorIn = async () => {
  const s = Systems.create(), page = unwrap(s.register('page', Components.party()))
  const ed = await puzzleEditor.create(); unwrap(s.register('editor', ed))
  const inner = (c: keyof typeof ed.children) => ed.children[c].systems[0]
  return { s, page, ed, inner }
}

test('the editor is a System: load in, edits flow between children, model-updated out, insides hidden', async () => {
  const { page, ed, inner } = await editorIn()
  const docs: EditorDoc[] = []
  page.subscribe(DocumentOps.modelUpdated, d => { docs.push(d) }, { from: 'editor' })
  expect(page.system.instances.map(i => i.id)).toEqual(['page', 'editor'])
  expect((await page.call('editor', DocumentOps.load, emptyEditorDoc())).type).toBe('success')
  await inner('types').call('types', TypeEditorOps.addRecord, { id: 'a', name: 'Address' })
  expect(ed.children.list.state.types.map((t: EditorType) => t.id)).toContain('a')   // routed types-updated → set-types
  expect(docs.at(-1)!.types.map(t => t.id)).toContain('a')
})

test('load rejects a malformed doc and keeps state', async () => {
  const { page, ed } = await editorIn()
  await page.call('editor', DocumentOps.load, emptyEditorDoc())
  const before = JSON.stringify(ed.children.types.state.types)
  expect(await page.call('editor', DocumentOps.load, { types: [] } as never)).toMatchObject({ type: 'error', error: { code: 'validation' } })
  expect(JSON.stringify(ed.children.types.state.types)).toBe(before)
})

test('set-instances is linked once and reaches both children; status is planned locally', async () => {
  const { s, ed } = await editorIn()
  unwrap(s.register('system', Systems.component(s).create() as never))
  unwrap(s.subscribe({ source: 'system', op: Systems.ops.changed.name, listener: 'editor', target: ComponentListOps.setInstances.name }))
  for (const [n, f] of [['crm', crm], ['map', mapper], ['tax', tax]] as const) unwrap(s.register(n, f.create()))
  await flush()
  expect(ed.children.board.state.instances.map((i: Instance) => i.id)).toContain('map')
  await ed.children.board.systems[0].call('board', ConnectionEditorOps.place, { component: { author: 't', id: 'crm' }, op: updated.name, cell: { c: 0, r: 0 } })
  await ed.children.board.systems[0].call('board', ConnectionEditorOps.place, { component: { author: 't', id: 'map' }, op: toJ.name, cell: { c: 1, r: 0 } })
  await ed.children.board.systems[0].call('board', ConnectionEditorOps.place, { component: { author: 't', id: 'tax' }, op: rate.name, cell: { c: 2, r: 0 } })
  expect(Object.values(ed.children.board.state.status as Record<string, Status>)[0]).toMatchObject({ viable: true, routes: 2 })
})

test('Live gates intents-updated; switching off sends []', async () => {
  const { page, ed } = await editorIn()
  const sent: unknown[][] = []
  page.subscribe(ConnectionEditorOps.intentsUpdated, i => { sent.push(i) }, { from: 'editor' })
  const board = ed.children.board.systems[0]
  await board.call('board', ConnectionEditorOps.place, { component: { author: 't', id: 'crm' }, op: updated.name, cell: { c: 0, r: 0 } })
  expect(sent).toEqual([])
  await page.call('editor', ConnectionEditorOps.setLive, true)
  await board.call('board', ConnectionEditorOps.place, { component: { author: 't', id: 'tax' }, op: rate.name, cell: { c: 2, r: 0 } })
  expect(sent.length).toBe(2)                                      // on switching on, and after the edit
  await page.call('editor', ConnectionEditorOps.setLive, true)    // already on: nothing resent
  expect(sent.length).toBe(2)
  await page.call('editor', ConnectionEditorOps.setLive, false)
  expect(sent.at(-1)).toEqual([])
  await page.call('editor', ConnectionEditorOps.setLive, false)   // already off: no second []
  expect(sent.length).toBe(3)
})

test('live types: each distinct named schema once, by SAID, and they reach the type editor read-only', async () => {
  const inst = (id: string, f: { manifest: Instance['manifest'] }) => ({ id, manifest: f.manifest })
  // Address appears on crm and map, Jurisdiction on map and tax: two live types
  expect(liveTypes([inst('crm', crm), inst('map', mapper), inst('tax', tax)]).map(t => t.kind === 'live' && (t.schema as { $id?: string }).$id)).toEqual(['geo.Address', 'geo.Jurisdiction'])
  const { page, ed } = await editorIn()
  await page.call('editor', ComponentListOps.setInstances, [inst('crm', crm), inst('map', mapper)])
  expect(ed.children.types.state.types.filter((t: EditorType) => t.kind === 'live').length).toBe(2)
})

test('draft edits reach model-updated through drafts-updated; a failed edit changes nothing', async () => {
  const { page, ed, inner } = await editorIn()
  const docs: EditorDoc[] = []
  page.subscribe(DocumentOps.modelUpdated, d => { docs.push(d) }, { from: 'editor' })
  const id = { author: 'me', id: 'geo' }
  expect((await inner('list').call('list', ComponentListOps.addDraft, { id })).type).toBe('success')
  expect(docs.at(-1)!.components).toEqual([{ id, ops: [] }])
  const n = docs.length
  expect(await inner('list').call('list', ComponentListOps.addDraft, { id })).toMatchObject({ type: 'error', error: { code: 'validation' } })
  expect(docs.length).toBe(n)
  expect(ed.children.list.state.drafts).toEqual([{ id, ops: [] }])
})

const crmAt = (c: number) => ({ component: { author: 't', id: 'crm' }, op: updated.name, cell: { c, r: 0 } })
const modelOut = (page: Awaited<ReturnType<typeof editorIn>>['page']) => {
  const docs: EditorDoc[] = []
  page.subscribe(DocumentOps.modelUpdated, d => { docs.push(d) }, { from: 'editor' })
  return docs
}

test('each load publishes the whole doc exactly once', async () => {
  const { page } = await editorIn()
  const docs = modelOut(page)
  const full: EditorDoc = {
    ...emptyEditorDoc(),
    components: [{ id: { author: 'me', id: 'geo' }, ops: [{ name: 'go', input: { type: 'string', array: false } }] }],
    connections: { intents: [{ kind: 'workflow', id: 'w', steps: [{ select: { by: 'any' }, op: 'x' }] }], layout: { w: { c: 0, r: 0 } } },
  }
  expect((await page.call('editor', DocumentOps.load, full)).type).toBe('success'); await flush()
  expect(docs).toEqual([full])
  expect((await page.call('editor', DocumentOps.load, emptyEditorDoc())).type).toBe('success'); await flush()
  expect(docs).toEqual([full, emptyEditorDoc()])
})

test('model-updated only when the saved doc changes: a new instance outside sends nothing', async () => {
  const { s, page } = await editorIn()
  unwrap(s.register('system', Systems.component(s).create() as never))
  unwrap(s.subscribe({ source: 'system', op: Systems.ops.changed.name, listener: 'editor', target: ComponentListOps.setInstances.name }))
  await page.call('editor', DocumentOps.load, emptyEditorDoc()); await flush()
  const docs = modelOut(page)
  unwrap(s.register('map', mapper.create())); await flush()
  expect(docs).toEqual([])
})

test('a rejected board edit fails, changes nothing and sends no intents', async () => {
  const { page, ed } = await editorIn()
  const sent: unknown[][] = []
  page.subscribe(ConnectionEditorOps.intentsUpdated, i => { sent.push(i) }, { from: 'editor' })
  const board = ed.children.board.systems[0]
  await board.call('board', ConnectionEditorOps.place, crmAt(0))
  await page.call('editor', ConnectionEditorOps.setLive, true)
  const before = JSON.stringify(ed.children.board.state.connections), n = sent.length
  expect(await board.call('board', ConnectionEditorOps.place, crmAt(0))).toMatchObject({ type: 'error', error: { code: 'validation', message: 'place rejected' } })
  await flush()
  expect(sent.length).toBe(n)
  expect(JSON.stringify(ed.children.board.state.connections)).toBe(before)
})

test('the insides are hidden: a child op that is not exposed is unknown on the editor', async () => {
  const { page } = await editorIn()
  expect(await page.call('editor', TypeEditorOps.addRecord, { id: 'a', name: 'A' })).toMatchObject({ type: 'error', error: { code: 'unknown-action' } })
})

test('a failed type edit returns its error and publishes nothing', async () => {
  const { page, inner } = await editorIn()
  await page.call('editor', DocumentOps.load, emptyEditorDoc())
  await inner('types').call('types', TypeEditorOps.addRecord, { id: 'a', name: 'A' })
  await inner('types').call('types', TypeEditorOps.addField, { record: 'a', name: 's', ref: { type: 'string', array: false } })
  await flush()
  const docs = modelOut(page)
  expect(await inner('types').call('types', TypeEditorOps.remove, { id: 'string' })).toMatchObject({ type: 'error', error: { code: 'validation' } })
  await flush()
  expect(docs).toEqual([])
})
