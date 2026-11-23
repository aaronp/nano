# Pods and deployments

A **pod** is one named instance of an implementation, written as data: which implementation, its config, and whether it is built at once (`"eager": true`) or the first time something calls it (`"eager": false`). Writing the system as data means it can be saved, shared and loaded without running any of your code first.

A **runtime** places pods together and says how they are wired. The whole description, pods plus runtimes, is the **deployment**, and `nano.json` is that deployment:

<<< @/../templates/nano-template/nano.json

- `pods` names three pods, one per implementation. All are lazy: nothing is built until it is used.
- `runtimes.main` places all three together and lists its `subscriptions`, the wiring ([Wiring](/concepts/wiring)).
- `modules` tells a host where to load the `acme.template` provider's code from.

**When it runs:** loading the deployment checks it first (every implementation exists, every config fits its schema, every wire's ends are placed and fit), and only then creates the **application**, the one live thing. A pod is built when first called, once; calling `start` on `main`'s `timer` builds the timer and starts it.

<OpenInNano src="examples/template/nano.json"/>

The model's definition: `docs/superpowers/specs/2026-11-14-pods-runtimes-application-design.md` ("The idea" and "Data") in the nano repository.
