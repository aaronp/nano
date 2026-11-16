/**
 * A todo list: CRUD domain operations written as plain TypeScript over any `KeyValueStore`, each todo at
 * `['todos', id]`. In nano, `example.todo/kv` reaches its store only through its call edge.
 *
 *   const todos = todoList(inMemory()); const t = await todos.add('milk'); await todos.update({ id: t.id, done: true })
 */
import { Type } from 'typebox'
import { defineSchema, iface, implementation, op, provide, provider } from '@pritzlaff/nano-core'
import { KeyValueStore } from './kv.ts'
import { handlers, plain } from './plain.ts'

export type Todo = { id: string; title: string; done: boolean }
export type Change = { id: string; title?: string; done?: boolean }

export interface TodoList {
  add(title: string): Promise<Todo>
  list(): Promise<Todo[]>
  /** The changed todo, or `null` if there is none with that id. */
  update(c: Change): Promise<Todo | null>
  /** Whether there was one to remove. */
  remove(id: string): Promise<boolean>
}

const Id = defineSchema('Id', Type.String())
const TodoS = defineSchema('Todo', Type.Object({ id: Type.String(), title: Type.String(), done: Type.Boolean() }))
const ChangeS = defineSchema('Change', Type.Object({ id: Type.String(), title: Type.Optional(Type.String()), done: Type.Optional(Type.Boolean()) }))

export const TodoList = iface('example.todo.TodoList', {
  add: op.action('add', defineSchema('Title', Type.String()), TodoS),
  list: op.action('list', defineSchema('Nothing', Type.Null()), defineSchema('Todos', Type.Array(TodoS.schema))),
  update: op.action('update', ChangeS, defineSchema('MaybeTodo', Type.Union([TodoS.schema, Type.Null()]))),
  remove: op.action('remove', Id, defineSchema('Removed', Type.Boolean())),
})

const at = (id: string) => ['todos', id]

export function todoList(store: KeyValueStore, newId: () => string = () => crypto.randomUUID()): TodoList {
  return {
    async add(title) { const t = { id: newId(), title, done: false }; await store.put({ key: at(t.id), value: t }); return t },
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

const kvTodos = implementation('example.todo/kv', {
  provides: [TodoList],
  dependencies: { store: KeyValueStore },
  description: 'Todos kept in whichever KeyValueStore its call edge reaches.',
  make: ctx => [provide(TodoList, handlers(TodoList, todoList(plain<KeyValueStore>(() => ctx.one(KeyValueStore).call))))],
})

export default provider('example.todo', [kvTodos])
