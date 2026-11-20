/**
 * What the host offers a pod to change the pages, kubectl-style: `document` gives the UIDeployment (written: its
 * coordinates as strings) and its version; `apply({ next, base })` replaces it, refused ("the pages changed since")
 * unless `base` is still the version, then asked through the host's approval. Implemented by the host, not here.
 *
 *   const host = ctx.one(HostPlatform)                 // a pod's dependency on the host's pod
 *   const at = await host.value.call.document(null)   // { doc, version }
 *   await host.value.call.apply({ next: edited(at.value.doc), base: at.value.version })
 */
import { Type } from 'typebox'
import { Coord, Op, Schema } from '@pritzlaff/nano-core'
import { Written } from './document.ts'

const ns = Coord.namespace('nano.platform')
const Nothing = Schema.define(Type.Null(), 'Nothing')
const Version = Type.Integer({ minimum: 0 })

/** The document, written, at its version. */
export const DocAt = Schema.define(Type.Object({ doc: Written, version: Version }), 'DocAt')
/** The next document, written, and the version it was made from. */
export const ApplyAt = Schema.define(Type.Object({ next: Written, base: Version }), 'ApplyAt')
export const HostPlatform = ns.interface('HostPlatform', { document: Op.action(Nothing, DocAt), apply: Op.action(ApplyAt, Nothing) })
