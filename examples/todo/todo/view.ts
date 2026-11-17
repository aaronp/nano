// `<todo-list>`: the todo example's view, a Lit element over one `example.todo/kv` pod, reached through `target.app`.
import { LitElement, html } from 'lit'
import { base, kit } from '@pritzlaff/nano-elements'
import type { ViewTarget } from '@pritzlaff/nano-ui'
import { TodoListDef } from './contract.ts'

export class TodoListView extends LitElement {
  static properties = { target: { attribute: false }, todos: { state: true }, error: { state: true } }
  static styles = [base, kit]
  declare target?: ViewTarget
  declare todos: TodoListDef.Todo[]
  declare error?: string
  private watching?: ViewTarget
  private iter?: AsyncIterator<unknown>

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
    const list = this.pod(t), it = this.iter = list.items()[Symbol.asyncIterator]()   // connected before the first list, so no change is missed
    try {
      this.todos = await list.list()
      while (!(await it.next()).done && this.iter === it) this.todos = await list.list()
    } catch (e) { this.error = String(e) }
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
    return html`${this.error ? html`<p role="alert">${this.error}</p>` : ''}<form @submit=${(e: Event) => { e.preventDefault(); void this.add(t, this.renderRoot.querySelector('input')!) }}>
        <input class="input" aria-label="New todo" placeholder="What needs doing?"><button class="btn" type="submit">Add</button></form>
      <ul>${this.todos.map(d => html`<li>
        <input type="checkbox" aria-label="Done: ${d.title}" .checked=${d.done} @change=${(e: Event) => this.run(list.update({ id: d.id, done: (e.target as HTMLInputElement).checked }))}>
        <span>${d.title}</span>
        <button class="btn small" aria-label="Remove ${d.title}" @click=${() => this.run(list.remove(d.id))}>×</button></li>`)}</ul>`
  }
}
