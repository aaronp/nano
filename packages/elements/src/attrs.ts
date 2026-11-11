// Sets an element's attributes from a record (undefined removes one), dropping those a previous call set that this one doesn't.
const was = new WeakMap<Element, string[]>()
export function setAttrs(el: Element | undefined, attrs: Record<string, string | undefined> = {}) {
  if (!el) return
  for (const k of was.get(el) ?? []) if (!(k in attrs)) el.removeAttribute(k)
  for (const [k, v] of Object.entries(attrs)) v === undefined ? el.removeAttribute(k) : el.setAttribute(k, v)
  was.set(el, Object.keys(attrs))
}
