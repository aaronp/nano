/**
 * A headless platform host, in the todo case study. The host is just another nano component: an implementation of a
 * `PlatformHost` contract, placed in `frontend` like any pod. Two routes reach it, and neither is a special case:
 * - **A pod, on purpose**, declares the host as a dependency and calls it (`deps.host.notify(...)`): a call edge,
 *   policed and on the stream like any call.
 * - **nano's own failures** (here a `todos` whose `items()` source throws) are `failure` events on the stream. The
 *   platform (whoever holds `app`) listens and hands them to the host component through its interface.
 * (`PlatformHost` is defined here as a test fixture, not a published contract.)
 */
import { expect, test } from 'bun:test'
import { Type } from 'typebox'
import { Application, AppDeployment, Coord, Op, Registry, type NanoResult } from '@pritzlaff/nano-core'
import kv from './kv/memory.ts'
import { KeyValueStoreDef } from './kv/contract.ts'
import { TodoListDef } from './todo/contract.ts'
import { todoList } from './todo/kv.ts'

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }

const ns = Coord.namespace('example.platform')
const PlatformHost = ns.interface('PlatformHost', {
  notify: Op.action(Type.String(), Type.Null()),
  raiseError: Op.action(Type.Object({ pod: Type.String(), reason: Type.String() }), Type.Null()),
})
const Reminder = ns.interface('Reminder', { remind: Op.action(Type.String(), Type.Null()) })

/** What the headless host showed: a UI host would render these instead. */
const shown = { notices: [] as string[], errors: [] as { pod: string; reason: string }[] }
const host = PlatformHost.impl(ns.implementationId('headless')).make(() => ({
  async notify(text) { shown.notices.push(text) },
  async raiseError(e) { shown.errors.push(e) },
}))
/** A pod that raises a notification on purpose: through its dependency, like any call. */
const reminder = Reminder.impl(ns.implementationId('reminder')).needs({ host: PlatformHost })
  .make(({ deps }) => ({ async remind(text) { await deps.host.notify(`reminder: ${text}`) } }))
/** A todo list whose `items()` source fails once it starts. */
const broken = TodoListDef.api.impl(ns.implementationId('broken-todos')).needs({ store: KeyValueStoreDef.api })
  .make(({ deps }) => ({ ...todoList(deps.store), async *items() { throw new Error('feed lost') } }))

async function open() {
  shown.notices = []; shown.errors = []
  const registry = Registry.create()
  for (const p of [kv, ns.provider([host, reminder, broken])]) must(registry.add(p))
  const d: AppDeployment = {
    pods: {
      host: { implementation: 'example.platform/headless', eager: true },
      reminder: { implementation: 'example.platform/reminder', eager: false },
      todos: { implementation: 'example.platform/broken-todos', eager: false },
      store: { implementation: 'example.kv/memory', eager: false },
    },
    runtimes: {
      frontend: { pods: ['host', 'reminder', 'todos'], subscriptions: [{ kind: 'call', from: 'reminder', to: 'host' }] },
      backend: { pods: ['store', 'todos'], subscriptions: [{ kind: 'call', from: 'todos', to: 'store' }] },
    },
  }
  const app = must(await Application.create(must(AppDeployment.assemble(d, registry))))
  // The platform: it holds `app`, so it is the operator. It hands nano's failures to the host component.
  const platformHost = app.runtime('frontend').get(PlatformHost)
  app.listen(e => { if (e.type === 'failure' && e.pod) void platformHost.raiseError({ pod: e.pod, reason: e.reason }) })
  return app
}

test('a pod notifies through the host component, a dependency like any other: a call on frontend\'s stream', async () => {
  const app = await open()
  const calls: string[] = []
  app.runtime('frontend').listen(e => { if (e.type === 'sent' && e.kind === 'call') calls.push(`${e.from}→${e.to} ${e.port.split('/').pop()}`) })
  await app.runtime('frontend').get(Reminder).remind('buy milk')
  expect(shown.notices).toEqual(['reminder: buy milk'])
  expect(calls).toEqual(['host→reminder remind', 'reminder→host notify'])
})

test('a source that throws is a failure on the stream, which the platform raises through the host component', async () => {
  const app = await open()
  const todos = app.runtime('frontend').get(TodoListDef.api)
  await todos.add('milk')   // builds todos; its items() source starts and throws
  await Bun.sleep(0)
  expect(shown.errors).toEqual([{ pod: 'todos', reason: 'items threw feed lost' }])
  expect((await todos.list()).map(t => t.title)).toEqual(['milk'])   // its actions keep working
})
