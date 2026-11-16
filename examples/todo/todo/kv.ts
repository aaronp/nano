/**
 * A todo list over any key/value store, each todo at `['todos', id]`: plain TypeScript. In nano, `example.todo/kv`
 * reaches its store only through its call edge, as `deps.store`.
 *
 *   const todos = todoList(inMemory()); const t = await todos.add('milk')
 */
import { Provider } from '@pritzlaff/nano-core'
import { KeyValueStoreDef } from '../kv/contract.ts'
import { TodoListDef } from './contract.ts'

type Todo = TodoListDef.Todo
const at = (id: string) => ['todos', id]

export function todoList(store: KeyValueStoreDef.KeyValueStore, newId: () => string = () => crypto.randomUUID()): TodoListDef.TodoList {
  return {
    async add(title) { const t = { id: newId(), title, done: false }; await store.put({ key: at(t.id), value: t }); return t },
    // A cast: the store holds Json, and only this list writes under ['todos'], always a Todo.
    async list() { return (await store.list({ prefix: ['todos'] })).map(e => e.value as Todo) },
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

/** Todos kept in whichever KeyValueStore its call edge reaches. */
const todos = TodoListDef.api.impl(TodoListDef.ns.implementation('kv'))
  .needs({ store: KeyValueStoreDef.api })
  .make(({ deps }) => todoList(deps.store))

export default Provider.define(TodoListDef.ns, [todos])
