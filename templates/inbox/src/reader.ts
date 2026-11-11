// Reader: the one message shown (or none).
import { Type } from 'typebox'
import { component, state } from '@pritzlaff/nano-runes'
import type { Message } from './sample-data'
import { MessageSchema } from './schemas'

/** Shows what it is given: it needs no store (wire a list's opened event to `read`). */
export const Reader = component('nano.inbox/reader', () => {
  const s = state({ message: null as Message | null })
  return {
    get message() { return s.message },
    read: (m: Message) => { s.message = { id: m.id, folder: m.folder, from: m.from, subject: m.subject, date: m.date, body: m.body } },
  }
}, {
  message: Type.Union([MessageSchema, Type.Null()], { description: 'The message shown, or null when none', examples: [null] }),
  read: { in: MessageSchema, description: 'Shows a message' },
}, { description: 'Shows one message: who, subject, date and body' })
