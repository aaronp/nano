// HostOutline in the workspace: the pod `platform` over the Platform. `document` is unasked; `apply` with a stale base
// is refused before anyone is asked, with the current base it is asked (naming the pages and slots), then applied.
import { expect, jest, test } from 'bun:test'
import { flat } from './flat.ts'
import { Application, AppDeployment, Coord, Pod, Registry, type NanoResult } from '@pritzlaff/nano-core'
import { Outline } from '@pritzlaff/nano-outline'
import './host-deploy-setup.ts'

const { hostPlatform, platformPod } = await import('../src/host-platform-pod.ts')
const { hostProvider } = await import('../src/host-deploy.ts')
const { hostUi } = await import('../src/host-ui.ts')

type Written = { roots?: string[]; pages: Record<string, { slots: Record<string, unknown>; meta?: unknown }> }
type PodApi = { document(n: null): Promise<NanoResult<{ doc: Written; version: number }>>; apply(a: { next: Written; base: number }): Promise<NanoResult<unknown>> }
const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const ns = Coord.namespace('workspace.host')

async function podApp(answer: () => Promise<boolean>) {
  const asked: string[] = [], registry = Registry.create()
  let platform: ReturnType<typeof Outline.create> | undefined
  registry.add(ns.provider([hostPlatform(() => platform, t => { asked.push(t); return answer() })]))
  const d: AppDeployment = { pods: { platform: platformPod }, runtimes: { main: { pods: ['platform'], subscriptions: [] } } }
  const app = must(await Application.create(must(AppDeployment.assemble(d, registry))))
  platform = Outline.create(app, registry, flat({ workspace: { slots: { x: { kind: 'view', view: 'nano-explorer' } } } }))
  return { asked, app, platform, pod: app.call('main', 'platform') as unknown as PodApi }
}

test('document is the pages, written, at their version, unasked', async () => {
  const { asked, app, pod } = await podApp(async () => true)
  expect(must(await pod.document(null))).toEqual({ doc: { roots: ['workspace'], pages: { workspace: { slots: { x: { kind: 'view', view: 'nano-explorer' } } } } }, version: 0 })
  expect(asked).toEqual([])
  await app.close()
})

test('apply with a stale base is refused, unasked; with the current base it is asked, a no changes nothing, a yes applies', async () => {
  let yes = false
  const { asked, app, platform, pod } = await podApp(async () => yes)
  const at = must(await pod.document(null)), next: Written = { pages: { ...at.doc.pages, notes: { slots: { n: { kind: 'view', view: 'notes' } } } } }
  platform.apply(flat({ ...platform.document().doc.pages, other: { slots: {} } }))   // the workspace's own edit, since
  expect(await pod.apply({ next, base: at.version })).toMatchObject({ ok: false, fail: { type: 'invalid-input', reason: 'the pages changed since' } })
  expect(asked).toEqual([])
  const now = must(await pod.document(null)), again: Written = { pages: { ...now.doc.pages, notes: { slots: { n: { kind: 'view', view: 'notes' } } }, workspace: { slots: {} } } }
  expect(await pod.apply({ next: again, base: now.version })).toMatchObject({ ok: false, fail: { type: 'denied' } })
  expect(asked).toEqual(['Add page notes; page workspace: remove slot x'])
  expect(Object.keys(platform.document().doc.pages)).toEqual(['workspace', 'other'])
  yes = true
  expect(await pod.apply({ next: again, base: now.version })).toMatchObject({ ok: true })
  expect(Object.keys(platform.document().doc.pages)).toEqual(['workspace', 'other', 'notes'])
  expect(await pod.apply({ next: { pages: { 'bad id': { slots: {} } } }, base: platform.document().version })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  await app.close()
})

test('removing Main or adding a page on one of the workspace\'s own routes is refused, unasked', async () => {
  const { asked, app, platform, pod } = await podApp(async () => true)
  expect(await pod.apply({ next: { pages: { other: { slots: {} } } }, base: 0 })).toMatchObject({ ok: false, fail: { type: 'invalid-input', reason: 'Main (the page workspace) is not removed' } })
  for (const id of ['ring', 'settings', 'inbox'])
    expect(await pod.apply({ next: { pages: { workspace: { slots: {} }, [id]: { slots: {} } } }, base: 0 })).toMatchObject({ ok: false, fail: { type: 'invalid-input', reason: `${id} is the workspace's own route, not a page` } })
  expect(asked).toEqual([])
  expect(Object.keys(platform.document().doc.pages)).toEqual(['workspace'])
  await app.close()
})

test('the pages changing while the approval waits: the yes is refused, as stale', async () => {
  let platform: ReturnType<typeof Outline.create> | undefined
  const { app, platform: p, pod } = await podApp(async () => { platform!.apply(flat({ ...platform!.document().doc.pages, mine: { slots: {} } })); return true })
  platform = p
  expect(await pod.apply({ next: { pages: { workspace: { slots: {} }, theirs: { slots: {} } } }, base: 0 })).toMatchObject({ ok: false, fail: { type: 'invalid-input', reason: 'the pages changed since' } })
  expect(Object.keys(p.document().doc.pages)).toEqual(['workspace', 'mine'])
  await app.close()
})

test('through hostProvider, the ask is the ui pod\'s dialog, and no answer within 20 s is a no', async () => {
  const registry = Registry.create()
  let app: Application | undefined, platform: ReturnType<typeof Outline.create> | undefined
  registry.add(hostProvider(() => app!, () => platform))
  const d: AppDeployment = { pods: { ui: Pod.eager(hostUi), platform: platformPod }, runtimes: { main: { pods: ['ui', 'platform'], subscriptions: [] } } }
  app = must(await Application.create(must(AppDeployment.assemble(d, registry))))
  platform = Outline.create(app, registry)
  jest.useFakeTimers()
  try {
    const r = (app.call('main', 'platform') as unknown as PodApi).apply({ next: { pages: { workspace: { slots: {} }, trading: { slots: {} } } }, base: 0 })
    for (let i = 0; i < 50 && !document.querySelector('dialog'); i++) { await Promise.resolve(); jest.advanceTimersByTime(1) }
    expect(document.querySelector('dialog')?.textContent).toContain('Add page trading')
    jest.advanceTimersByTime(20_000)
    expect(await r).toMatchObject({ ok: false, fail: { type: 'denied' } })
  } finally { jest.useRealTimers() }
  expect(platform.document().doc.pages).toEqual({})   // created empty; nothing applied
  document.querySelector('dialog')?.remove()
  await app.close()
})

test('without a Platform (a replayed app\'s provider), both are not-found', async () => {
  const registry = Registry.create()
  registry.add(ns.provider([hostPlatform(() => undefined, async () => true)]))
  const app = must(await Application.create(must(AppDeployment.assemble({ pods: { platform: platformPod }, runtimes: { main: { pods: ['platform'], subscriptions: [] } } }, registry))))
  const pod = app.call('main', 'platform') as unknown as PodApi
  expect(await pod.document(null)).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  await app.close()
})
