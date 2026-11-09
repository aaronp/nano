# @pritzlaff/nano-elements

Lit elements over `@pritzlaff/nano-core` components.

- **`ModelElement`:** shows and drives one model. Give it a `registry` and a `model` (an instance id), and
  optionally a `watch` list of more instances whose sources it reads. It joins the registry as a hidden
  subscriber of each, re-renders when they publish, and calls the model's actions through its own handle:
  `this.read(op)` gives the latest value, and `this.act(op, arg)` calls an action, keeping a refusal in
  `this.problem`.
- **`PlacedElement`:** a ModelElement that brings its own component (`static component`).
  - **On the page,** it shows the instance named by its `name` attribute, in the registry provided for the
    document. If no instance has that name, it creates one and removes it when the element goes.
  - **Moving it** (as a dock does) keeps the instance.
  - **Without a `name`,** it gets a generated one.
- **`provide(document, registry)`:** sets the registry that placed elements use.
- **`base`:** the shared styles (the puzzle prototype's palette).
