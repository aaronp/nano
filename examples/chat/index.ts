// The chat example's module: its provider (default export) and its view, by implementation.
import { ChatRoomView } from './room/view.ts'

export { default } from './room/messaging.ts'
export const views = { 'example.chat/participant': 'chat-room' }

if (!customElements.get('chat-room')) customElements.define('chat-room', ChatRoomView)
