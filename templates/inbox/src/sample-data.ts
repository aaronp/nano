// The messages and folders the Inbox starts with (placeholders; a host replaces them with setFolders / setMessages).
export type Message = { id: string; folder: string; from: string; subject: string; date: string; body: string }

export const FOLDERS: { id: string; name: string }[] = [
  { id: 'inbox', name: 'Inbox' }, { id: 'sent', name: 'Sent' }, { id: 'archive', name: 'Archive' },
]

export const MESSAGES: Message[] = [
  { id: 'm1', folder: 'inbox', from: '[Sender name]', subject: 'Welcome to the app starter', date: '09:12',
    body: 'This is the Inbox package: three components, folders, list and reader, each a nano component you place on a workspace.\n\nThey are wired by subscriptions: the folders\' selected event feeds the list\'s show, and the list\'s opened event feeds the reader\'s read.' },
  { id: 'm2', folder: 'inbox', from: '[Team]', subject: 'Weekly report is ready', date: '08:40', body: '[Summary of the report goes here.]\n\n[Second paragraph.]' },
  { id: 'm3', folder: 'inbox', from: '[Customer]', subject: 'Question about my order', date: 'Mon', body: '[Message body.]' },
  { id: 'm4', folder: 'archive', from: '[Colleague]', subject: 'Design review notes', date: 'Fri', body: '[Notes body.]' },
  { id: 'm5', folder: 'sent', from: 'You', subject: 'Re: Quarterly plan', date: 'Thu', body: '[Your reply.]' },
]
