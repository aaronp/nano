// The todo example's module: its provider (default export) and its view, by implementation.
import { TodoListView } from './todo/view.ts'

export { default } from './todo/kv.ts'
export const views = { 'example.todo/kv': 'todo-list' }

if (!customElements.get('todo-list')) customElements.define('todo-list', TodoListView)
