// A panel's content: its template's elements, upgraded, with its placed elements in the dock's system.
import { PlacedElement } from '@pritzlaff/nano-elements'

/**
 * A panel's content from its template. Importing it into the page upgrades defined elements at once; only then are
 * placed elements handed the dock's registry. (A property set before an upgrade is held back by Lit until after
 * the element has placed its component, in the page's registry.)
 */
export function panelContent(doc: Document, template: HTMLTemplateElement, registry?: unknown): DocumentFragment {
  const content = doc.importNode(template.content, true);
  for (const e of content.querySelectorAll('*')) if (e.localName.includes('-')) customElements.upgrade(e);   // browsers already have
  if (registry) handRegistry(content, registry);
  return content;
}

/** Hands `registry` to the placed elements under `root`. Other model views (such as the platform's tree) keep the
 * page's registry, where the platform lives. */
export function handRegistry(root: ParentNode, registry: unknown) {
  for (const e of root.querySelectorAll('*')) if (e instanceof PlacedElement) e.registry = registry as PlacedElement['registry'];
}
