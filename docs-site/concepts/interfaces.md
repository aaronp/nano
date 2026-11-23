# Interfaces

An **interface** is a contract: the actions a pod answers and the events it publishes, each with the shape of its data. Code that uses a pod knows only its interface, so the pod behind it can change without that code changing.

Data shapes are **schemas**, written once and named. The template's are small:

<<< @/../templates/nano-template/src/interfaces.ts#schemas

`Entry`, a key and a value, is the one to notice: it is shared on purpose ([Wiring](/concepts/wiring) shows why).

An interface lives in a **namespace** (here `acme.template`) and lists its operations. `Op.action(input, output)` is something a caller asks for and gets an answer to; `Op.event(data)` is something the pod announces to whoever listens.

<<< @/../templates/nano-template/src/interfaces.ts#timer-interface

The `Timer` answers `start` and `stop` (both take and return nothing, written `null`) and publishes `tick` as an `Entry`: `{ key: 'tick', value: '3' }` on the third count.

**When it runs**, calls are checked against these schemas: an action called with input of the wrong shape fails before its handler runs, and an answer of the wrong shape fails too.

An operation's full name is its interface and op, `acme.template.Timer/tick`; that is how a `nano.json` refers to it.

The model's definition: `design.md` ("How it works", step 1) in the nano repository.
