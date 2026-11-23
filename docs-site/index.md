---
layout: home
hero:
  name: nano
  tagline: Small units of behaviour, wired by their interfaces.
  actions:
    - theme: brand
      text: Concepts
      link: /concepts/interfaces
    - theme: alt
      text: Recipes
      link: /recipes/timer
---

# At a glance

The whole template, one timer, on a screen. A timer counts and publishes each count.

An **interface** is what a pod offers: actions it answers and events it publishes ([Interfaces](/concepts/interfaces)).

<<< @/../templates/nano-template/src/interfaces.ts#timer-interface

An **implementation** provides an interface; a pod is one running instance of it ([Implementations](/concepts/implementations), [Pods](/concepts/pods)).

<<< @/../templates/nano-template/src/timer.ts#timer-implementation

A **view** is a custom element that talks to its pod through the same interface ([Views](/concepts/views)).

<<< @/../templates/nano-template/src/timer-view.ts#timer-view

The **nano.json** declares the pods, the runtime that holds them, and the pipes wiring an event to an action ([Wiring](/concepts/wiring), [Packaging](/concepts/packaging)).

<<< @/../templates/nano-template/nano.json

<OpenInNano src="examples/template/nano.json"/>
