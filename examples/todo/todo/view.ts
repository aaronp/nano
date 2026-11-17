// `<todo-list>`: the todo example's view, a Lit element over one `example.todo/kv` pod, reached through `target.app`.
import { LitElement, css, html } from 'lit'
import { base, kit } from '@pritzlaff/nano-elements'
import type { ViewTarget } from '@pritzlaff/nano-ui'
import { TodoListDef } from './contract.ts'

export class TodoListView extends LitElement {
  static properties = { target: { attribute: false }, todos: { state: true }, error: { state: true } }
  static styles = [base, kit, css`ul { list-style: none; margin: 0; padding: 0 } li > span { flex: 1 } [role='alert'] { margin: 0 }`]
  declare target?: ViewTarget
  declare todos: TodoListDef.Todo[]
  declare error?: string
  private watching?: ViewTarget
  private iter?: AsyncIterator<unknown>
  constructor() { super(); this.todos = [] }

  connectedCallback() { super.connectedCallback(); void this.watch() }
  disconnectedCallback() { super.disconnectedCallback(); this.stop() }
  willUpdate(changed: Map<string, unknown>) { if (changed.has('target')) void this.watch() }
  private stop() { void this.iter?.return?.(); this.iter = this.watching = undefined }

  private pod(t: ViewTarget) { return t.app.runtime(t.runtime).get(TodoListDef.api, { pod: t.pod }) }
  private async watch() {
    const t = this.target
    if (!t || !this.isConnected || this.watching === t) return
    this.stop()
    this.watching = t
    this.error = undefined
    const list = this.pod(t), it = this.iter = list.items()[Symbol.asyncIterator]()   // connected before the first list, so no change is missed
    try {
      const first = await list.list()
      if (this.iter !== it) return
      this.todos = first
      while (!(await it.next()).done && this.iter === it) {
        const next = await list.list()
        if (this.iter === it) this.todos = next
      }
    } catch (e) { if (this.iter === it) this.error = String(e) }
  }
  private async add(t: ViewTarget, input: HTMLInputElement) {
    const title = input.value.trim()
    if (!title) return
    input.value = ''
    await this.pod(t).add(title).catch(e => { this.error = String(e) })
  }
  private run(p: Promise<unknown>) { p.catch(e => { this.error = String(e) }) }
  render() {
    const t = this.target
    if (!t) return html``
    const list = this.pod(t)
    return html`<div class="col">${this.error ? html`<p class="alert bad" role="alert">${this.error}</p>` : ''}<div class="row">
        <input class="input" aria-label="New todo" placeholder="What needs doing?" @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter' && !e.isComposing) void this.add(t, e.target as HTMLInputElement) }}><button class="btn" type="button" @click=${() => void this.add(t, this.renderRoot.querySelector('input')!)}>Add</button></div>
      <ul>${this.todos.map(d => html`<li class="list-row">
        <input type="checkbox" aria-label="Done: ${d.title}" .checked=${d.done} @change=${(e: Event) => this.run(list.update({ id: d.id, done: (e.target as HTMLInputElement).checked }))}>
        <span>${d.title}</span>
        <button class="btn small" aria-label="Remove ${d.title}" @click=${() => this.run(list.remove(d.id))}>×</button></li>`)}</ul></div>`
  }
}
