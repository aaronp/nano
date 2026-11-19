// A time-machine frame's in-flight messages as dots on the Desk's cords: each at its progress along its message's cord,
// a call from caller to callee. A message with no cord on this Desk (the host's, a hidden pod) draws no dot.
import { svg } from 'lit'
import type { Frame, Message, TimeMachine } from '@pritzlaff/nano-ui'
import { bezierAt } from '../wires/geometry'
import type { DeskLayout, Sized } from './arrange'
import { cordOf } from './cords'
import type { DeskModel } from './model'

type Arranged = { runtimes: Record<string, Sized>; columns: Record<string, Record<string, Sized>> }

export const renderDots = (m: DeskModel, a: Arranged, l: DeskLayout, f: Frame | undefined, pick: (m: Message) => void) => (f?.inFlight ?? []).flatMap(({ message, progress }) => {
  const cause = message.sent.cause === undefined ? undefined : f!.recent.find(r => r.sent.id === message.sent.cause)?.sent
  const cord = cordOf(m, a, l, message.sent, cause)
  if (!cord) return []
  const [x, y] = bezierAt(cord, progress)
  return [svg`<circle data-dot=${message.sent.id} cx=${x} cy=${y} r="6" fill="#F5B73B" stroke="#0B0E12" stroke-width="2" @click=${() => pick(message)}></circle>`]
})

/** Follows a time machine; it emits on change, not on subscribe, so re-enter its mode for the current frame. */
export function follow(tm: TimeMachine | undefined, on: (f: Frame) => void) {
  const off = tm?.subscribe(on)
  if (tm?.mode === 'live') tm.live(); else if (tm?.mode === 'paused') tm.pause()
  return off
}

// ponytail: causes are looked up in the frame's recent messages only; the Messages page reads the whole store
/** A message's causes, nearest first. */
export function causes(f: Frame | undefined, m: Message | undefined) {
  const by = new Map((f?.recent ?? []).map(r => [r.sent.id, r])), out: Message[] = []
  for (let c = m?.sent.cause; c !== undefined && out.length < 100; ) { const x = by.get(c); if (!x) break; out.push(x); c = x.sent.cause }
  return out
}
