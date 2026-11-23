# A view that listens to its pod's events

A view can listen to its own pod's events directly, with nothing in the `nano.json`. The template's calculator view reads the history again each time its pod calculates.

The calculator's interface has the event `calculated` ([events](/learn/07-events)):

<<< @/../templates/nano-template/src/interfaces.ts#calculator-interface

The calculator publishes each result as `calculated`:

<<< @/../templates/nano-template/src/calculator.ts#calculator

The view gets its pod through the `Calculator` interface and iterates `calculated()`: each value is one calculation ([a view](/learn/16-view)):

<<< @/../templates/nano-template/src/calculator-view.ts#calculator-listen

- `get(Calculator, { pod: t.pod })` gives that pod's typed client; an event is a method that returns an async iterable.
- `load` asks the one `History` pod in the view's runtime; with none, the list is empty.
- `end()` stops the iteration when the view leaves the page or gets a new target, so a closed view stops listening. If the pod goes away, the loop ends.

**When it runs:** open the calculator's panel and calculate: the history list grows by one. It grows too when something else calls the same pod, as the template's view test does with `app.call('main', 'calculator').calculate(…)`. In a Sandboxed import the view reaches only its own pod, so the list stays empty, while the pipe still saves.

<OpenInNano src="examples/template/nano.json"/>
