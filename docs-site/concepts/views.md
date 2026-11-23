# Views

A pod has no screen of its own. A **view** is a custom element that shows one pod and talks to it through the same interface any other caller uses, so the pod stays testable without a page and the view works in any host.

A host hands the view a `target`: the application, the registry, and which runtime and pod it is for. The template's views share a small base that does the rest:

<<< @/../templates/nano-template/src/view.ts#view

- `pod(t)` is the pod's client, `t.app.call(runtime, pod)`: the view calls actions like any caller.
- `hear(e, t)` sees each message of the application while the view is on the page (`t.app.listen`).
- `face(t)` is what the view draws.

`<nano-timer>` draws Start, Stop and a count:

<<< @/../templates/nano-template/src/timer-view.ts#timer-view

It counts the ticks itself, by subscribing to its own pod's `tick` through the `Timer` interface while it is on the page. It doesn't need the pipe to the store, so a timer with no pipes counts too:

<<< @/../templates/nano-template/src/timer-view.ts#timer-tick

**Which view a pod gets:** the module exports `views`, a map from implementation to tag (`'acme.template/timer': 'nano-timer'`), and defines the tags when it is imported. A host shows each pod in its implementation's view, or, when there is none, in a generic one showing its interfaces, their ops and the calls to each.

## Styles and themes

A view can be any custom element, styled however you like. The template's views take `base` and `kit` from `@pritzlaff/nano-elements` (`static styles = [base, kit]`): buttons, badges, tables and rows (`.btn`, `.badge`, `.row`) that read their colours, fonts and radius from `--nano-*` CSS variables, with defaults when a page sets none. A host's theme sets those variables (the nano app's theme picker does), so the same view takes on the theme it is shown in. A view with styles of its own follows the theme only where its CSS reads the `--nano-*` variables.

**When it runs:** in the app, open the timer pod's panel and press Start: the count climbs; Stop ends it.

<OpenInNano src="examples/template/nano.json"/>

The model's definition: `design.md` ("Views and layout") in the nano repository.
