import Type from 'typebox'

/** A schema that accepts anything, typed as T: the ops' data is checked by the model, not by the schema. */
export const any = <T>() => Type.Unsafe<T>(Type.Unknown())
/** A TypeRef: a type id, maybe as an array. */
export const Ref = Type.Object({ type: Type.String(), array: Type.Boolean() })
