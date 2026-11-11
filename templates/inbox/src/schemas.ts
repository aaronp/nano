// The message payload, defined once so `list.opened` fits `reader.read` exactly (Ops.fits compares schemas).
import { Type } from 'typebox'

export const FolderId = Type.String({ maxLength: 40, description: 'A folder id', examples: ['inbox'] })
export const MessageSchema = Type.Object({
  id: Type.String({ maxLength: 40, description: 'The message id', examples: ['m1'] }),
  folder: Type.String({ maxLength: 40, description: 'The id of the folder it is in', examples: ['inbox'] }),
  from: Type.String({ maxLength: 400, description: 'Who sent it', examples: ['Ada'] }),
  subject: Type.String({ maxLength: 400, description: 'The subject line', examples: ['Welcome'] }),
  date: Type.String({ maxLength: 400, description: 'When it was sent, as text to show', examples: ['09:12'] }),
  body: Type.String({ maxLength: 20000, description: 'The text of the message', examples: ['Hello'] }),
}, { description: 'A message' })
