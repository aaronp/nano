/**
 * A todo list over any key/value store, each todo at `['todos', id]`: plain TypeScript. In nano, `example.todo/kv`
 * reaches its store only through its call edge, as `deps.store`.
 *
 *   const todos = todoList(inMemory()); const t = await todos.add('milk')
 */
import { Implementation } from '@pritzlaff/nano-core'
import { KeyValueStoreDef } from '../../kv/contract.ts'
import { TodoListDef } from './contract.ts'

type Todo = TodoListDef.Todo
const at = (id: string) => ['todos', id]

/** Ids that sort in the order they were made (the store lists by key): the time, a counter for the same millisecond,
 * then randomness so two lists never collide. */
let seq = 0
export const orderedId = () => `${Date.now().toString(36).padStart(9, '0')}${(seq++ % 1679616).toString(36).padStart(4, '0')}-${crypto.randomUUID().slice(0, 8)}`

export function todoList(store: KeyValueStoreDef.KeyValueStore, newId: () => string = orderedId): Omit<TodoListDef.TodoList, 'items'> {
  return {
    async add(title) { const t = { id: newId(), title, done: false }; await store.put({ key: at(t.id), value: t }); return t },
    // A cast: the store holds Json, and only this list writes under ['todos'], always a Todo.
    async list() { return (await store.list({ prefix: ['todos'] })).map(e => e.value as Todo) },
    async put(t) { await store.put({ key: at(t.id), value: t }); return t },
    async update(c) {
      const t = await store.get(at(c.id)) as Todo | null
      if (!t) return null
      const next = { ...t, ...(c.title !== undefined && { title: c.title }), ...(c.done !== undefined && { done: c.done }) }
      await store.put({ key: at(c.id), value: next })
      return next
    },
    async remove(id) {
      if (await store.get(at(id)) === null) return false
      await store.delete(at(id))
      return true
    },
  }
}

// `Implementation.define`, not the builder: it declares `calls`. Each call builds `todoList` over its invocation's store.
// The refresh timer lists through the factory's ctx: a call from the pod, not from an op (undeclared, `source: null`).
const todos = Implementation.define(TodoListDef.ns.implementationId('kv'), {
  provides: [TodoListDef.api],
  description: 'Todos kept in whichever KeyValueStore its call edge reaches.',
  dependencies: { store: KeyValueStoreDef.api },
  calls: { add: ['store.put'], list: ['store.list'], put: ['store.put'], update: ['store.get', 'store.put'], remove: ['store.get', 'store.delete'] },
  make: ctx => {
    const timer = setInterval(() => { ctx.deps.store.list({ prefix: ['todos'] }).catch(() => {}) }, 1000)
    ctx.addOnCloseListener(() => clearInterval(timer))
    const over = (c?: typeof ctx) => todoList((c ?? ctx).deps.store)
    return {
      add: (title, c) => over(c).add(title),
      list: (_, c) => over(c).list(),
      put: (t, c) => over(c).put(t),
      update: (ch, c) => over(c).update(ch),
      remove: (id, c) => over(c).remove(id),
      async *items() {
        const s = ctx.one(KeyValueStoreDef.api)
        if (s.ok) for await (const { input } of s.value.on(KeyValueStoreDef.api.ops.put)) if (input.key[0] === 'todos') yield input.value as Todo
      },
    }
  },
})

export default TodoListDef.ns.provider([todos])
