/**
 * One slot as its page last opened it: a pod through its view (the host document's `host.views` override, else its implementation's
 * default tag, else nano-pod-view), a `tool` slot as "<tool>: not available here", a `missing` slot as "not found"
 * with Remove, a pod that would not start with its reason.
 */
import { useEffect, useRef } from 'react'
import { viewFor, type ViewMap, type ViewTarget } from '@pritzlaff/nano-ui'
import type { Host } from '@pritzlaff/nano-host'

export type Opened = Awaited<ReturnType<Host['outline']['open']>>[string]

function PodView({ h, views, runtime, pod }: { h: Host; views: ViewMap; runtime: string; pod: string }) {
  // The override is the host document's `host.views`; viewFor reads it as `deployment.views` until plan 5.
  const at = useRef<HTMLDivElement>(null), tag = viewFor(pod, { ...h.app.deployment(), views: h.document().host?.views ?? {} }, views)
  useEffect(() => {
    const target: ViewTarget = { app: h.app, registry: h.registry, runtime, pod }
    const el = Object.assign(document.createElement(tag), { target })
    at.current?.replaceChildren(el)
    return () => el.remove()
  }, [h, tag, runtime, pod])
  return <div className="view" ref={at} />
}

export function SlotCell({ h, views, id, opened, remove }: { h: Host; views: ViewMap; id: string; opened: Opened | undefined; remove(): void }) {
  const body = !opened ? <p className="note">opening…</p>
    : 'fail' in opened ? <p className="note bad" role="status">{opened.fail.reason}</p>
    : 'pod' in opened ? <PodView h={h} views={views} runtime={opened.pod.runtime.id} pod={opened.pod.pod} />
    : opened.kind === 'tool' ? <p className="note">{opened.tool}: not available here</p>
    : <p className="note bad" role="status">{id}: not found <button type="button" onClick={remove} aria-label={`Remove slot ${id}`}>Remove</button></p>
  return (
    <section className="slot" aria-label={id}>
      <header><span>{id}</span><button type="button" onClick={remove} aria-label={`Remove slot ${id}`} title="Remove">✕</button></header>
      {body}
    </section>
  )
}
