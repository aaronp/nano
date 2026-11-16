/**
 * The todo list contract. `TodoListDef.TodoList` is the plain TypeScript interface, derived from `api`.
 *
 *   const todos: TodoListDef.TodoList = app.get(TodoListDef.api)
 *   const t = await todos.add('milk'); await todos.update({ id: t.id, done: true })
 */
import { Type, type Static } from 'typebox'
import { Coord, Interface, Op, Schema } from '@pritzlaff/nano-core'

export namespace TodoListDef {
  export const ns = Coord.namespace('example.todo')

  export const Todo = Schema.define('Todo', Type.Object({ id: Type.String(), title: Type.String(), done: Type.Boolean() }))
  export type Todo = Static<typeof Todo.schema>
  export const Change = Schema.define('Change', Type.Object({ id: Type.String(), title: Type.Optional(Type.String()), done: Type.Optional(Type.Boolean()) }))
  export type Change = Static<typeof Change.schema>

  export const api = Interface.define(ns.interface('TodoList'), {
    add: Op.action('add', Type.String(), Todo),
    list: Op.action('list', Type.Null(), Type.Array(Todo.schema)),
    /** The changed todo, or `null` if there is none with that id. */
    update: Op.action('update', Change, Type.Union([Todo.schema, Type.Null()])),
    /** Whether there was one to remove. */
    remove: Op.action('remove', Type.String(), Type.Boolean()),
  })
  export type TodoList = Interface.Type<typeof api>
  export const impls = { kv: ns.implementation('kv') }
}
