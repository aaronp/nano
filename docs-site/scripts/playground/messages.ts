export type FrameMessage = { kind: 'line' | 'error' | 'done'; text?: string }

/** A frame message for this run, or undefined: only the frame's own window, only this run, only the known shape. */
export const accept = (e: { source: unknown; data: unknown }, frame: unknown, run: string): FrameMessage | undefined => {
  const d = e.data as { run?: unknown; kind?: unknown; text?: unknown } | null
  if (e.source !== frame || !d || typeof d !== 'object' || d.run !== run) return undefined
  if (d.kind !== 'line' && d.kind !== 'error' && d.kind !== 'done') return undefined
  return typeof d.text === 'string' ? { kind: d.kind, text: d.text } : { kind: d.kind }
}
