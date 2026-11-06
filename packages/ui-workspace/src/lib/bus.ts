/**
 * Event bus shared by the shell and everything inside it.
 *
 * - The shell *provides* a bus to its subtree (a DOM event, so it crosses shadow roots and needs no globals).
 * - A widget *requests* the bus when it first connects, keeps it, and publishes/subscribes by topic.
 */

export interface BusMessage {
  /** Increases by one per message on this bus, so order is explicit and logs are reproducible. */
  readonly seq: number;
  readonly topic: string;
  readonly payload: unknown;
  /** Who sent it (tag name or widget id). */
  readonly source: string;
}

export type Unsubscribe = () => void;

export interface Bus {
  publish(topic: string, payload: unknown, source: string): BusMessage;
  /** `pattern` is an exact topic, "prefix:*" / "prefix/*", or "*" for everything. */
  subscribe(pattern: string, fn: (m: BusMessage) => void): Unsubscribe;
  history(): readonly BusMessage[];
}

/** Does a subscription pattern match a topic? "*" matches all; "x:*" or "x/*" match a prefix. */
export const matches = (pattern: string, topic: string): boolean => {
  if (pattern === '*') return true;
  if (pattern.endsWith(':*') || pattern.endsWith('/*')) return topic.startsWith(pattern.slice(0, -1));
  return pattern === topic;
};

/** A fully initialised bus. `historyLimit` bounds memory in long sessions. */
export const createBus = (opts: { readonly historyLimit: number } = { historyLimit: 200 }): Bus => {
  if (!Number.isInteger(opts.historyLimit) || opts.historyLimit < 0) throw new Error(`bus historyLimit must be a non-negative integer, got ${opts.historyLimit}`);
  let seq = 0;
  let log: readonly BusMessage[] = [];
  const subs = new Set<{ readonly pattern: string; readonly fn: (m: BusMessage) => void }>();
  return {
    publish(topic, payload, source) {
      if (topic === '' || topic.includes('*')) throw new Error(`cannot publish to topic ${JSON.stringify(topic)}`);
      seq += 1;
      const m: BusMessage = { seq, topic, payload, source };
      log = [...log, m].slice(-opts.historyLimit);
      for (const s of [...subs]) if (matches(s.pattern, topic)) s.fn(m);
      return m;
    },
    subscribe(pattern, fn) {
      const s = { pattern, fn };
      subs.add(s);
      return () => { subs.delete(s); };
    },
    history: () => log,
  };
};

const REQUEST = 'app-bus-request';
interface BusRequestDetail { bus: Bus | null }

/** Make `host` answer bus requests from anything inside it (including slotted light DOM). */
export const provideBus = (host: HTMLElement, bus: Bus): Unsubscribe => {
  const onRequest = (e: Event) => {
    const d = (e as CustomEvent<BusRequestDetail>).detail;
    if (d.bus) return;
    d.bus = bus;
    e.stopPropagation();
  };
  host.addEventListener(REQUEST, onRequest);
  return () => host.removeEventListener(REQUEST, onRequest);
};

/** Ask the nearest enclosing shell for its bus. Throws when the element is not inside one. */
export const requestBus = (el: HTMLElement): Bus => {
  const detail: BusRequestDetail = { bus: null };
  el.dispatchEvent(new CustomEvent(REQUEST, { detail, bubbles: true, composed: true }));
  if (!detail.bus) throw new Error(`<${el.localName}> is not inside an element that provides a bus (put it inside <app-shell>)`);
  return detail.bus;
};
