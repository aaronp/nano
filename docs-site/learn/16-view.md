# A view

A pod has no screen of its own. A **view** is a custom element over one pod: it reaches the pod through the same Application any other caller uses, so the pod stays testable without a page and the view works in any host. From here on the code is the template's, `templates/nano-template`.

A host hands the view a `target`: `{ app, registry, runtime, pod }`, the Application and which pod to show. The template's views share a small base:

<<< @/../templates/nano-template/src/view.ts#view

- `pod(t)` is the pod's client, `t.app.call(runtime, pod)`.
- `started(t)` runs once the view has a target and is on the page; `hear(e, t)` sees each message of the Application meanwhile (`t.app.listen`).
- `face(t)` is what the view draws.

`<nano-calculator>` draws two numbers, an operator, `=`, the result and the history:

<<< @/../templates/nano-template/src/calculator-view.ts#calculator-view

`=` calls `calculate` on its pod and shows the result, or the failure's reason.

**Styles.** `static styles = [base, kit]` takes `@pritzlaff/nano-elements`' classes (`.row`, `.btn`, `.input`, `.badge`, `.alert`), whose colours, fonts and radius come from `--nano-*` CSS variables, with defaults when a page sets none. A host's theme sets them, so the view takes on the theme it is shown in.

**Which view a pod gets.** The module exports `views`, from implementation to tag, and defines the tag when it is imported:

<<< @/../templates/nano-template/src/index.ts#views

A host shows each pod in its implementation's view; a pod with none gets a generic one, showing its interfaces and ops.

## What happens when it runs

The template's test mounts `<nano-calculator>` on runtime `main`'s `calculator`: typing 2, `+`, 3 and clicking `=` shows `5`, and the history lists `2 + 3 = 5` (the view reads the history again on each `calculated`, see [a view that listens to its pod's events](/recipes/listening-view)). `1 / 0` shows `division by zero`.

Next, [in the host](/learn/17-host): importing it and placing it.
