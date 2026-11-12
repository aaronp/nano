// List: the messages and the folder shown; opening one publishes the whole message as `opened`.
import { Type } from 'typebox'
import { component, event, state } from '@pritzlaff/nano-runes'
import { MESSAGES, type Message } from './sample-data'
import { FolderId, MessageSchema } from './schemas'

const Config = Type.Object({ messages: Type.Array(MessageSchema, { maxItems: 5000, description: 'All the messages, newest first' }), folder: FolderId },
  { description: 'The settings: the messages and the folder shown', examples: [{ messages: [], folder: 'inbox' }] })

/** The messages, kept in the order given (newest first, as a host supplies them: dates are text to show, not sortable), and the folder shown.
 * `open` refuses an id that isn't a message; ids are compared, never used as keys. */
export const List = component('nano.inbox/list', () => {
  const s = state({ messages: MESSAGES.map(m => ({ ...m })) as Message[], folder: 'inbox' })
  const opened = event(MessageSchema)
  const setMessages = (list: Message[]) => {
    const dup = list.find((m, i) => list.findIndex(x => x.id === m.id) !== i)
    if (dup) throw new Error(`duplicate message id ${JSON.stringify(dup.id)}`)
    s.messages = list.map(m => ({ id: m.id, folder: m.folder, from: m.from, subject: m.subject, date: m.date, body: m.body }))
  }
  return {
    get messages() { return s.messages }, get folder() { return s.folder },
    get shown() { return s.messages.filter(m => m.folder === s.folder) },
    opened,
    get config() { return { messages: s.messages, folder: s.folder } },
    configure: (c: { messages: Message[]; folder: string }) => { setMessages(c.messages); s.folder = c.folder },
    show: (folder: string) => { s.folder = folder },
    setMessages,
    open: (id: string) => {
      const m = s.messages.find(x => x.id === id)
      if (!m) throw new Error(`${JSON.stringify(id)} is not a message`)
      opened({ ...m })
    },
  }
}, {
  config: Config,
  configure: { in: Config, description: 'Replaces the messages and the folder shown; refuses duplicate ids, changing nothing' },
  messages: Type.Array(MessageSchema, { maxItems: 5000, description: 'All the messages, newest first', examples: [[]] }),
  folder: Type.String({ maxLength: 40, description: 'The id of the folder shown', examples: ['inbox'] }),
  shown: Type.Array(MessageSchema, { maxItems: 5000, description: 'The messages in the folder shown, newest first', examples: [[]] }),
  opened: MessageSchema,
  show: { in: FolderId, description: 'Shows the messages of a folder (wire a folders component\'s selected event to it); a folder with no messages, or no such folder, shows an empty list' },
  setMessages: { in: Type.Array(MessageSchema, { maxItems: 5000, description: 'The new messages, newest first' }), description: 'Replaces all the messages; refuses duplicate ids, changing nothing' },
  open: { in: Type.String({ maxLength: 40, description: 'A message id', examples: ['m1'] }), description: 'Opens a message, publishing it whole as opened; refuses an id that is not a message' },
}, { description: 'A list of messages in one folder; opening one publishes it' })
