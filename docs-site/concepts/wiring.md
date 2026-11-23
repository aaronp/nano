# Wiring

Pods don't reach for each other in their code. The deployment wires them, so the same pods can be connected differently without changing them. A wire is a **subscription**, and there are two kinds.

## Pipes

A **pipe** sends one pod's event into another pod's action. The picker publishes `changed` when you pick:

<<< @/../templates/nano-template/src/picker.ts#picker-pick

The store's `set` takes a key and a value:

<<< @/../templates/nano-template/src/store.ts#store-set

Neither knows the other. The `nano.json` connects them:

```json
{ "kind": "pipe", "from": "picker", "source": "acme.template.Picker/changed", "to": "store", "target": "acme.template.Store/set" }
```

A pipe is allowed only when the source's data and the target's input are the same schema (or the target takes anything). Here both are `Entry`, the schema the interfaces share on purpose:

<<< @/../templates/nano-template/src/interfaces.ts#picker-store-interfaces

The timer's `tick` is an `Entry` too, so the second pipe in the template sends each count to the same `store.set`.

**When it runs:** picking `green` stores `choice` = `green`; a running timer keeps `tick` in the store at its latest count, and stopping it stops the updates. A pick outside the options fails, publishes nothing, and so stores nothing.

## Call edges

A **call edge** (`{ "kind": "call", "from": "app", "to": "db" }`) lets one pod's code call another's actions. The pod's code asks for an interface it depends on, and the edge decides which pod answers, so pointing the edge elsewhere swaps the pod without touching the code.

The template has no call edge: its three pods only publish and answer, and pipes connect them.

The model's definition: `docs/superpowers/specs/2026-11-14-pods-runtimes-application-design.md` ("Two kinds of subscription, both designed") in the nano repository.
