/**
 * The host on nano-core 0.4, started before the elements are defined (where composable.ts was): the one Application
 * (host.ts), nano-ui's views, and a palette template per implementation the host can make, before the dock's
 * hand-written ones, so the docks and the components drawer list them when they upgrade. An import that registers
 * new providers adds their templates to every dock, and drawers hear `catalog:changed`.
 */
import { defineViews } from '@pritzlaff/nano-ui';
import { toast } from '@pritzlaff/nano-elements';
import { start, type Host } from './host.ts';
import { implementationTemplates } from './dock/panels.ts';

defineViews();
const started = await start();
if (!started.ok) toast(started.fail.reason, { variant: 'bad', duration: 0 });
/** The page's host; undefined if it did not start (a toast says why). */
export const host: Host | undefined = started.ok ? started.value : undefined;

if (host) {
  const known = new Set<string>();
  const add = (initial: boolean) => {
    const fresh = implementationTemplates(host, document).filter((t) => !known.has(t.dataset['widget']!));
    if (!fresh.length) return;
    for (const t of fresh) known.add(t.dataset['widget']!);
    for (const dock of document.querySelectorAll<HTMLElement & { addTemplate?(t: HTMLTemplateElement): void }>('workspace-dock')) for (const t of fresh) {
      const copy = t.cloneNode(true) as HTMLTemplateElement;
      if (dock.addTemplate) dock.addTemplate(copy);   // defined: read now
      else dock.prepend(copy);   // not yet defined: read when it connects, before the hand-written ones
    }
    if (!initial) document.dispatchEvent(new CustomEvent('catalog:changed', { detail: { name: fresh[0]!.dataset['package'] } }));
  };
  add(true);
  host.app.listen((e) => { if (e.type === 'applied') add(false); });
}
