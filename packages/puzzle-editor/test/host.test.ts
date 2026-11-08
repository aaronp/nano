// A smoke of the ui-workspace host page: its markup, its composable.ts, and the editor wired to the page System.
import { expect, test } from 'bun:test'
import type { Created, Op } from '@composable/sdk'
import { ConnectionEditorOps, emptyEditorDoc, type DraftComponent, type puzzleEditor } from '../src'
import { flush } from './fixtures'

const page = await Bun.file(new URL('../../ui-workspace/public/index.html', import.meta.url)).text()
const { scope } = await import('../../ui-workspace/src/composable.ts')
// after the provider exists (other test files may have defined the editor's tags already, so it upgrades on insert)
document.body.innerHTML = page.slice(page.indexOf('<body>') + 6, page.indexOf('</body>'))

test('the host page: place slider → doubler → chart on the editor\'s board, switch Live on, and it runs', async () => {
  await flush()
  const ed = scope.component('editor') as Created<typeof puzzleEditor>
  expect(ed).toBeDefined()
  const ids = ed.children.list.state.instances.map(i => i.id)
  expect(ids).toEqual(expect.arrayContaining(['system', 'orchestrator', 'c-slider', 'c-doubler', 'c-chart']))
  expect(ids).not.toContain('editor')
  expect(ids).not.toContain('host')   // the host's party: no ops, nothing to place
  const op = (name: string, suffix: string) => scope.snapshot().instances.find(i => i.id === name)!.manifest.ops.find(o => o.name.endsWith(suffix))!
  const board = ed.children.board.systems[0], at = (c: number) => ({ c, r: 0 })
  for (const [i, [name, suffix]] of [['c-slider', '/value-changed'], ['c-doubler', '/map'], ['c-chart', '/push']].entries()) {
    const r = await board.call('board', ConnectionEditorOps.place, { component: scope.snapshot().instances.find(x => x.id === name)!.manifest.id, op: op(name, suffix).name, cell: at(i) })
    expect(r.type).toBe('success')
  }
  // two sliders on the page (overview and here): pin the first piece to this one
  const wf = ed.children.board.state.connections.intents[0]!.id
  await board.call('board', ConnectionEditorOps.pin, { workflow: wf, index: 0, select: { by: 'name', name: 'c-slider' } })
  expect(ed.children.board.state.status[wf]).toMatchObject({ viable: true, routes: 2 })
  expect(JSON.parse(localStorage.getItem('ui-workspace.editor')!).connections.intents[0].id).toBe(wf)   // saved on model-updated
  expect((await board.call('board', ConnectionEditorOps.setLive, true)).type).toBe('success')
  const slider = scope.component('c-slider') as unknown as { notify(op: Op, data: unknown): Promise<unknown> }
  await slider.notify(op('c-slider', '/value-changed'), 21); await flush()
  expect((scope.component('c-chart') as unknown as { state: { points: number[] } }).state.points).toEqual([42])
})

// Restore runs whenever an `editor` is added, so a fresh <puzzle-editor name="editor"> reads what is stored now.
const KEY = 'ui-workspace.editor'
const readd = async (stored: string) => {
  const old = document.querySelector('puzzle-editor[name="editor"]')!, parent = old.parentElement!
  old.remove(); await flush()
  localStorage.setItem(KEY, stored)
  const el = document.createElement('puzzle-editor'); el.setAttribute('name', 'editor'); parent.append(el)
  for (let i = 0; i < 5; i++) await flush()
  return scope.component('editor') as Created<typeof puzzleEditor>
}

test('a saved document is loaded into the editor when it arrives', async () => {
  const draft: DraftComponent = { id: { author: 'me', id: 'geo' }, ops: [] }
  const ed = await readd(JSON.stringify({ ...emptyEditorDoc(), components: [draft] }))
  expect(ed.children.list.state.drafts).toEqual([draft])
  expect(ed.children.document.state.doc.components).toEqual([draft])
})

test('a garbage saved document is ignored and left as it is', async () => {
  for (const junk of ['not json {', JSON.stringify({ types: [] })]) {   // unparseable, then rejected by checkDoc
    const ed = await readd(junk)
    expect(ed).toBeDefined()
    expect(ed.children.document.state.doc).toEqual(emptyEditorDoc())   // the editor starts empty
    expect(localStorage.getItem(KEY)).toBe(junk)   // not replaced by an empty doc
  }
})
