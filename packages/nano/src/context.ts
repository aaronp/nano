/**
 * The context a handler runs in: which instance, in which runtime, with what config.
 *
 *   const h: Handler = async (ctx, input) => success(`${ctx.instance} got ${input}`)
 *   ctx.config   // the instance's config, typed by its implementation's schema
 */
export type NanoContext = {
  readonly instance: string
  readonly runtime: string
  readonly config: unknown
}
