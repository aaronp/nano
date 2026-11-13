/**
 * The nano model, headless: schemas, ops, interfaces and results.
 *
 *   const Key = defineSchema('Key', Type.String())
 *   const db = iface('acme/db', { get: op.action('get', Key, Key) })
 *   success(db.ops.get.coord)   // NanoResult<string>
 */
export * from './schema.ts'
export * from './op.ts'
export * from './iface.ts'
export * from './result.ts'
