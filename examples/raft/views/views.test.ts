// The Raft elements over a real 3-node cluster on the sim clock: each renders its model, each button calls its op.
import { afterEach, expect, test } from 'bun:test'
import { type Application } from '@pritzlaff/nano-core'
import type { Persistent } from '../core/types.ts'
import { ClockControl, Cluster, Ledger, RaftNode, advance, must, openRaft, glyphModel, ledgerModel, wait, mount, cluster, status } from './views-setup.ts'

let app: Application
afterEach(async () => { document.body.innerHTML = ''; await app?.close() })

test('raft-node renders its glyph from the model and follows the node', async () => {
  app = await cluster()
  const el = await mount('raft-node', app, 'example-1', 'example-1-raft')
  const s = await status(app, 'example-1'), m = glyphModel(s, 1000)
  expect(el.shadowRoot!.querySelector('text')!.textContent).toBe(String(m.term))
  expect(el.shadowRoot!.querySelectorAll('.dot')).toHaveLength(2)
  const before = el.shadowRoot!.querySelector('text')!.textContent
  await app.call('example-1', 'example-1-raft')[RaftNode.ops.timeOut.name]!(null)
  await wait(); await el.updateComplete
  expect(el.shadowRoot!.querySelector('text')!.textContent).toBe(String((await status(app, 'example-1')).p.currentTerm))
  expect(Number(el.shadowRoot!.querySelector('text')!.textContent)).toBeGreaterThan(Number(before))
})
test('a click opens the detail panel; its buttons call the node ops', async () => {
  app = await cluster()
  const el = await mount('raft-node', app, 'example-1', 'example-1-raft')
  el.shadowRoot!.querySelector('svg')!.dispatchEvent(new Event('click'))
  await el.updateComplete; await wait()
  const detail = el.shadowRoot!.querySelector('raft-detail') as HTMLElement & { updateComplete: Promise<boolean> }
  await detail.updateComplete
  expect([...detail.shadowRoot!.querySelectorAll('.rows th')].map(x => x.textContent)).toEqual(['state', 'currentTerm', 'votedFor', 'commitIndex', 'election alarm'])
  expect(detail.shadowRoot!.querySelectorAll('.peers tr')).toHaveLength(3)   // header + 2 peers
  const press = async (label: string) => { [...detail.shadowRoot!.querySelectorAll('button')].find(b => b.textContent === label)!.click(); await wait() }
  await press('stop'); expect((await status(app, 'example-1')).stopped).toBe(true)
  await press('resume'); expect((await status(app, 'example-1')).stopped).toBe(false)
  const term = (await status(app, 'example-1')).p.currentTerm
  await press('time out'); expect((await status(app, 'example-1')).p.currentTerm).toBe(term + 1)
  await press('restart'); expect((await status(app, 'example-1')).role).toBe('follower')
  await press('request')   // a follower refuses: the panel says why
  await detail.updateComplete
  expect(detail.shadowRoot!.querySelector('[role=alert]')).not.toBeNull()
})
test('raft-ledger follows the ledger as the leader takes a request', async () => {
  app = await cluster()
  const ids = ['example-1', 'example-2', 'example-3'], all = await Promise.all(ids.map(id => status(app, id)))
  const leader = all.find(n => n.role === 'leader')!.id
  const el = await mount('raft-ledger', app, leader, `${leader}-ledger`)
  expect(el.shadowRoot!.querySelectorAll('tr')).toHaveLength(1)
  must(await app.call(leader, `${leader}-raft`)[RaftNode.ops.request.name]!('hello'))
  await advance(app, 300); await wait(); await el.updateComplete
  const p = must(await app.call(leader, `${leader}-ledger`)[Ledger.ops.read.name]!(null)) as Persistent
  const m = ledgerModel(p, (await status(app, leader)).commitIndex)
  expect(m.rows).toHaveLength(1)
  expect(el.shadowRoot!.querySelector('.head')!.textContent).toBe(`currentTerm ${m.currentTerm} · votedFor ${m.votedFor ?? '—'}`)
  const tr = el.shadowRoot!.querySelectorAll('tr')
  expect(tr).toHaveLength(2)
  expect(tr[1]!.textContent).toContain('hello')
  expect(tr[1]!.className).toBe('committed')
})
test('raft-cluster creates, lists and removes a cluster through the cluster pod', async () => {
  app = await openRaft()
  const el = await mount('raft-cluster', app, 'raft', 'cluster')
  const root = el.shadowRoot!, click = async (n: string) => { (root.querySelector(`[name=${n}]`) as HTMLButtonElement).click(); await wait(); await el.updateComplete }
  expect(['name', 'size', 'seed', 'heartbeat'].map(n => root.querySelector(`[name=${n}]`)!.closest('label')?.textContent?.trim().split(/\s/)[0])).toEqual(['cluster', 'nodes', 'seed', 'heartbeat'])
  ;(root.querySelector('[name=name]') as HTMLInputElement).value = 'demo'
  await click('create')
  expect([...root.querySelectorAll('li')].map(l => l.textContent)).toEqual(['demo'])
  expect(Object.keys(app.deployment().runtimes)).toContain('demo-3')
  expect(app.deployment().pods['demo-1-raft']!.config).toMatchObject({ timing: { heartbeat: 1000, electionMin: 3000, electionMax: 6000 } })
  await click('remove')
  expect(root.querySelectorAll('li')).toHaveLength(0)
  expect(Object.keys(app.deployment().runtimes)).not.toContain('demo-1')
})
test('mounted views add only their mount reads to the recording, a small fraction of the Raft traffic', async () => {
  app = await openRaft()
  must(await app.call('raft', 'cluster')[Cluster.ops.create.name]!({ name: 'example', size: 3, seed: 1 }))
  const roots: string[] = [], raft: string[] = []
  const advancePort = `${ClockControl.coord}/${ClockControl.ops.advance.name}`
  app.listen(e => {
    if (e.type !== 'sent' || e.kind === 'subscribe' || e.kind === 'unsubscribe' || e.port === advancePort) return
    if (e.from === 'host') roots.push(e.port); else raft.push(e.port)
  })
  for (const id of ['example-1', 'example-2', 'example-3']) { await mount('raft-node', app, id, `${id}-raft`); await mount('raft-ledger', app, id, `${id}-ledger`) }
  await advance(app, 2000)
  console.log(`2 sim s, 6 views: ${raft.length} raft messages, ${roots.length} view roots`)
  expect(roots.length).toBeLessThanOrEqual(4 * 6)   // each view reads at most twice at mount, then hears; none per advance
  expect(roots.length * 10).toBeLessThan(raft.length)
})
test('an idle peer dot is faint, a pending one hollow and bright, a granted one filled', async () => {
  app = await cluster()
  const el = await mount('raft-node', app, 'example-1', 'example-1-raft')
  const dot = el.shadowRoot!.querySelector('.dot')!
  expect(dot.getAttribute('stroke-opacity')).toBe(dot.classList.contains('idle') ? '0.2' : '1')
  expect(dot.getAttribute('fill')).toBe(dot.classList.contains('granted') ? dot.getAttribute('stroke') : 'none')
})
