const ID = /^[a-z0-9][a-z0-9-]*$/
const PATH = /^\/[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/

export type Ref = `system:${string}` | `instance:${string}/${string}` | `screen:${string}`

export type Parsed = { kind: 'system'; id: string } | { kind: 'instance'; system: string; id: string } | { kind: 'screen'; path: string }

const check = (what: string, value: string, re: RegExp) => {
  if (!re.test(value)) throw new Error(`bad ${what}: ${JSON.stringify(value)}`)
}

/** Builds refs; throws on a bad id or path. */
export const ref = {
  system(id: string): Ref {
    check('system id', id, ID)
    return `system:${id}`
  },
  instance(system: string, id: string): Ref {
    check('system id', system, ID)
    check('instance id', id, ID)
    return `instance:${system}/${id}`
  },
  screen(path: string): Ref {
    check('screen path', path, PATH)
    return `screen:${path}`
  },
}

/** Parses a ref string; null when it is malformed. Never throws. */
export function parseRef(s: string): Parsed | null {
  if (s.startsWith('system:')) {
    const id = s.slice('system:'.length)
    return ID.test(id) ? { kind: 'system', id } : null
  }
  if (s.startsWith('instance:')) {
    const body = s.slice('instance:'.length)
    const slash = body.indexOf('/')
    if (slash < 0) return null
    const system = body.slice(0, slash), id = body.slice(slash + 1)
    return ID.test(system) && ID.test(id) ? { kind: 'instance', system, id } : null
  }
  if (s.startsWith('screen:')) {
    const path = s.slice('screen:'.length)
    return PATH.test(path) ? { kind: 'screen', path } : null
  }
  return null
}
