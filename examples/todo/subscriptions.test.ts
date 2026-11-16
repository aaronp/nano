/**
 * Subscribing is a message, in the todo case study. A consumer of `items()` (the host in `frontend`) and the `todos`
 * pod hearing its store's puts (in `backend`) each connect by a `subscribe` message and end by an `unsubscribe`, both
 * on the stream of the runtime they travel in. A refusal is `denied` there, and the consumer's loop throws it.
 */
import { expect, test } from 'bun:test'
import { Application, AppDeployment, Registry, type AppEvent, type NanoResult, type Policy } from '@pritzlaff/nano-core'
import kv from './kv/memory.ts'
import { TodoListDef } from './todo/contract.ts'
import todo from './todo/kv.ts'

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const saved = async (): Promise<AppDeployment> => Bun.file(new URL('./nano.json', import.meta.url)).json()

async function open(policies: Record<string, Policy> = {}) {
  const registry = Registry.create()
  for (const p of [kv, todo]) must(registry.add(p))
  return must(await Application.create(must(AppDeployment.assemble(await saved(), registry)), { policies }))
}

/** Each runtime's stream, as `kind from→to: outcome` per subscribe/unsubscribe message. */
function subscriptions(app: Awaited<ReturnType<typeof open>>, runtime: string) {
  const lines: string[] = [], open = new Map<string, string>()
  app.runtime(runtime).listen((e: AppEvent) => {
    if (e.type === 'sent' && (e.kind === 'subscribe' || e.kind === 'unsubscribe')) open.set(e.id, `${e.kind} ${e.from}→${e.to}`)
    if ((e.type === 'delivered' || e.type === 'denied') && open.has(e.id))
      lines.push(`${open.get(e.id)}: ${e.type === 'denied' ? `denied ${e.reason}` : e.result.ok ? 'ok' : `${e.result.fail.type}`}`)
  })
  return lines
}

const deny = (when: () => boolean): Policy => ({ isAllowed: (_f, _t, d) => d === 'subscribe' && when() ? { approved: false, reason: 'not now' } : { approved: true } })

test('iterating items() is a subscribe message on frontend\'s stream; break is the unsubscribe', async () => {
  const app = await open()
  const front = subscriptions(app, 'frontend')
  const todos = app.runtime('frontend').get(TodoListDef.api)
  const it = todos.items()[Symbol.asyncIterator]()
  const first = it.next()
  await Bun.sleep(0)
  await todos.add('milk')
  expect(await first).toMatchObject({ value: { title: 'milk' } })
  await it.return!()
  expect(front).toEqual(['subscribe host→todos: ok', 'unsubscribe host→todos: ok'])
})

test('the todos pod\'s own subscription to the store\'s puts travels in backend, never on frontend\'s stream', async () => {
  const app = await open()
  const front = subscriptions(app, 'frontend'), back = subscriptions(app, 'backend')
  const todos = app.runtime('frontend').get(TodoListDef.api)
  await todos.add('milk')   // builds todos; its items() source subscribes to the store
  await Bun.sleep(0)
  expect(back).toEqual(['subscribe todos→store: ok'])
  expect(front).toEqual([])
})

test('a refused subscription is denied on frontend\'s stream, and the consumer\'s loop throws it', async () => {
  const app = await open({ frontend: deny(() => true) })
  const front = subscriptions(app, 'frontend')
  const loop = async () => { for await (const _ of app.runtime('frontend').get(TodoListDef.api).items()); }
  await expect(loop()).rejects.toMatchObject({ fail: { type: 'denied', reason: 'not now' } })
  expect(front).toEqual(['subscribe host→todos: denied not now'])
})

test('a policy that stops allowing it ends a live subscription on the next apply: unsubscribe carries denied, the loop throws', async () => {
  let closed = false
  const app = await open({ frontend: deny(() => closed) })
  const front = subscriptions(app, 'frontend')
  const todos = app.runtime('frontend').get(TodoListDef.api)
  const seen: string[] = []
  const loop = (async () => { for await (const t of todos.items()) seen.push(t.title) })()
  await Bun.sleep(0)
  await todos.add('milk')
  closed = true
  must(await app.apply(app.deployment()))   // the 'subscribe' question is asked again on apply
  await expect(loop).rejects.toMatchObject({ fail: { type: 'denied' } })
  expect(seen).toEqual(['milk'])
  expect(front).toEqual(['subscribe host→todos: ok', 'unsubscribe host→todos: denied'])
})

test('apply removing the store\'s call edge ends the todos pod\'s subscription: backend shows the unsubscribe', async () => {
  const app = await open()
  const back = subscriptions(app, 'backend')
  await app.runtime('frontend').get(TodoListDef.api).list()   // builds todos
  await Bun.sleep(0)
  const next = app.deployment()
  next.runtimes.backend!.subscriptions = []
  must(await app.apply(next))
  expect(back).toEqual(['subscribe todos→store: ok', 'unsubscribe todos→store: ok'])
})
