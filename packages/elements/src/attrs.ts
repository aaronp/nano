// Sets an element's attributes from a record (undefined removes one; names that aren't valid are skipped), dropping those a previous call set that this one doesn't.
const was = new WeakMap<Element, string[]>()
export function setAttrs(el: Element | undefined, all: Record<string, string | undefined> = {}) {
  if (!el) return
  const attrs = Object.fromEntries(Object.entries(all).filter(([k]) => /^[a-z][a-z0-9-]*$/.test(k)))   // an invalid name would throw inside the render
  for (const k of was.get(el) ?? []) if (!(k in attrs)) el.removeAttribute(k)
  for (const [k, v] of Object.entries(attrs)) v === undefined ? el.removeAttribute(k) : el.setAttribute(k, v)
  was.set(el, Object.keys(attrs))
}
