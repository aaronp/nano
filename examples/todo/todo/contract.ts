/**
 * The todo list contract. `TodoListDef.TodoList` is the plain TypeScript interface, derived from `api`.
 *
 *   const todos: TodoListDef.TodoList = app.runtime('example.todo.frontend').get(TodoListDef.api)
 *   const t = await todos.add('milk'); await todos.update({ id: t.id, done: true })
 */
import { Type, type Static } from 'typebox'
import { Coord, Interface, Op, Schema } from '@pritzlaff/nano-core'

export namespace TodoListDef {
  export const ns = Coord.namespace('example.todo')

  export const Todo = Schema.define(Type.Object({ id: Type.String(), title: Type.String(), done: Type.Boolean() }))
  export type Todo = Static<typeof Todo>
  export const Change = Schema.define(Type.Object({ id: Type.String(), title: Type.Optional(Type.String()), done: Type.Optional(Type.Boolean()) }))
  export type Change = Static<typeof Change>

  export const api = ns.interface('TodoList', {
    add: Op.action(Type.String(), Todo),
    list: Op.action(Type.Null(), Type.Array(Todo)),
    /** The changed todo, or `null` if there is none with that id. */
    update: Op.action(Change, Type.Union([Todo, Type.Null()])),
    /** Adds or replaces this todo by id, as given: a second list fed from the first. */
    put: Op.action(Todo, Todo),
    /** Whether there was one to remove. */
    remove: Op.action(Type.String(), Type.Boolean()),
    /** Each todo as it is saved to the store, added or changed. */
    items: Op.event(Todo),
  })
  export type TodoList = Interface.Type<typeof api>
}
