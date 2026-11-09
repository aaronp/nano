// A Timer: counts while running, and publishes each new count as `tick`.
import { Type } from 'typebox'
import { component, event, state } from '@pritzlaff/nano-runes'

/** A clock you can start, stop and reset. `count` goes up by one every `interval` ms while `running`. */
export const Timer = component('nano.template/timer', () => {
  const s = state({ count: 0, running: false, interval: 1000 })
  const tick = event(Type.Number())
  // ponytail: runes doesn't tell a component it was removed, so a removed running Timer keeps its clock (its ticks
  // publish to no one); stop it before removing it, or add a removal hook to runes when that matters.
  let clock: ReturnType<typeof setInterval> | undefined
  const run = () => {
    clearInterval(clock)
    clock = s.running ? setInterval(() => { s.count += 1; tick(s.count) }, s.interval) : undefined
  }
  return {
    get count() { return s.count }, get running() { return s.running }, get interval() { return s.interval },
    tick,
    start: () => { if (!s.running) { s.running = true; run() } },
    stop: () => { s.running = false; run() },
    reset: () => { s.count = 0 },
    setInterval: (ms: number) => { s.interval = ms; run() },
  }
}, { setInterval: Type.Number({ minimum: 10, maximum: 2 ** 31 - 1 }) })   // longer delays are clamped to ~1ms by timers
