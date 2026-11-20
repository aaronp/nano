/**
 * One slot as its page last opened it: a pod through its view (the deployment's selector, else its implementation's
 * default tag, else nano-pod-view), a client's `view` slot as "not available here", a `missing` slot as "not found"
 * with Remove, a pod that would not start with its reason.
 */
import { useEffect, useRef } from 'react'
import { viewFor, type ViewTarget } from '@pritzlaff/nano-ui'
import type { Platform } from '@pritzlaff/nano-platform'
import type { Host } from './boot.ts'

export type Opened = Awaited<ReturnType<ReturnType<typeof Platform.create>['open']>>[string]

function PodView({ h, runtime, pod }: { h: Host; runtime: string; pod: string }) {
  const at = useRef<HTMLDivElement>(null), tag = viewFor(pod, h.saved(), h.views)
  useEffect(() => {
    const target: ViewTarget = { app: h.app, registry: h.registry, runtime, pod }
    const el = Object.assign(document.createElement(tag), { target })
    at.current?.replaceChildren(el)
    return () => el.remove()
  }, [h, tag, runtime, pod])
  return <div className="view" ref={at} />
}

export function SlotCell({ h, id, opened, remove }: { h: Host; id: string; opened: Opened | undefined; remove(): void }) {
  const body = !opened ? <p className="note">opening…</p>
    : 'fail' in opened ? <p className="note bad" role="status">{opened.fail.reason}</p>
    : 'pod' in opened ? <PodView h={h} runtime={opened.pod.runtime.id} pod={opened.pod.pod} />
    : opened.kind === 'view' ? <p className="note">{opened.view}: not available here</p>
    : <p className="note bad" role="status">{id}: not found <button type="button" onClick={remove} aria-label={`Remove slot ${id}`}>Remove</button></p>
  return (
    <section className="slot" aria-label={id}>
      <header><span>{id}</span><button type="button" onClick={remove} aria-label={`Remove slot ${id}`} title="Remove">✕</button></header>
      {body}
    </section>
  )
}
