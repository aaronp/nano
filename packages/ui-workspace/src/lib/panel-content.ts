// A panel's content: its template's elements, upgraded, with its placed elements in the dock's system.
import { PlacedElement } from '@pritzlaff/nano-elements'
import { SandboxedElement } from '../sandbox/sandboxed-el.ts'

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
  for (const e of root.querySelectorAll('*')) if (e instanceof PlacedElement || e instanceof SandboxedElement) e.registry = registry as PlacedElement['registry'];
}

/** Shows the panel's instance sandboxed: a non-host `mode` replaces the template's element with <c-sandboxed keep kind mode name>
 * (a template that is already a <c-sandboxed> just takes the mode). Host or no mode leaves the content as it is. */
export function withMode(content: DocumentFragment, kind: string, mode: string | undefined, name?: string): DocumentFragment {
  const first = content.firstElementChild;
  if (!mode || mode === 'host' || !first) return content;
  const sb = first.localName === 'c-sandboxed' ? first : first.ownerDocument.createElement('c-sandboxed');
  sb.setAttribute('keep', ''); sb.setAttribute('kind', kind); sb.setAttribute('mode', mode);
  if (name) sb.setAttribute('name', name);
  if (sb !== first) first.replaceWith(sb);
  return content;
}
