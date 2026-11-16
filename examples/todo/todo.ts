/**
 * A todo list: CRUD domain operations written as plain TypeScript over any `KeyValueStore`, each todo at
 * `['todos', id]`. In nano, `example.todo/kv` reaches its store only through its call edge.
 *
 *   const todos = todoList(inMemory()); const t = await todos.add('milk'); await todos.update({ id: t.id, done: true })
 */
import { Type, type Static } from 'typebox'
import { Schema, Interface, Implementation, Op, provide, Provider } from '@pritzlaff/nano-core'
import { KeyValueStore } from './kv.ts'
import { handlers, plain, type Matches } from './plain.ts'

// Each schema once; its TypeScript type is derived from it, under the same name.
export const Todo = Schema.define('Todo', Type.Object({ id: Type.String(), title: Type.String(), done: Type.Boolean() }))
export type Todo = Static<typeof Todo.schema>
export const Change = Schema.define('Change', Type.Object({ id: Type.String(), title: Type.Optional(Type.String()), done: Type.Optional(Type.Boolean()) }))
export type Change = Static<typeof Change.schema>

export interface TodoList {
  add(title: string): Promise<Todo>
  list(): Promise<Todo[]>
  /** The changed todo, or `null` if there is none with that id. */
  update(c: Change): Promise<Todo | null>
  /** Whether there was one to remove. */
  remove(id: string): Promise<boolean>
}

export const TodoList = Interface.define('example.todo.TodoList', {
  add: Op.action('add', Schema.define('Title', Type.String()), Todo),
  list: Op.action('list', Schema.define('Nothing', Type.Null()), Schema.define('Todos', Type.Array(Todo.schema))),
  update: Op.action('update', Change, Schema.define('MaybeTodo', Type.Union([Todo.schema, Type.Null()]))),
  remove: Op.action('remove', Schema.define('Id', Type.String()), Schema.define('Removed', Type.Boolean())),
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

const kvTodos = Implementation.define('example.todo/kv', {
  provides: [TodoList],
  dependencies: { store: KeyValueStore },
  description: 'Todos kept in whichever KeyValueStore its call edge reaches.',
  make: ctx => [provide(TodoList, handlers(TodoList, todoList(ctx.deps.store)))],
})

export default Provider.define('example.todo', [kvTodos])

true satisfies Matches<TodoList, typeof TodoList>
