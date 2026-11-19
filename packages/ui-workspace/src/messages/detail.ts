// The detail of one message: its input and result (or denial), timing, and the chain of causes that led to it.
import { html } from 'lit'
import type { Message } from '@pritzlaff/nano-ui'

const label = (m: Message) => `${m.sent.from} → ${m.sent.to}/${m.sent.port}`

/** `chain` is the message's causes, nearest first; `seek` moves the time machine to one. */
export function renderDetail(m: Message, chain: Message[], seek: (m: Message) => void) {
  const o = m.outcome
  return html`<section data-detail>
    <h3>${label(m)} <small>${m.sent.kind}, id ${m.sent.id}</small></h3>
    <h4>Input</h4><pre>${m.sent.input ?? '(none)'}</pre>
    <h4>${o?.type === 'denied' ? 'Denied' : 'Result'}</h4>
    <pre>${!o ? '(pending)' : o.type === 'denied' ? o.reason : o.result}</pre>
    ${o?.type === 'delivered' ? html`<p>${o.ok ? 'ok' : 'failed'}, ${o.ms} ms</p>` : ''}
    <h4>Caused by</h4>
    ${chain.length ? html`<ol>${chain.map(c => html`<li><button data-cause @click=${() => seek(c)}>${label(c)}</button></li>`)}</ol>` : html`<p>(nothing: a root message)</p>`}
  </section>`
}
