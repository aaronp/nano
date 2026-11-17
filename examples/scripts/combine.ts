/**
 * dist/nano.json: each example's built nano.json in one file. Its pods, runtimes, modules and layout slots, side by side;
 * a module two examples share (the same key, the same file) once. A pod, runtime or module named twice otherwise throws:
 * one file cannot hold both.
 */
type File = { pods: Record<string, unknown>; runtimes: Record<string, unknown>; modules?: Record<string, string>; layout?: { slots?: unknown[] } }

export function combine(files: Record<string, File>): Required<File> & { layout: { slots: unknown[] } } {
  const out = { pods: {} as File['pods'], runtimes: {} as File['runtimes'], modules: {} as Record<string, string>, layout: { slots: [] as unknown[] } }
  for (const [name, f] of Object.entries(files)) {
    for (const [what, into, from] of [['pod', out.pods, f.pods], ['runtime', out.runtimes, f.runtimes]] as const)
      for (const [k, v] of Object.entries(from)) {
        if (Object.hasOwn(into, k)) throw new Error(`${name}: ${what} ${k} is already in another example`)
        into[k] = v
      }
    for (const [k, m] of Object.entries(f.modules ?? {})) {
      if (Object.hasOwn(out.modules, k) && out.modules[k] !== m) throw new Error(`${name}: module ${k} is ${m}, another example's is ${out.modules[k]}`)
      out.modules[k] = m
    }
    out.layout.slots.push(...(f.layout?.slots ?? []))
  }
  return out
}
