// What the Messages page and the Desk share about the page's time machine and recording.
import { pair, type Frame, type Message, type MessageStore, type TimeMachine } from '@pritzlaff/nano-ui'

/** Follows a time machine; it emits on change, not on subscribe, so re-enter its mode for the current frame. */
export function follow(tm: TimeMachine | undefined, on: (f: Frame) => void) {
  const off = tm?.subscribe(on)
  if (tm?.mode === 'live') tm.live(); else if (tm?.mode === 'paused') tm.pause()
  return off
}

/** A message's causes, nearest first. */
export async function causeChain(store: MessageStore | undefined, m: Message): Promise<Message[]> {
  // ponytail: the causes are looked up by reading the whole store; an index if the recording gets large
  const all = new Map(pair(await store?.range() ?? []).map(x => [x.sent.id, x]))
  const chain: Message[] = []
  for (let c = m.sent.cause; c !== undefined && chain.length < 100; ) { const x = all.get(c); if (!x) break; chain.push(x); c = x.sent.cause }
  return chain
}
