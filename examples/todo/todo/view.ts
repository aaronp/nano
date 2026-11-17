// `<todo-list>`: the todo example's view, a Lit element over one `example.todo/kv` pod, reached through `target.app`.
import { LitElement, html } from 'lit'
import { base, kit } from '@pritzlaff/nano-elements'
import type { ViewTarget } from '@pritzlaff/nano-ui'
import { TodoListDef } from './contract.ts'

export class TodoListView extends LitElement {
  static properties = { target: { attribute: false }, todos: { state: true } }
  static styles = [base, kit]
  declare target?: ViewTarget
  declare todos: TodoListDef.Todo[]
  private watching?: ViewTarget
  private live = false
  constructor() { super(); this.todos = [] }

  connectedCallback() { super.connectedCallback(); this.live = true; void this.watch() }
  disconnectedCallback() { super.disconnectedCallback(); this.live = false; this.watching = undefined }
  willUpdate(changed: Map<string, unknown>) { if (changed.has('target')) void this.watch() }

  private pod(t: ViewTarget) { return t.app.runtime(t.runtime).get(TodoListDef.api, { pod: t.pod }) }
  private async watch() {
    const t = this.target
    if (!t || !this.live || this.watching === t) return
    this.watching = t
    const list = this.pod(t), events = list.items()[Symbol.asyncIterator]()   // connected before the first list, so no change is missed
    try {
      this.todos = await list.list()
      while (this.live && this.watching === t && !(await events.next()).done) this.todos = await list.list()
    } finally { void events.return?.() }
  }
  private async add(t: ViewTarget, input: HTMLInputElement) {
    const title = input.value.trim()
    if (!title) return
    input.value = ''
    await this.pod(t).add(title)
  }
  render() {
    const t = this.target
    if (!t) return html``
    const list = this.pod(t)
    return html`<form @submit=${(e: Event) => { e.preventDefault(); void this.add(t, this.renderRoot.querySelector('input')!) }}>
        <input class="input" aria-label="New todo" placeholder="What needs doing?"><button class="btn" type="submit">Add</button></form>
      <ul>${this.todos.map(d => html`<li>
        <input type="checkbox" aria-label="Done: ${d.title}" .checked=${d.done} @change=${(e: Event) => list.update({ id: d.id, done: (e.target as HTMLInputElement).checked })}>
        <span>${d.title}</span>
        <button class="btn small" aria-label="Remove ${d.title}" @click=${() => list.remove(d.id)}>×</button></li>`)}</ul>`
  }
}
