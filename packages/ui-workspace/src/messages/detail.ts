// The detail of one message: its input and result (or denial), timing, and the chain of causes that led to it.
import { html } from 'lit'
import type { Message } from '@pritzlaff/nano-ui'

const label = (m: Message) => m.sent.port === undefined ? `${m.sent.from} → ${m.sent.to} (${m.sent.kind})` : `${m.sent.from} → ${m.sent.to}/${m.sent.port}`   // a start has no port

/** `chain` is the message's causes, nearest first; `seek` moves the time machine to one. */
export function renderDetail(m: Message, chain: Message[], seek: (m: Message) => void, onClose?: () => void) {
  const o = m.outcome, last = chain.at(-1) ?? m
  return html`<section data-detail>
    <h3>${label(m)} <small>${m.sent.kind}, id ${m.sent.id}</small>${onClose ? html` <button data-close aria-label="Close" @click=${(e: Event) => { e.stopPropagation(); onClose() }}>&times;</button>` : ''}</h3>
    <h4>Input</h4><pre>${m.sent.input ?? '(none)'}</pre>
    <h4>${o?.type === 'denied' ? 'Denied' : 'Result'}</h4>
    <pre>${!o ? '(pending)' : o.type === 'denied' ? o.reason : o.result}</pre>
    ${o?.type === 'delivered' ? html`<p>${o.ok ? 'ok' : 'failed'}, ${o.ms.toFixed(1)} ms</p>` : ''}
    <h4>Caused by</h4>
    ${chain.length ? html`<ol>${chain.map(c => html`<li><button data-cause @click=${() => seek(c)}>${label(c)}</button></li>`)}</ol>` : ''}
    ${last.sent.cause !== undefined ? html`<p>(earlier causes no longer in the history)</p>` : !chain.length ? html`<p>${m.sent.from === 'host' ? '(root message)' : '(cause not recorded)'}</p>` : ''}
  </section>`
}
