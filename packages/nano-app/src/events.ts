/** The set of open server-sent-event streams: `subscribe` for the server, `tell` for the watcher. A closed stream drops out. */
export function events() {
  const open = new Set<ReadableStreamDefaultController<Uint8Array>>();
  return {
    subscribe(c: ReadableStreamDefaultController<Uint8Array>) { open.add(c); },
    tell(event: string) {
      const bytes = new TextEncoder().encode(`data: ${event.replace(/\n/g, ' ')}\n\n`);
      for (const c of open) try { c.enqueue(bytes); } catch { open.delete(c); }
    },
  };
}
