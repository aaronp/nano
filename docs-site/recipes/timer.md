# A view that hears its own pod

A view can listen to its pod's events directly, with no wiring in the `nano.json`. The template's timer view counts ticks this way.

The timer's interface has a `tick` event ([Interfaces](/concepts/interfaces)):

<<< @/../templates/nano-template/src/interfaces.ts#timer-interface

The timer publishes each count as `tick` ([Implementations](/concepts/implementations)):

<<< @/../templates/nano-template/src/timer.ts#timer-implementation

The view gets its pod through the `Timer` interface and iterates `tick()`: each value is one tick ([Views](/concepts/views)):

<<< @/../templates/nano-template/src/timer-view.ts#timer-tick

- `get(Timer, { pod })` gives the pod's interface as plain methods; an event is a method that returns an async iterable.
- `end()` stops the iteration when the view leaves the page, so a closed view stops listening.
- If the pod goes away, the loop ends and the count keeps its last value.

**When it runs:** open the timer pod's panel and press Start: the count climbs with each tick, even with the template's pipes removed, since the view needs none.

<OpenInNano src="examples/template/nano.json"/>
